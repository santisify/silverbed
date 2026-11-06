import type { Context } from "elysia";
import { config } from "../config";
import { hexHmac } from "../lib/ids";

const TTL_MS = 12 * 60 * 60 * 1000;

/** Share unlock cookie: <shareId>.<expiry>.<hmac>. */
export function signAccessToken(shareId: string, token: string): string {
  const expiry = Date.now() + TTL_MS;
  const sig = hexHmac(config.jwtSecret, `${shareId}.${expiry}.${token}`);
  return `${shareId}.${expiry}.${sig}`;
}

export function verifyAccessToken(value: string, shareId: string, token: string): boolean {
  const [id, expiryRaw, sig] = value.split(".");
  if (!id || !expiryRaw || !sig) return false;
  if (id !== shareId) return false;
  if (Number(expiryRaw) < Date.now()) return false;
  return hexHmac(config.jwtSecret, `${id}.${expiryRaw}.${token}`) === sig;
}

/** Reads the unlock cookie from a request. */
export function parseAccessToken(ctx: Context): { shareId: string } | null {
  const cookie = ctx.request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)sb_share=([^;]+)/);
  if (!match) return null;
  const [shareId] = decodeURIComponent(match[1]!).split(".");
  return shareId ? { shareId } : null;
}

export function shareCookieHeader(shareId: string, token: string): string {
  const value = signAccessToken(shareId, token);
  return `sb_share=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`;
}
