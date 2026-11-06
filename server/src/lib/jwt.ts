import { createHmac, createPublicKey, verify as verifySignature } from "node:crypto";
import { config } from "../config";

export interface Claims {
  sub: string;
  /** For our own tokens: "admin" | "user". Supabase sends "authenticated". */
  role: string;
  username?: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  [key: string]: unknown;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

const unB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signToken(
  claims: Omit<Claims, "iat" | "exp"> & Partial<Pick<Claims, "iat" | "exp">>,
  ttlSeconds = config.jwtTtlSeconds,
): string {
  const iat = claims.iat ?? Math.floor(Date.now() / 1000);
  const payload: Claims = { ...claims, iat, exp: claims.exp ?? iat + ttlSeconds } as Claims;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

/**
 * Verifies an HS256 JWT with a shared secret. Self-hosted and hosted Supabase
 * both issue HS256 tokens signed with the project JWT secret by default.
 */
export function verifyToken(token: string, secret = config.jwtSecret): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  return parseClaims(body);
}

function parseClaims(body: string): Claims | null {
  try {
    const claims = JSON.parse(unB64url(body)) as Claims;
    if (typeof claims.exp === "number" && Math.floor(Date.now() / 1000) > claims.exp) return null;
    if (!claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Claims without signature checking — only for reading `alg`/`kid` before verifying. */
function peek(token: string): { header: Record<string, unknown>; body: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(unB64url(parts[0] as string)) as Record<string, unknown>,
      body: parts[1] as string,
    };
  } catch {
    return null;
  }
}

// ── asymmetric verification (RS256 / ES256) for modern Supabase projects ────

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

function jwksUrl(): string | null {
  if (config.supabaseJwksUrl) return config.supabaseJwksUrl;
  if (config.supabaseUrl) return `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`;
  return null;
}

async function fetchJwks(force = false): Promise<Jwk[]> {
  const url = jwksUrl();
  if (!url) return [];
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return jwksCache?.keys ?? [];
    const payload = (await res.json()) as { keys?: Jwk[] };
    const keys = payload.keys ?? [];
    jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
  } catch {
    return jwksCache?.keys ?? [];
  }
}

function verifyWithJwk(token: string, jwk: Jwk): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, sig] = parts as [string, string, string];
  try {
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    const alg = jwk.alg ?? "RS256";
    const ok = verifySignature(
      alg === "ES256" ? "sha256" : "sha256",
      Buffer.from(`${h}.${b}`),
      alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
      Buffer.from(sig, "base64url"),
    );
    return ok ? parseClaims(b) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Supabase access token: HS256 against the configured secret, or
 * RS256/ES256 against the project's JWKS. JSON web key identifiers are matched
 * when present so keys can rotate.
 */
export async function verifySupabaseToken(token: string): Promise<Claims | null> {
  const peeked = peek(token);
  if (!peeked) return null;
  const alg = String(peeked.header.alg ?? "");
  const kid = peeked.header.kid as string | undefined;

  if (config.supabaseJwtSecret) {
    const hs = verifyToken(token, config.supabaseJwtSecret);
    if (hs) return hs;
  }
  if (alg === "RS256" || alg === "ES256") {
    let keys = await fetchJwks();
    let jwk = kid ? keys.find((k) => k.kid === kid) : keys[0];
    if (!jwk) {
      // Unknown kid: the project may have rotated signing keys.
      keys = await fetchJwks(true);
      jwk = kid ? keys.find((k) => k.kid === kid) : keys[0];
    }
    if (jwk) return verifyWithJwk(token, jwk);
  }
  return null;
}
