import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { newId } from "../lib/ids";

const GUEST_USERNAME = "guest";

/** Returns the reserved guest account id, creating it on first use. */
export async function SITE_GUEST_USER(): Promise<string> {
  const db = getDb();
  const existing = (await db.select().from(users).where(eq(users.username, GUEST_USERNAME)).limit(1))[0];
  if (existing) return existing.id;
  const id = newId();
  await db.insert(users).values({
    id,
    username: GUEST_USERNAME,
    email: null,
    passwordHash: null,
    role: "user",
    status: "active",
    provider: "guest",
    defaultAccess: "public",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}
