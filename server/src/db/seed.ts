/**
 * Seeds a demo instance: admin account, folders, tags, sample images and a
 * share link. Safe to run repeatedly — existing records are reused.
 *
 *   bun src/db/seed.ts
 */
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { connect } from ".";
import { files, folders, users } from "./schema";
import { seedSettings } from "./settings";
import { hashPassword } from "../lib/password";
import { newId } from "../lib/ids";
import { storeUpload } from "../services/files";
import { createApiKey } from "../services/auth";
import { syncFileTags } from "../routes/files";

const ADMIN_USER = process.env.SEED_USER ?? "admin";
const ADMIN_PASS = process.env.SEED_PASSWORD ?? "silverbed123";

interface Sample {
  name: string;
  folder: string;
  width: number;
  height: number;
  bg: string;
  fg: string;
  tags: string[];
}

const SAMPLES: Sample[] = [
  { name: "harbour-dawn.jpg", folder: "Field notes", width: 2400, height: 1600, bg: "#0e1b24", fg: "#e9b259", tags: ["landscape", "select"] },
  { name: "basalt-columns.jpg", folder: "Field notes", width: 1600, height: 2000, bg: "#1b1d1f", fg: "#9fb4c7", tags: ["landscape"] },
  { name: "salt-flats.png", folder: "Field notes/Roll 01", width: 2000, height: 1200, bg: "#2a2f36", fg: "#dfe6ee", tags: ["landscape", "select"] },
  { name: "studio-portrait-01.jpg", folder: "Studio", width: 1400, height: 1800, bg: "#241a21", fg: "#e0785f", tags: ["portrait"] },
  { name: "studio-portrait-02.jpg", folder: "Studio", width: 1400, height: 1800, bg: "#1d2129", fg: "#c7b6a0", tags: ["portrait"] },
  { name: "product-lamp.webp", folder: "Studio/Product", width: 1800, height: 1800, bg: "#14181c", fg: "#8fd0c0", tags: ["product"] },
  { name: "product-chair.webp", folder: "Studio/Product", width: 1800, height: 1200, bg: "#171a1e", fg: "#b9a07f", tags: ["product"] },
  { name: "texture-grain.png", folder: "Textures", width: 1200, height: 1200, bg: "#202225", fg: "#7f8894", tags: ["texture"] },
  { name: "texture-linen.png", folder: "Textures", width: 1200, height: 1200, bg: "#232019", fg: "#a89b7a", tags: ["texture"] },
  { name: "sky-gradient.jpg", folder: "", width: 2600, height: 1400, bg: "#101823", fg: "#6fa0d4", tags: ["background"] },
];

async function plate(sample: Sample): Promise<Uint8Array> {
  const { width: w, height: h, bg, fg } = sample;
  const overlay = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <circle cx="${w * 0.5}" cy="${h * 0.46}" r="${Math.min(w, h) * 0.28}" fill="${fg}" opacity="0.85"/>
    <rect x="${w * 0.08}" y="${h * 0.82}" width="${w * 0.84}" height="${Math.max(2, h * 0.006)}" fill="${fg}" opacity="0.5"/>
  </svg>`;
  const pipeline = sharp(Buffer.from(overlay)).jpeg({ quality: 88 });
  const buf = await pipeline.toBuffer();
  if (sample.name.endsWith(".png")) return sharp(buf).png().toBuffer();
  if (sample.name.endsWith(".webp")) return sharp(buf).webp({ quality: 86 }).toBuffer();
  return buf;
}

async function ensureFolder(userId: string, path: string): Promise<string | null> {
  if (!path) return null;
  let parentId: string | null = null;
  for (const part of path.split("/")) {
    const existing = (
      await (await import("../db")).getDb()
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
    ).find((f) => f.name === part && f.parentId === parentId);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const id = newId();
    await (await import("../db")).getDb().insert(folders).values({
      id,
      userId,
      parentId,
      name: part,
      accessLevel: "private",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    parentId = id;
  }
  return parentId;
}

async function main() {
  await connect();
  await seedSettings();
  const { getDb } = await import("../db");
  const db = getDb();

  let admin = (await db.select().from(users).where(eq(users.username, ADMIN_USER)).limit(1))[0];
  if (!admin) {
    const id = newId();
    await db.insert(users).values({
      id,
      username: ADMIN_USER,
      email: "admin@silverbed.local",
      passwordHash: hashPassword(ADMIN_PASS),
      role: "admin",
      status: "active",
      provider: "local",
      defaultAccess: "public",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    admin = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]!;
    console.log(`created admin ${ADMIN_USER} / ${ADMIN_PASS}`);
  } else {
    console.log(`admin ${ADMIN_USER} already exists`);
  }

  const existing = await db.select({ id: files.id }).from(files).where(eq(files.userId, admin.id));
  if (existing.length >= SAMPLES.length) {
    console.log(`demo library already seeded (${existing.length} files)`);
    process.exit(0);
  }

  for (const sample of SAMPLES) {
    const folderId = await ensureFolder(admin.id, sample.folder);
    const bytes = await plate(sample);
    const stored = await storeUpload({
      userId: admin.id,
      bytes,
      originalName: sample.name,
      folderId,
      accessLevel: "public",
      uploadedVia: "web",
    });
    await syncFileTags(stored.id, admin.id, sample.tags);
    console.log(`  + ${sample.name} → ${stored.url}`);
  }

  const keys = await db.select().from(await import("./schema").then((m) => m.apiKeys)).where(eq((await import("./schema").then((m) => m.apiKeys)).userId, admin.id));
  if (!keys.length) {
    const key = await createApiKey(admin.id, "Demo pipeline key", "upload,read");
    console.log(`created API key: ${key.secret}`);
  }

  console.log(`\nseed complete — sign in as ${ADMIN_USER} / ${ADMIN_PASS}`);
  process.exit(0);
}

await main();
