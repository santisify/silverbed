/**
 * End-to-end API smoke test.
 * Usage: bun test/e2e.ts [baseUrl]
 *
 * Test images are generated on demand, so the suite has no fixture files that
 * can go missing — a fresh clone can run it immediately.
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const API = `${BASE}/api/v1`;

const ASSETS = "../.tmp-assets";

/** Writes the three fixture images the upload checks use, if they are missing. */
async function ensureFixtures() {
  mkdirSync(ASSETS, { recursive: true });
  const specs = [
    { name: "alpha.jpg", w: 1600, h: 1200, bg: "#2b3a42" },
    { name: "beta.jpg", w: 1200, h: 1600, bg: "#3a2b33" },
    { name: "gamma.png", w: 640, h: 640, bg: "#2f3a2b" },
  ] as const;
  for (const spec of specs) {
    const path = `${ASSETS}/${spec.name}`;
    if (await Bun.file(path).exists()) continue;
    const image = sharp({ create: { width: spec.w, height: spec.h, channels: 3, background: spec.bg } });
    const buf = spec.name.endsWith(".png") ? await image.png().toBuffer() : await image.jpeg().toBuffer();
    await Bun.write(path, buf);
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

async function api(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text, res };
}

/** Uploads a single in-memory image, for checks that need crafted bytes. */
async function uploadOne(bytes: Uint8Array, name: string, token: string) {
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: "image/jpeg" }), name);
  return api("/files/upload", { method: "POST", body: form }, token);
}

async function main() {
  await ensureFixtures();
  console.log(`\nSilverbed e2e → ${BASE}\n`);
  console.log("note: repeat runs need RATE_LIMIT=false on the server\n");

  const health = await api("/health");
  check("health returns ok", health.json?.data?.status === "ok", health.text);

  const suffix = Math.random().toString(36).slice(2, 7);
  const adminName = `admin${suffix}`;
  const password = "silverbed-test-123";

  const status = await api("/setup/status");
  if (!status.json?.data?.installed) {
    const install = await api("/setup/install", {
      method: "POST",
      body: JSON.stringify({ username: adminName, password, email: `admin${suffix}@example.com`, siteName: "Silverbed Test" }),
    });
    check("setup creates the first admin", install.status === 200 && !!install.json?.data?.token, install.text);
  } else {
    const register = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: adminName, password }),
    });
    check("register a fresh account", register.status === 200, register.text);
  }

  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: adminName, password }) });
  const token: string = login.json?.data?.token;
  check("login returns a token", Boolean(token), login.text);

  const badLogin = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: adminName, password: "wrong-password" }) });
  check("wrong password is rejected", badLogin.status === 401, badLogin.text);

  const me = await api("/auth/me", {}, token);
  check("me returns the session user", me.json?.data?.user?.username === adminName, me.text);

  const guarded = await api("/files");
  check("files endpoint requires auth", guarded.status === 401, guarded.text);

  // folders
  const parent = await api("/folders", { method: "POST", body: JSON.stringify({ name: "Field notes" }) }, token);
  const child = await api("/folders", { method: "POST", body: JSON.stringify({ name: "Roll 01", parentId: parent.json?.data?.id }) }, token);
  check("nested folders are created", child.status === 200 && Boolean(child.json?.data?.id), child.text);

  // upload
  const form = new FormData();
  for (const [name, file] of [["alpha.jpg", "../.tmp-assets/alpha.jpg"], ["beta.jpg", "../.tmp-assets/beta.jpg"], ["gamma.png", "../.tmp-assets/gamma.png"]] as const) {
    form.append("files", new Blob([await Bun.file(file).arrayBuffer()], { type: "image/jpeg" }), name);
  }
  form.append("folderId", child.json?.data?.id);
  form.append("tags", "fieldwork, roll-01");
  const uploadRes = await fetch(`${API}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const upload = await uploadRes.json();
  check("upload accepts multiple files", uploadRes.status === 200 && upload?.data?.files?.length === 3, JSON.stringify(upload).slice(0, 300));

  const first = upload?.data?.files?.[0];
  check("thumbnail url is produced", typeof first?.thumbUrl === "string" && first.thumbUrl.includes(".thumb.webp"));
  check("metadata is populated", first?.width === 1600 && first?.height === 1200, JSON.stringify(first)?.slice(0, 200));

  const thumbRes = await fetch(first.thumbUrl);
  const thumbBytes = new Uint8Array(await thumbRes.arrayBuffer());
  check("thumbnail is served as webp", thumbRes.status === 200 && thumbRes.headers.get("content-type") === "image/webp" && thumbBytes.byteLength > 100, `${thumbRes.status}`);
  const origRes = await fetch(first.url);
  check("original image is served", origRes.status === 200, `${first.url} → ${origRes.status}`);

  // dedupe
  const dedupeForm = new FormData();
  dedupeForm.append("files", new Blob([await Bun.file("../.tmp-assets/alpha.jpg").arrayBuffer()], { type: "image/jpeg" }), "alpha-copy.jpg");
  const dedupeRes = await fetch(`${API}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: dedupeForm });
  const dedupe = await dedupeRes.json();
  check("identical bytes are deduplicated", dedupe?.data?.files?.[0]?.deduplicated === true && dedupe?.data?.files?.[0]?.id === first.id, JSON.stringify(dedupe).slice(0, 200));

  // listing & filtering
  const list = await api("/files?pageSize=10", {}, token);
  check("file list returns the uploads", list.json?.data?.total === 3, JSON.stringify(list.json)?.slice(0, 200));
  const search = await api("/files?q=alpha", {}, token);
  check("search filters by name", search.json?.data?.items?.[0]?.name === "alpha.jpg", JSON.stringify(search.json)?.slice(0, 200));
  const tagFilter = await api("/files?tag=fieldwork", {}, token);
  check("tag filter works", tagFilter.json?.data?.total === 3, JSON.stringify(tagFilter.json)?.slice(0, 200));

  // patch + tags
  const patch = await api(`/files/${first.id}`, { method: "PATCH", body: JSON.stringify({ name: "alpha-renamed.jpg", description: "morning light", tags: ["keeper"] }) }, token);
  check("file metadata update works", patch.json?.data?.name === "alpha-renamed.jpg" && patch.json?.data?.tags?.some((t: any) => t.name === "keeper"), JSON.stringify(patch.json)?.slice(0, 300));

  const privateSet = await api(`/files/${first.id}`, { method: "PATCH", body: JSON.stringify({ accessLevel: "private" }) }, token);
  check("file can be made private", privateSet.json?.data?.accessLevel === "private");
  const anonPrivate = await fetch(first.url);
  check("private image is hidden from anonymous visitors", anonPrivate.status === 404, `${anonPrivate.status}`);
  const ownerPrivate = await fetch(first.url, { headers: { Authorization: `Bearer ${token}` } });
  check("private image is visible to its owner", ownerPrivate.status === 200, `${ownerPrivate.status}`);
  await api(`/files/${first.id}`, { method: "PATCH", body: JSON.stringify({ accessLevel: "public" }) }, token);

  // batch move
  const batch = await api("/files/batch", { method: "POST", body: JSON.stringify({ action: "move", ids: [first.id], value: parent.json?.data?.id }) }, token);
  check("batch move relocates files", batch.json?.data?.affected === 1, JSON.stringify(batch.json));

  // shares
  const share = await api("/shares", { method: "POST", body: JSON.stringify({ title: "Contact sheet 01", fileIds: [first.id, upload.data.files[1].id], password: "open-sesame", expiresInDays: 7 }) }, token);
  const shareToken = share.json?.data?.token;
  check("share link is created", Boolean(shareToken), JSON.stringify(share.json).slice(0, 300));

  const locked = await api(`/public/shares/${shareToken}`);
  check("password protected share is locked", locked.json?.data?.locked === true && locked.json?.data?.items?.length === 0, JSON.stringify(locked.json).slice(0, 200));

  const wrongUnlock = await api(`/public/shares/${shareToken}/unlock`, { method: "POST", body: JSON.stringify({ password: "nope" }) });
  check("wrong share password is rejected", wrongUnlock.status === 403, wrongUnlock.text);

  const unlock = await api(`/public/shares/${shareToken}/unlock`, { method: "POST", body: JSON.stringify({ password: "open-sesame" }) });
  check("correct share password unlocks", unlock.status === 200 && Boolean(unlock.json?.data?.accessToken), unlock.text);

  const opened = await api(`/public/shares/${shareToken}?t=open-sesame`);
  check("unlocked share returns its items", opened.json?.data?.items?.length === 2, JSON.stringify(opened.json).slice(0, 300));

  const zip = await fetch(`${BASE}/s/${shareToken}/download`);
  const zipBytes = new Uint8Array(await zip.arrayBuffer());
  check("share zip download works", zip.status === 200 && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, `${zip.status} ${zipBytes.byteLength}`);

  // api keys + open api
  const key = await api("/keys", { method: "POST", body: JSON.stringify({ name: "pipeline" }) }, token);
  const secret = key.json?.data?.secret;
  check("api key is issued once", typeof secret === "string" && secret.startsWith("sb_"), JSON.stringify(key.json).slice(0, 200));

  const { default: sharp } = await import("sharp");
  // Fresh random pixels each run: identical bytes would hit the dedupe path and
  // reuse the earlier upload's uploadedVia, which is correct but not what we assert.
  const noise = Buffer.from(Array.from({ length: 1600 * 1200 * 3 }, () => Math.floor(Math.random() * 256)));
  const apiBytes = await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg().toBuffer();
  const apiForm = new FormData();
  apiForm.append("files", new Blob([apiBytes], { type: "image/jpeg" }), "beta-api.jpg");
  const apiUpload = await fetch(`${API}/files/upload`, { method: "POST", headers: { "X-Access-Key": secret }, body: apiForm });
  const apiUploadJson = await apiUpload.json();
  check("open API accepts X-Access-Key uploads", apiUpload.status === 200 && apiUploadJson?.data?.files?.[0]?.uploadedVia === "api", JSON.stringify(apiUploadJson).slice(0, 300));

  const badKey = await fetch(`${API}/files?pageSize=1`, { headers: { "X-Access-Key": "sb_bogus_key" } });
  check("bogus access key is rejected", badKey.status === 401, `${badKey.status}`);

  const randomRes = await fetch(`${API}/open/random?redirect=0`, { redirect: "manual" });
  const randomJson = await randomRes.json();
  check("random image endpoint returns a public file", randomRes.status === 200 && !!randomJson?.data?.url, JSON.stringify(randomJson).slice(0, 200));

  // stats
  const stats = await api("/stats/overview", {}, token);
  check("user stats aggregate correctly", stats.json?.data?.totals?.files >= 3 && Array.isArray(stats.json?.data?.timeline), JSON.stringify(stats.json).slice(0, 200));

  const fileStats = await api("/files/stats", {}, token);
  check("file stats report formats", Array.isArray(fileStats.json?.data?.formats) && fileStats.json.data.formats.length >= 2, JSON.stringify(fileStats.json).slice(0, 200));

  // trash lifecycle
  const del = await api(`/files/${first.id}`, { method: "DELETE" }, token);
  const trash = await api("/files?scope=trash", {}, token);
  check("soft delete moves a file to trash", del.status === 200 && trash.json?.data?.total === 1, JSON.stringify(trash.json).slice(0, 200));
  const restore = await api(`/files/${first.id}/restore`, { method: "POST" }, token);
  const afterRestore = await api("/files?scope=trash", {}, token);
  check("restore brings a file back", restore.status === 200 && afterRestore.json?.data?.total === 0, JSON.stringify(afterRestore.json).slice(0, 200));

  // shared gallery — every public frame, managed per uploader (admins: all)
  const anonGallery = await api("/gallery?pageSize=10");
  check("gallery is readable without a session", anonGallery.status === 200 && Array.isArray(anonGallery.json?.data?.items), anonGallery.text);
  check("gallery shows only public frames", anonGallery.json?.data?.items?.length > 0 && anonGallery.json.data.items.every((item: any) => item.accessLevel === "public"));
  check("gallery frames name their uploader", typeof anonGallery.json?.data?.items?.[0]?.owner?.username === "string");
  check("gallery hides management from anonymous visitors", anonGallery.json?.data?.items?.every((item: any) => item.canManage === false));
  const anonBatch = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "delete", ids: [first.id] }) });
  check("gallery batch requires a session", anonBatch.status === 401, anonBatch.text);
  const anonMine = await api("/gallery?mine=1");
  check("gallery mine filter requires a session", anonMine.status === 401, anonMine.text);

  const mineGallery = await api("/gallery?mine=1&pageSize=20", {}, token);
  check(
    "gallery mine filter returns only manageable frames",
    mineGallery.json?.data?.items?.length >= 3 && mineGallery.json.data.items.every((item: any) => item.canManage === true),
    JSON.stringify(mineGallery.json).slice(0, 200),
  );

  const ownPrivate = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "access", ids: [first.id], value: "private" }) }, token);
  check("owners can manage their frames from the gallery", ownPrivate.json?.data?.affected === 1, JSON.stringify(ownPrivate.json));
  const afterPrivate = await api("/gallery?pageSize=50");
  check("private frames leave the shared sheet", !afterPrivate.json?.data?.items?.some((item: any) => item.id === first.id));
  const backPublic = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "access", ids: [first.id], value: "public" }) }, token);
  check("owners can put frames back on the sheet", backPublic.json?.data?.affected === 1, JSON.stringify(backPublic.json));

  // admin surface (the first account in this run may be a plain user)
  const adminOverview = await api("/admin/overview", {}, token);
  if (adminOverview.status === 200) {
    check("admin overview returns system info", adminOverview.json?.data?.system?.storageDriver === "local", JSON.stringify(adminOverview.json).slice(0, 200));
    const settings = await api("/admin/settings", { method: "PATCH", body: JSON.stringify({ max_upload_mb: "12" }) }, token);
    check("admin can update settings", settings.json?.data?.max_upload_mb === "12", JSON.stringify(settings.json).slice(0, 200));
    const users = await api("/admin/users", {}, token);
    check("admin can list users", Array.isArray(users.json?.data?.items), JSON.stringify(users.json).slice(0, 200));
    const mailTest = await api("/admin/mail/test", { method: "POST", body: JSON.stringify({ to: "dev@example.com" }) }, token);
    check("mail test writes to the outbox", mailTest.status === 200 && mailTest.json?.data?.transport === "console", mailTest.text);
    await api("/admin/settings", { method: "PATCH", body: JSON.stringify({ max_upload_mb: "32" }) }, token);

    // admins manage every uploader's frames from the shared sheet
    const peerName = `peer${suffix}`;
    const peer = await api("/admin/users", { method: "POST", body: JSON.stringify({ username: peerName, password, role: "user" }) }, token);
    check("admin can create a peer account", peer.status === 200 && Boolean(peer.json?.data?.id), peer.text);
    const peerLogin = await api("/auth/login", { method: "POST", body: JSON.stringify({ username: peerName, password }) });
    const peerToken: string = peerLogin.json?.data?.token;
    const peerForm = new FormData();
    peerForm.append("files", new Blob([await Bun.file("../.tmp-assets/alpha.jpg").arrayBuffer()], { type: "image/jpeg" }), "peer.jpg");
    const peerUpload = await fetch(`${API}/files/upload`, { method: "POST", headers: { Authorization: `Bearer ${peerToken}` }, body: peerForm });
    const peerFile = (await peerUpload.json())?.data?.files?.[0];
    check("peer account uploads its own frame", peerUpload.status === 200 && Boolean(peerFile?.id));

    const peerScoped = await api(`/gallery?owner=${peerName}`, {}, token);
    const peerItem = peerScoped.json?.data?.items?.find((item: any) => item.id === peerFile?.id);
    check("admin sees other uploaders' frames", Boolean(peerItem), JSON.stringify(peerScoped.json).slice(0, 200));
    check("admin may manage other uploaders' frames", peerItem?.canManage === true);
    const peerOwn = await api(`/gallery?owner=${peerName}`, {}, peerToken);
    check("owners see their own frames as manageable", peerOwn.json?.data?.items?.find((item: any) => item.id === peerFile?.id)?.canManage === true);
    const peerTrash = await api("/gallery?scope=trash", {}, peerToken);
    check("shared trash is admin-only", peerTrash.status === 403, peerTrash.text);

    const adminTrashPeer = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "delete", ids: [peerFile.id] }) }, token);
    check("admin can trash another account's frame", adminTrashPeer.json?.data?.affected === 1, JSON.stringify(adminTrashPeer.json));
    const sharedTrash = await api("/gallery?scope=trash&pageSize=50", {}, token);
    check("shared trash lists the removed frame", sharedTrash.json?.data?.items?.some((item: any) => item.id === peerFile.id));
    const adminRestorePeer = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "restore", ids: [peerFile.id] }) }, token);
    check("admin can restore from the shared trash", adminRestorePeer.json?.data?.affected === 1, JSON.stringify(adminRestorePeer.json));

    const peerSelfManage = await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "delete", ids: [peerFile.id] }) }, peerToken);
    check("owners can trash their own frame from the gallery", peerSelfManage.json?.data?.affected === 1, JSON.stringify(peerSelfManage.json));
    await api("/gallery/batch", { method: "POST", body: JSON.stringify({ action: "purge", ids: [peerFile.id] }) }, token);
    await api(`/admin/users/${peer.json?.data?.id}`, { method: "DELETE" }, token);
  } else {
    check("admin endpoints reject non-admins", adminOverview.status === 403, adminOverview.text);
  }

  const folders = await api("/folders", {}, token);
  check("folder tree is returned", Array.isArray(folders.json?.data?.tree), JSON.stringify(folders.json).slice(0, 200));

  const tags = await api("/tags", {}, token);
  check("tags are aggregated", Array.isArray(tags.json?.data) && tags.json.data.length >= 2, JSON.stringify(tags.json).slice(0, 200));

  // Direct uploads: either a signed ticket (bucket storage) or a clear refusal
  // so the browser can fall back to the multipart endpoint.
  const sign = await api(
    "/uploads/sign",
    { method: "POST", body: JSON.stringify({ name: "direct-frame.jpg", size: 4096 }) },
    token,
  );
  const signed = sign.status === 200 && Boolean(sign.json?.data?.uploadUrl);
  const declined = sign.status === 400 && /direct uploads/i.test(String(sign.json?.message ?? ""));
  check("direct uploads are offered or declined clearly", signed || declined, sign.text.slice(0, 160));

  const foreign = await api(
    "/files/import",
    { method: "POST", body: JSON.stringify({ id: "x", key: "orig/someone-else/202601/x.jpg", name: "x.jpg" }) },
    token,
  );
  check("import refuses keys outside your namespace", foreign.status === 403, foreign.text.slice(0, 160));

  // EXIF: the inspector shows what took the picture, and a quarter-turn
  // orientation is applied so the recorded size matches the displayed frame.
  const exifUpload = await uploadOne(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: "#223344" } })
      .jpeg()
      .withExif({
        IFD0: { Make: "Canon", Model: "EOS R5" },
        IFD2: {
          DateTimeOriginal: "2024:05:01 18:20:30",
          ExposureTime: "1/250",
          FNumber: "28/10",
          ISOSpeedRatings: "400",
          FocalLength: "35/1",
          LensModel: "RF24-70mm F2.8 L IS USM",
        },
      })
      .toBuffer(),
    "exif-frame.jpg",
    token,
  );
  const exifId = exifUpload.json?.data?.files?.[0]?.id;
  const exifDetail = await api(`/files/${exifId}`, {}, token);
  const exif = exifDetail.json?.data?.exif;
  check("upload keeps the camera and lens", exif?.make === "Canon" && exif?.lens === "RF24-70mm F2.8 L IS USM", JSON.stringify(exif));
  check(
    "upload keeps exposure settings",
    exif?.iso === 400 && Math.round((exif?.fNumber ?? 0) * 10) === 28 && Math.round((exif?.exposure ?? 0) * 10000) === 40,
    JSON.stringify(exif),
  );

  const turnedUpload = await uploadOne(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: "#443322" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer(),
    "turned.jpg",
    token,
  );
  const turned = turnedUpload.json?.data?.files?.[0];
  check("orientation 6 reports rotated dimensions", turned?.width === 480 && turned?.height === 640, `${turned?.width}×${turned?.height}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("failed checks:", failures.join(", "));
    process.exit(1);
  }
}

await main();
