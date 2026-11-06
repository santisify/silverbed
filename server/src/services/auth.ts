import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { getDb } from "../db";
import { apiKeys, users } from "../db/schema";
import { unauthorized } from "../lib/http";
import { newApiKey, newId, sha256 } from "../lib/ids";
import { verifySupabaseToken, verifyToken } from "../lib/jwt";

export interface ApiUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  provider: string;
  defaultAccess: string;
  storageQuota: number;
  storageUsed: number;
  fileCount: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export function toApiUser(row: typeof users.$inferSelect): ApiUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatarUrl,
    provider: row.provider,
    defaultAccess: row.defaultAccess,
    storageQuota: row.storageQuota,
    storageUsed: row.storageUsed,
    fileCount: row.fileCount,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

export async function findUserById(id: string) {
  return (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0] ?? null;
}

export async function findUserByName(username: string) {
  const needle = username.trim().toLowerCase();
  return (
    (await getDb().select().from(users).where(eq(users.username, needle)).limit(1))[0] ??
    (await getDb().select().from(users).where(eq(users.email, needle)).limit(1))[0] ??
    null
  );
}

export async function userCount(): Promise<number> {
  const rows = await getDb().select({ n: users.id }).from(users).limit(1);
  return rows.length;
}

/** Resolves a bearer token to an active user (our own JWT or a Supabase access token). */
export async function userFromToken(token: string | undefined | null) {
  if (!token) return null;

  // 1. Our own tokens.
  if (config.authMode !== "supabase") {
    const claims = verifyToken(token, config.jwtSecret);
    if (claims) {
      const row = await findUserById(String(claims.sub));
      if (row && row.status === "active") return { user: row, via: "jwt" as const };
      return null;
    }
  }

  // 2. Supabase access tokens (HS256 secret or RS256/ES256 via JWKS).
  if (config.authMode === "supabase" || config.authMode === "both") {
    const claims = await verifySupabaseToken(token);
    if (claims) {
      const row = await findUserById(String(claims.sub));
      if (row && row.status === "active") return { user: row, via: "supabase" as const };
      if (row && row.status !== "active") return null;

      // First sight of this Supabase account: provision a local mirror row.
      const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
      const email = typeof claims.email === "string" ? claims.email : undefined;
      const username =
        (typeof meta.username === "string" && meta.username) ||
        (typeof meta.preferred_username === "string" && meta.preferred_username) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        email?.split("@")[0] ||
        `user_${String(claims.sub).slice(0, 6)}`;
      const avatarUrl =
        (typeof meta.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta.picture === "string" && meta.picture) ||
        undefined;
      const created = await ensureExternalUser({
        externalId: String(claims.sub),
        email,
        username,
        avatarUrl,
        provider: "supabase",
      });
      return { user: created, via: "supabase" as const };
    }
  }

  return null;
}

export async function ensureExternalUser(input: {
  externalId: string;
  email?: string;
  username: string;
  avatarUrl?: string;
  provider: string;
}) {
  const db = getDb();
  const existing = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.provider, input.provider), eq(users.externalId, input.externalId)))
      .limit(1)
  )[0];
  if (existing) return existing;

  let username = input.username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!username) username = `user_${input.externalId.slice(0, 6)}`;
  let candidate = username;
  let n = 1;
  while (await findUserByName(candidate)) candidate = `${username}${++n}`;

  const row = {
    id: newId(),
    username: candidate,
    email: input.email ?? null,
    passwordHash: null,
    role: "user",
    status: "active",
    avatarUrl: input.avatarUrl ?? null,
    provider: input.provider,
    externalId: input.externalId,
    defaultAccess: "public",
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(users).values(row);
  return (await findUserById(row.id))!;
}

export async function resolveApiKey(secret: string) {
  if (!secret.startsWith("sb_")) return null;
  const hash = sha256(secret);
  const key = (await getDb().select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1))[0];
  if (!key || !key.enabled || key.revokedAt) return null;
  const owner = await findUserById(key.userId);
  if (!owner || owner.status !== "active") return null;
  await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return { key, owner };
}

export async function createApiKey(userId: string, name: string, scopes = "upload,read") {
  const { full, prefix, hash } = newApiKey();
  const row = {
    id: newId(),
    userId,
    name: name.trim() || "Untitled key",
    prefix,
    keyHash: hash,
    scopes,
    enabled: true,
    createdAt: new Date(),
  };
  await getDb().insert(apiKeys).values(row);
  return { ...row, secret: full };
}

export function requireUser(user: ApiUser | null): ApiUser {
  if (!user) throw unauthorized();
  return user;
}
