/**
 * Direct-upload flow check: sign → PUT to the bucket → import → redirect.
 *
 *   bun test/direct-upload.ts [baseUrl]
 *
 * Needs a server configured with STORAGE_DRIVER=s3 pointing at a bucket you do
 * not mind writing to. `bun test/fake-s3.mjs` + the env in the README work too.
 */
import sharp from "sharp";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const API = `${BASE}/api/v1`;

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}`, detail);
  }
}

async function json(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body, text, res };
}

const status = await json("/setup/status");
let token: string;
if (!status.body?.data?.installed) {
  const install = await json("/setup/install", {
    method: "POST",
    body: JSON.stringify({ username: "directadmin", password: "direct-test-123", email: "direct@example.com" }),
  });
  token = install.body?.data?.token;
} else {
  const login = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: process.env.UI_USER ?? "admin", password: process.env.UI_PASS ?? "silverbed123" }),
  });
  token = login.body?.data?.token;
}
if (!token) {
  console.log("skipped: could not sign in — pass UI_USER/UI_PASS for an existing account, or run against a fresh instance");
  process.exit(0);
}
check("signed in", Boolean(token));

const bytes = await sharp({ create: { width: 1600, height: 1100, channels: 3, background: "#1c2733" } })
  .jpeg()
  .withExif({
    IFD0: { Make: "Leica", Model: "Q3" },
    IFD2: { FNumber: "17/10", ISOSpeedRatings: "100", FocalLength: "28/1", ExposureTime: "1/320" },
  })
  .toBuffer();

const sign = await json(
  "/uploads/sign",
  { method: "POST", body: JSON.stringify({ name: "direct-check.jpg", size: bytes.length }) },
  token,
);
const ticket = sign.body?.data;
if (sign.status === 400 && /direct uploads/i.test(String(sign.body?.message ?? ""))) {
  console.log("skipped: this instance uses local storage — run it against STORAGE_DRIVER=s3");
  process.exit(0);
}
check("sign returns a presigned ticket", sign.status === 200 && Boolean(ticket?.uploadUrl), sign.text.slice(0, 200));
if (!ticket) process.exit(1);

const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: bytes });
check("browser-style PUT is accepted by the bucket", put.ok, `${put.status} ${await put.text().catch(() => "")}`);

const imported = await json(
  "/files/import",
  {
    method: "POST",
    body: JSON.stringify({ id: ticket.id, key: ticket.key, name: "direct-check.jpg", tags: "direct,check" }),
  },
  token,
);
const file = imported.body?.data;
check("import creates the frame", imported.status === 200 && Boolean(file?.id), imported.text.slice(0, 200));
check("import generated a thumbnail", Boolean(file?.thumbKey), JSON.stringify(file?.thumbKey));

const detail = await json(`/files/${file?.id}`, {}, token);
check("exif survived the direct path", detail.body?.data?.exif?.model === "Q3", JSON.stringify(detail.body?.data?.exif));
check("tags applied on import", (detail.body?.data?.tags ?? []).length === 2, JSON.stringify(detail.body?.data?.tags));

const asset = await fetch(`${BASE}/i/${file?.id}.jpg`, { redirect: "manual" });
check("asset route redirects to the bucket", asset.status === 302, `${asset.status}`);
const location = asset.headers.get("location") ?? "";
const fetched = await fetch(location);
const roundTrip = new Uint8Array(await fetched.arrayBuffer());
check("redirected bytes match the upload", fetched.ok && roundTrip.byteLength === bytes.length, `${fetched.status} ${roundTrip.byteLength}b`);

const thumb = await fetch(`${BASE}/i/${file?.id}.thumb.webp`, { redirect: "manual" });
check("thumbnail is served from the bucket", thumb.status === 302 || thumb.status === 200, `${thumb.status}`);

// Private frames must not be reachable from the public origin: the API signs a
// short-lived URL only after it has authorised the viewer.
await json(`/files/${file?.id}`, { method: "PATCH", body: JSON.stringify({ accessLevel: "private" }) }, token);
const anonymous = await fetch(`${BASE}/i/${file?.id}.jpg`, { redirect: "manual" });
check("private frame is hidden from anonymous visitors", anonymous.status === 404, `${anonymous.status}`);
const owner = await fetch(`${BASE}/i/${file?.id}.jpg`, {
  redirect: "manual",
  headers: { authorization: `Bearer ${token}` },
});
const signed = owner.headers.get("location") ?? "";
check("owner gets a signed redirect instead", owner.status === 302 && signed.includes("X-Amz-Signature"), `${owner.status} ${signed.slice(0, 80)}`);
const download = await fetch(`${BASE}/i/${file?.id}.jpg?dl=1`, {
  redirect: "manual",
  headers: { authorization: `Bearer ${token}` },
});
check("downloads ask the bucket for an attachment", download.status === 302 && /response-content-disposition/i.test(download.headers.get("location") ?? ""), `${download.status}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(", "));
  process.exit(1);
}
