import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { mkdirSync, readFileSync } from "node:fs";
import { config, pglitePath } from "../config";
import * as schema from "./schema";

/**
 * TLS options for a remote Postgres, or undefined to defer to the connection
 * string (postgres.js honours `?sslmode=`). Passing an explicit `ssl` key
 * overrides the URL, so we only set it when the operator asked for it.
 */
export function sslOptions(): false | "require" | { rejectUnauthorized: boolean; ca?: string } | undefined {
  const mode = config.databaseSsl;
  if (!mode) return undefined;
  if (mode === "disable") return false;
  if (mode === "require") return "require";
  // verify-full: validate the certificate chain against a private CA if given.
  const ca = config.databaseSslCa
    ? config.databaseSslCa.includes("-----BEGIN")
      ? config.databaseSslCa
      : readFileSync(config.databaseSslCa, "utf8")
    : undefined;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;

let db: Database;
let driver: "postgres" | "pglite";
let pglite: PGlite | undefined;
let pgClient: ReturnType<typeof postgres> | undefined;

const ddl = `
create table if not exists users (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  username text not null,
  email text,
  password_hash text,
  role text not null default 'user',
  status text not null default 'active',
  avatar_url text,
  provider text not null default 'local',
  external_id text,
  storage_quota bigint not null default 0,
  storage_used bigint not null default 0,
  file_count bigint not null default 0,
  default_access text not null default 'public',
  last_login_at timestamptz
);
create unique index if not exists users_username_uq on users (username);
create index if not exists users_email_idx on users (email);
create index if not exists users_provider_idx on users (provider, external_id);

create table if not exists folders (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id text not null,
  parent_id text,
  name text not null,
  access_level text not null default 'private',
  sort_order integer not null default 0,
  file_count integer not null default 0
);
create index if not exists folders_user_idx on folders (user_id);
create index if not exists folders_parent_idx on folders (parent_id);

create table if not exists files (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id text not null,
  folder_id text,
  name text not null,
  ext text not null,
  mime text not null,
  hash text not null,
  size bigint not null,
  width integer not null default 0,
  height integer not null default 0,
  storage text not null default 'local',
  storage_key text not null,
  thumb_key text,
  preview_key text,
  access_level text not null default 'public',
  access_key text,
  status text not null default 'active',
  description text,
  views bigint not null default 0,
  downloads bigint not null default 0,
  expires_at timestamptz,
  uploaded_via text not null default 'web',
  api_key_id text,
  duplicate_of text,
  ai_tags text,
  exif jsonb
);
create index if not exists files_user_idx on files (user_id);
create index if not exists files_folder_idx on files (folder_id);
create index if not exists files_hash_idx on files (hash);
create index if not exists files_created_idx on files (created_at);
create index if not exists files_status_idx on files (status);
-- Columns added after the first release need a nudge on existing databases:
-- create table if not exists leaves older tables untouched.
alter table files add column if not exists exif jsonb;

create table if not exists tags (
  id text primary key,
  created_at timestamptz not null default now(),
  user_id text not null,
  name text not null,
  color text not null default 'slate',
  file_count integer not null default 0
);
create unique index if not exists tags_user_name_uq on tags (user_id, name);

create table if not exists file_tags (
  file_id text not null,
  tag_id text not null,
  primary key (file_id, tag_id)
);
create index if not exists file_tags_tag_idx on file_tags (tag_id);

create table if not exists shares (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  token text not null,
  user_id text not null,
  title text not null default '',
  kind text not null default 'files',
  folder_id text,
  password_hash text,
  expires_at timestamptz,
  allow_download boolean not null default true,
  view_count bigint not null default 0,
  download_count bigint not null default 0,
  revoked boolean not null default false
);
create unique index if not exists shares_token_uq on shares (token);
create index if not exists shares_user_idx on shares (user_id);

create table if not exists share_items (
  id text primary key,
  share_id text not null,
  file_id text not null,
  sort_order integer not null default 0
);
create index if not exists share_items_share_idx on share_items (share_id);

create table if not exists share_access_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  share_id text not null,
  ip text,
  user_agent text,
  referer text,
  unlocked boolean not null default false
);
create index if not exists share_logs_share_idx on share_access_logs (share_id);

create table if not exists api_keys (
  id text primary key,
  created_at timestamptz not null default now(),
  user_id text not null,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes text not null default 'upload,read',
  enabled boolean not null default true,
  revoked_at timestamptz,
  last_used_at timestamptz,
  upload_count bigint not null default 0
);
create unique index if not exists api_keys_hash_uq on api_keys (key_hash);
create index if not exists api_keys_user_idx on api_keys (user_id);

create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists access_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  file_id text,
  user_id text,
  kind text not null default 'view',
  ip text,
  referer text,
  user_agent text,
  bytes bigint not null default 0
);
create index if not exists access_logs_file_idx on access_logs (file_id);
create index if not exists access_logs_time_idx on access_logs (created_at);

create table if not exists activity_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  user_id text,
  username text,
  action text not null,
  target text,
  detail text,
  ip text
);
create index if not exists activity_time_idx on activity_logs (created_at);

create table if not exists mail_logs (
  id text primary key,
  created_at timestamptz not null default now(),
  to_addr text not null,
  subject text not null,
  body text not null,
  transport text not null default 'console',
  error text
);
create index if not exists mail_logs_time_idx on mail_logs (created_at);

create table if not exists oauth_states (
  state text primary key,
  created_at timestamptz not null default now(),
  provider text not null,
  redirect text
);
`;

/** Opens the database (Supabase/Postgres when DATABASE_URL is set, embedded PGlite otherwise). */
export async function connect(): Promise<Database> {
  if (config.databaseUrl.startsWith("postgres")) {
    driver = "postgres";
    const client = postgres(config.databaseUrl, {
      max: 8,
      // Transaction-mode poolers (Supavisor :6543) cannot hold prepared statements.
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => {},
      ...(sslOptions() === undefined ? {} : { ssl: sslOptions() }),
    });
    pgClient = client;
    db = drizzlePg(client, { schema }) as unknown as Database;
  } else {
    if (process.env.VERCEL) {
      throw new Error(
        "DATABASE_URL is required on Vercel — the embedded PGlite database cannot persist inside a serverless function. Point it at a hosted Postgres (Neon, Supabase, …).",
      );
    }
    driver = "pglite";
    // Always back the embedded database with a directory: an in-memory PGlite
    // would lose every account and upload on restart.
    const dir = pglitePath();
    mkdirSync(dir, { recursive: true });
    pglite = new PGlite(dir);
    try {
      // PGlite is single-process: opening a directory another process holds
      // aborts inside WASM with an opaque message. Surface the real cause.
      await pglite.waitReady;
    } catch (err) {
      throw new Error(
        `the embedded database at ${dir} is locked by another process.\n` +
          "PGlite serves one process at a time — stop the running server, or point\n" +
          "DATABASE_URL at a Postgres instance, then retry.\n\n" +
          (err as Error).message,
      );
    }
    db = drizzlePglite(pglite, { schema }) as unknown as Database;
  }
  // The bootstrap DDL holds many statements; PGlite/postgres.js both need an
  // unparameterised exec rather than a prepared statement.
  if (driver === "pglite") {
    await pglite!.exec(ddl);
  } else {
    await pgClient!.unsafe(ddl);
  }
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error("database not connected — call connect() first");
  return db;
}

export function dbDriver() {
  return driver;
}

export * as schema from "./schema";
