import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt password hashing: scrypt$N$salt$hash */
export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  const salt = randomBytes(16).toString("hex");
  const N = 16384;
  const hash = scryptSync(password, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${salt}$${hash.toString("hex")}`;
}

export function verifyPassword(stored: string | null | undefined, password: string): boolean {
  if (!stored) return false;
  const [scheme, cost, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const N = Number(cost) || 16384;
  const derived = scryptSync(password, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
