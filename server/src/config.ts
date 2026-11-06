/** Runtime configuration resolved from the environment. */
import { resolve } from "node:path";

/** Resolve a possibly-relative path against the project root rather than the cwd. */
/** Directory of this file under ESM (Node/Vercel) or CJS (bundled) output. */
const here = typeof __dirname === "string" ? __dirname : import.meta.dirname;
const projectRoot = resolve(here, "../..");
const dirPath = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return resolve(projectRoot, raw === undefined || raw === "" ? fallback : raw);
};

const env = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};

const num = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const bool = (key: string, fallback = false): boolean => {
  const v = env(key);
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const config = {
  host: env("HOST", "127.0.0.1"),
  port: num("PORT", 8787),
  publicBaseUrl: env("PUBLIC_BASE_URL", `http://localhost:${num("PORT", 8787)}`).replace(/\/$/, ""),
  dataDir: dirPath("DATA_DIR", "./data"),
  webDist: env("WEB_DIST", "../web/dist"),
  allowOrigin: env("ALLOW_ORIGIN", "*"),
  maxUploadMb: num("MAX_UPLOAD_MB", 32),

  /** Postgres connection string (Supabase pooler). Empty => embedded PGlite. */
  databaseUrl: env("DATABASE_URL"),
  pgliteDir: process.env.PGLITE_DIR ? dirPath("PGLITE_DIR", "") : "",

  /**
   * TLS for a remote Postgres. Left empty => whatever the URL says (a plain
   * local socket keeps working without TLS). `require` encrypts without
   * verifying the certificate; `verify-full` verifies it against
   * DATABASE_SSL_CA or the system trust store — use that over an untrusted
   * network.
   */
  databaseSsl: env("DATABASE_SSL", "") as "" | "disable" | "require" | "verify-full",
  databaseSslCa: env("DATABASE_SSL_CA"),

  jwtSecret: env("JWT_SECRET", "silverbed-dev-secret-please-change-me"),
  jwtTtlSeconds: num("JWT_TTL_SECONDS", 60 * 60 * 24 * 7),

  /** local = own password auth; supabase = accept Supabase-issued access tokens; both = either. */
  authMode: env("AUTH_MODE", "local") as "local" | "supabase" | "both",
  supabaseUrl: env("SUPABASE_URL").replace(/\/$/, ""),
  /** Legacy HS256 shared secret (self-hosted: ANON_KEY/SERVICE_KEY JWT secret, or JWT_SECRET of supabase). */
  supabaseJwtSecret: env("SUPABASE_JWT_SECRET"),
  /** Modern asymmetric signing: JWKS endpoint, defaults to <SUPABASE_URL>/auth/v1/.well-known/jwks.json */
  supabaseJwksUrl: env("SUPABASE_JWKS_URL"),
  /** Publishable/anon key, used when the password grant is proxied through the API. */
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),
  /** Where password logins are verified: local (our scrypt) or supabase (GoTrue). */
  supabasePasswordLogin: bool("SUPABASE_PASSWORD_LOGIN", false),

  githubClientId: env("GITHUB_CLIENT_ID"),
  githubClientSecret: env("GITHUB_CLIENT_SECRET"),
  googleClientId: env("GOOGLE_CLIENT_ID"),
  googleClientSecret: env("GOOGLE_CLIENT_SECRET"),

  storageDriver: env("STORAGE_DRIVER", "local") as "local" | "s3",
  s3: {
    endpoint: env("S3_ENDPOINT"),
    region: env("S3_REGION", "auto"),
    bucket: env("S3_BUCKET"),
    accessKey: env("S3_ACCESS_KEY"),
    secretKey: env("S3_SECRET_KEY"),
    publicUrl: env("S3_PUBLIC_URL").replace(/\/$/, ""),
  },

  smtp: {
    host: env("SMTP_HOST"),
    port: num("SMTP_PORT", 587),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("SMTP_FROM", "Silverbed <no-reply@silverbed.local>"),
  },

  guestUpload: bool("GUEST_UPLOAD", false),
  /** Per-IP throttling on auth and upload endpoints. Disable for automated suites. */
  rateLimit: bool("RATE_LIMIT", true),
  seedDemo: bool("SEED_DEMO", true),
} as const;

export const isPostgres = () => config.databaseUrl.startsWith("postgres");

/**
 * Where the embedded database keeps its files. Defaults to `<DATA_DIR>/pglite`
 * so data survives restarts — an in-memory database would silently drop every
 * upload and account as soon as the process exits.
 */
export const pglitePath = () => config.pgliteDir || `${config.dataDir}/pglite`;
