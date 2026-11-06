import type { Context } from "elysia";
import { config } from "../config";
import { resolveApiKey, userFromToken, type ApiUser } from "../services/auth";
import { tooMany, unauthorized } from "../lib/http";

export interface RequestMeta {
  ip: string;
  userAgent: string;
  referer: string;
}

export function requestMeta(ctx: Context): RequestMeta {
  const headers = ctx.request.headers;
  const forwarded = headers.get("x-forwarded-for");
  return {
    ip: (forwarded ? forwarded.split(",")[0]!.trim() : headers.get("x-real-ip")) || ctx.server?.requestIP(ctx.request)?.address || "127.0.0.1",
    userAgent: headers.get("user-agent") ?? "",
    referer: headers.get("referer") ?? "",
  };
}

function bearer(ctx: Context): string | null {
  const header = ctx.request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme?.toLowerCase() !== "bearer") return null;
  return value.trim();
}

/** Resolves the acting user from an API key, a local JWT or a Supabase token. */
export async function currentUser(ctx: Context): Promise<ApiUser | null> {
  const accessKey = ctx.request.headers.get("x-access-key");
  if (accessKey) {
    const resolved = await resolveApiKey(accessKey);
    if (resolved) return resolved.owner;
    throw unauthorized("invalid access key");
  }
  const token = bearer(ctx);
  if (!token) return null;
  if (token.startsWith("sb_")) {
    const resolved = await resolveApiKey(token);
    return resolved?.owner ?? null;
  }
  const resolved = await userFromToken(token);
  return resolved?.user ?? null;
}

export async function activeApiKey(ctx: Context) {
  const accessKey = ctx.request.headers.get("x-access-key");
  if (!accessKey) return null;
  return (await resolveApiKey(accessKey))?.key ?? null;
}

export function clientIp(ctx: Context): string {
  return requestMeta(ctx).ip;
}

/** Simple fixed-window limiter; process-local by design (no Redis dependency). */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  // Disabled for automated suites: repeated runs would otherwise lock themselves out.
  if (!config.rateLimit) return;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw tooMany(`rate limit reached, try again in ${Math.ceil((bucket.reset - now) / 1000)}s`);
  }
  bucket.count++;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key);
}, 60_000).unref?.();

export function originAllowed(referer: string, allowedRaw: string): boolean {
  if (!allowedRaw.trim()) return true;
  if (!referer) return false;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  const self = new URL(config.publicBaseUrl).hostname.toLowerCase();
  if (host === self || host === "localhost" || host === "127.0.0.1") return true;
  return allowedRaw
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean)
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}
