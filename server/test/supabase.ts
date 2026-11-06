/**
 * Supabase authentication tests.
 *
 * Runs without a real Supabase instance: it boots a minimal GoTrue stand-in
 * that signs real RS256 tokens, then checks that the API accepts them, rejects
 * tampered ones, and provisions users on first sight.
 *
 *   bun test/supabase.ts
 */
import { createHmac, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { rm } from "node:fs/promises";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

// ── fake GoTrue ────────────────────────────────────────────────────────────
const HS_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "gotrue-key", alg: "RS256", use: "sig" };

interface FakeUser {
  id: string;
  email: string;
  password: string;
  data: Record<string, unknown>;
}

const USERS = new Map<string, FakeUser>();
USERS.set("known@example.com", {
  id: "11111111-2222-3333-4444-555555555555",
  email: "known@example.com",
  password: "correct-horse",
  data: { username: "knownuser" },
});

function mint(user: FakeUser, alg: "RS256" | "HS256"): string {
  const payload = {
    iss: `${gotrueBase}/auth/v1`,
    sub: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    user_metadata: user.data,
    iat: now(),
    exp: now() + 3600,
  };
  if (alg === "HS256") {
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64(payload);
    return `${h}.${p}.${createHmac("sha256", HS_SECRET).update(`${h}.${p}`).digest("base64url")}`;
  }
  const h = b64({ alg: "RS256", typ: "JWT", kid: "gotrue-key" });
  const p = b64(payload);
  return `${h}.${p}.${nodeSign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
}

const gotrue = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.includes("jwks")) return Response.json({ keys: [jwk] });
    if (url.pathname.endsWith("/settings")) return Response.json({ external: {}, disable_signup: false });
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "password") {
      const body = (await req.json()) as { email: string; password: string };
      const user = USERS.get(body.email.toLowerCase());
      if (!user || user.password !== body.password) {
        return Response.json({ error: "invalid_grant", error_description: "Invalid login credentials" }, { status: 400 });
      }
      return Response.json({
        access_token: mint(user, "RS256"),
        refresh_token: "refresh-token-value",
        expires_in: 3600,
        user: { id: user.id, email: user.email, user_metadata: user.data },
      });
    }
    if (url.pathname.endsWith("/signup")) {
      const body = (await req.json()) as { email: string; password: string; data: Record<string, unknown> };
      const user: FakeUser = { id: crypto.randomUUID(), email: body.email, password: body.password, data: body.data ?? {} };
      USERS.set(body.email.toLowerCase(), user);
      return Response.json({
        access_token: mint(user, "RS256"),
        refresh_token: "rt",
        expires_in: 3600,
        user: { id: user.id, email: user.email, user_metadata: user.data },
      });
    }
    return new Response("not found", { status: 404 });
  },
});
const gotrueBase = `http://127.0.0.1:${gotrue.port}`;

// ── the API under test, configured against the fake GoTrue ──────────────────
const apiDir = new URL("../", import.meta.url).pathname; // api/
const apiPort = 8899;
const testDataDir = `${apiDir}.test-data`;

const api = Bun.spawn(["bun", "src/index.ts"], {
  cwd: apiDir,
  env: {
    ...process.env,
    PORT: String(apiPort),
    AUTH_MODE: "both",
    SUPABASE_URL: gotrueBase,
    // A local .env may pin a real JWKS endpoint; the fake server must win, or
    // token verification tries to reach the internet and the suite fails.
    SUPABASE_JWKS_URL: `${gotrueBase}/auth/v1/.well-known/jwks.json`,
    SUPABASE_JWT_SECRET: "super-secret-jwt-token-with-at-least-32-characters-long",
    SUPABASE_ANON_KEY: "fake-anon-key",
    SUPABASE_PASSWORD_LOGIN: "true",
    JWT_SECRET: "local-jwt-secret-for-tests-1234567890",
    WEB_DIST: "../web/dist",
    // Isolated database: the running dev server holds a lock on ./data/pglite.
    DATA_DIR: testDataDir,
    DATABASE_URL: "",
  },
  stdout: "pipe",
  stderr: "pipe",
});

const base = `http://127.0.0.1:${apiPort}`;
const apiLog: string[] = [];
void (async () => {
  for await (const chunk of api.stderr as ReadableStream<Uint8Array>) {
    apiLog.push(new TextDecoder().decode(chunk));
  }
})();

async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/v1/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(250);
  }
  return false;
}

async function json(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return json(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

try {
  console.log("\n▸ Supabase auth (self-hosted)");
  const up = await waitForApi();
  check("API starts with Supabase configured", up, up ? "" : apiLog.join("").slice(-400));
  if (!up) throw new Error("API did not start");

  // providers advertise the capability to the UI
  const providers = await json("/api/v1/auth/providers");
  check("providers report supabase enabled", providers.body?.data?.supabase === true);
  check("providers report email-based sign-in", providers.body?.data?.loginWithEmail === true);

  // password grant goes through GoTrue
  const okLogin = await post("/api/v1/auth/login", { username: "known@example.com", password: "correct-horse" });
  check("GoTrue password grant signs in", okLogin.status === 200 && Boolean(okLogin.body?.data?.token));
  check("returned token is an RS256 Supabase token",
    String(okLogin.body?.data?.token ?? "").startsWith("eyJhbGciOiJSUzI1NiI"));
  check("refresh token is passed through", okLogin.body?.data?.refreshToken === "refresh-token-value");

  const token = okLogin.body?.data?.token as string;

  const wrongPass = await post("/api/v1/auth/login", { username: "known@example.com", password: "nope" });
  check("wrong password returns 401", wrongPass.status === 401, `got ${wrongPass.status}`);

  const unknown = await post("/api/v1/auth/login", { username: "ghost@example.com", password: "x" });
  check("unknown account returns 401", unknown.status === 401, `got ${unknown.status}`);

  // the Supabase token authenticates against our API
  const me = await json("/api/v1/auth/me", { headers: { authorization: `Bearer ${token}` } });
  check("Supabase token authenticates", me.status === 200 && me.body?.data?.user?.email === "known@example.com");
  check("user is provisioned as provider=supabase", me.body?.data?.user?.provider === "supabase");
  check("username comes from user_metadata", me.body?.data?.user?.username === "knownuser");
  check("Supabase 'authenticated' role does not grant admin", me.body?.data?.user?.role === "user");

  // tampered signature is rejected
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}AAAA`;
  const bad = await json("/api/v1/auth/me", { headers: { authorization: `Bearer ${tampered}` } });
  check("tampered token is rejected", bad.status === 401, `got ${bad.status}`);

  // a token signed with the wrong secret must not pass
  const forgedHeader = b64({ alg: "HS256", typ: "JWT" });
  const forgedPayload = b64({ sub: "11111111-2222-3333-4444-555555555555", role: "admin", exp: now() + 3600 });
  const forgedSig = createHmac("sha256", "some-other-secret-entirely-000000000").update(`${forgedHeader}.${forgedPayload}`).digest("base64url");
  const forged = await json("/api/v1/auth/me", { headers: { authorization: `Bearer ${forgedHeader}.${forgedPayload}.${forgedSig}` } });
  check("forged HS256 token is rejected", forged.status === 401, `got ${forged.status}`);

  // registration creates the account in GoTrue
  const email = `new-${Date.now()}@example.com`;
  const reg = await post("/api/v1/auth/register", { username: "freshuser", password: "a-good-password", email });
  check("registration returns a session", reg.status === 200 && Boolean(reg.body?.data?.token), `got ${reg.status}`);
  const regMe = await json("/api/v1/auth/me", { headers: { authorization: `Bearer ${reg.body?.data?.token}` } });
  check("registered user is queryable", regMe.body?.data?.user?.email === email);

  // With password verification delegated to GoTrue, a local-only account can no
  // longer sign in by password — that is the documented tradeoff of the switch.
  const localLogin = await post("/api/v1/auth/login", { username: "admin", password: "silverbed123" });
  check("delegated passwords no longer authenticate locally", localLogin.status === 401, `got ${localLogin.status}`);
} catch (err) {
  failures.push(`fatal: ${(err as Error).message}`);
  console.log(`  ✗ fatal: ${(err as Error).message}`);
} finally {
  api.kill();
  gotrue.stop(true);
  await Bun.sleep(300);
  await rm(testDataDir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${"─".repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
