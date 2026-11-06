import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomId(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const newId = () => randomId(20);
export const newToken = () => randomId(16).toLowerCase();
export const newShortId = () => randomId(8);

export const sha256 = (input: string | Uint8Array) =>
  createHash("sha256").update(input as never).digest("hex");

export const hmac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest();

export const hexHmac = (secret: string, payload: string) => hmac(secret, payload).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Opaque API key: sb_<prefix>_<secret>. */
export function newApiKey() {
  const prefix = randomId(6);
  const secret = randomId(30);
  return { full: `sb_${prefix}_${secret}`, prefix, hash: sha256(`sb_${prefix}_${secret}`) };
}
