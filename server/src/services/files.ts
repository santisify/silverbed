import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files, folders, users } from "../db/schema";
import { badRequest, forbidden, notFound, tooMany } from "../lib/http";
import { extOf, mimeForExt, safeName } from "../lib/format";
import { newId, sha256 } from "../lib/ids";
import { getInt, getSetting } from "../db/settings";
import { config } from "../config";
import { keyFor, storage } from "./storage";
import { inspect, makeVariant } from "./image";

export interface StoredFile {
  id: string;
  shortId: string;
  name: string;
  ext: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  hash: string;
  thumbKey: string | null;
  previewKey: string | null;
  storageKey: string;
  uploadedVia: string;
  accessLevel: string;
  deduplicated: boolean;
  url: string;
  thumbUrl: string | null;
  previewUrl: string | null;
  pageUrl: string;
  markdown: string;
  html: string;
  createdAt: Date;
}

export const shortIdOf = (id: string) => id.slice(0, 8);

function buildUrls(id: string, ext: string, thumbKey: string | null, previewKey: string | null) {
  const base = config.publicBaseUrl;
  return {
    url: `${base}/i/${id}.${ext}`,
    thumbUrl: thumbKey ? `${base}/i/${id}.thumb.webp` : null,
    previewUrl: previewKey ? `${base}/i/${id}.preview.webp` : null,
    pageUrl: `${base}/image/${id}`,
    markdown: `![${id}](${base}/i/${id}.${ext})`,
    html: `<img src="${base}/i/${id}.${ext}" alt="" />`,
  };
}

export interface UploadOptions {
  userId: string;
  bytes: Uint8Array;
  originalName: string;
  folderId?: string | null;
  accessLevel?: string;
  description?: string;
  uploadedVia?: string;
  apiKeyId?: string | null;
  expiresAt?: Date | null;
  /**
   * Set when the browser already pushed the original straight to the bucket:
   * the bytes are re-used for thumbnails but not written a second time.
   */
  existing?: { id: string; storageKey: string };
}

export async function storeUpload(opts: UploadOptions): Promise<StoredFile> {
  const db = getDb();
  const name = safeName(opts.originalName);
  const ext = extOf(name) || "bin";
  const mime = mimeForExt(ext);

  const maxMb = await getInt("max_upload_mb", config.maxUploadMb);
  if (opts.bytes.byteLength > maxMb * 1024 * 1024) {
    throw badRequest(`file exceeds the ${maxMb} MB upload limit`);
  }

  const user = (await db.select().from(users).where(eq(users.id, opts.userId)).limit(1))[0];
  if (!user) throw notFound("account not found");
  if (user.storageQuota > 0 && user.storageUsed + opts.bytes.byteLength > user.storageQuota) {
    throw tooMany("storage quota exceeded");
  }

  const hash = sha256(opts.bytes);
  const duplicate = (
    await db
      .select()
      .from(files)
      .where(and(eq(files.userId, opts.userId), eq(files.hash, hash), isNull(files.deletedAt)))
      .limit(1)
  )[0];

  if (duplicate) {
    if (opts.existing) await storage().remove(opts.existing.storageKey).catch(() => {});
    const urls = buildUrls(duplicate.id, duplicate.ext, duplicate.thumbKey, duplicate.previewKey);
    return {
      id: duplicate.id,
      shortId: shortIdOf(duplicate.id),
      name: duplicate.name,
      ext: duplicate.ext,
      mime: duplicate.mime,
      size: duplicate.size,
      width: duplicate.width,
      height: duplicate.height,
      hash,
      storageKey: duplicate.storageKey,
      thumbKey: duplicate.thumbKey,
      previewKey: duplicate.previewKey,
      deduplicated: true,
      uploadedVia: duplicate.uploadedVia,
      accessLevel: duplicate.accessLevel,
      createdAt: duplicate.createdAt,
      ...urls,
    };
  }

  const id = opts.existing?.id ?? newId();
  const info = await inspect(opts.bytes, ext);
  const watermark = await getSetting("watermark_text");
  const thumbSize = await getInt("thumb_size", 520);
  const previewSize = await getInt("preview_size", 1600);

  const storageKey = opts.existing?.storageKey ?? keyFor(opts.userId, id, "orig", ext);
  const store = storage();
  if (!opts.existing) await store.put(storageKey, opts.bytes, mime);

  let thumbKey: string | null = null;
  let previewKey: string | null = null;
  if (info) {
    const thumb = await makeVariant(opts.bytes, { size: thumbSize, quality: 80, watermark: watermark || undefined });
    if (thumb) {
      thumbKey = keyFor(opts.userId, id, "thumb", "webp");
      await store.put(thumbKey, thumb, "image/webp");
    }
    if (info.width > thumbSize) {
      const preview = await makeVariant(opts.bytes, {
        size: previewSize,
        quality: 84,
        watermark: watermark || undefined,
      });
      if (preview) {
        previewKey = keyFor(opts.userId, id, "preview", "webp");
        await store.put(previewKey, preview, "image/webp");
      }
    }
  }

  const row = {
    id,
    userId: opts.userId,
    folderId: opts.folderId ?? null,
    name,
    ext,
    mime,
    hash,
    size: opts.bytes.byteLength,
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    exif: (info?.exif as Record<string, unknown> | undefined) ?? null,
    storage: store.name,
    storageKey,
    thumbKey,
    previewKey,
    accessLevel: opts.accessLevel === "private" ? "private" : "public",
    status: "active",
    description: opts.description ?? null,
    uploadedVia: opts.uploadedVia ?? "web",
    apiKeyId: opts.apiKeyId ?? null,
    expiresAt: opts.expiresAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(files).values(row);
  await db
    .update(users)
    .set({
      storageUsed: sql`${users.storageUsed} + ${opts.bytes.byteLength}`,
      fileCount: sql`${users.fileCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, opts.userId));
  if (row.folderId) {
    await db
      .update(folders)
      .set({ fileCount: sql`${folders.fileCount} + 1` })
      .where(eq(folders.id, row.folderId));
  }

  return {
    id,
    shortId: shortIdOf(id),
    name,
    ext,
    mime,
    size: row.size,
    width: row.width,
    height: row.height,
    hash,
    storageKey,
    thumbKey,
    previewKey,
    deduplicated: false,
    uploadedVia: row.uploadedVia,
    accessLevel: row.accessLevel,
    createdAt: row.createdAt,
    ...buildUrls(id, ext, thumbKey, previewKey),
  };
}

export async function ownedFile(userId: string, fileId: string, options: { includeTrashed?: boolean } = {}) {
  const row = (await getDb().select().from(files).where(eq(files.id, fileId)).limit(1))[0];
  if (!row) throw notFound("image not found");
  if (row.userId !== userId) throw forbidden("this image belongs to another account");
  if (row.deletedAt && !options.includeTrashed) throw notFound("image not found");
  return row;
}

export async function deleteFile(userId: string, fileId: string, hard = false) {
  const row = await ownedFile(userId, fileId, { includeTrashed: hard });
  const db = getDb();
  const store = storage();
  if (hard) {
    await store.remove(row.storageKey);
    if (row.thumbKey) await store.remove(row.thumbKey);
    if (row.previewKey) await store.remove(row.previewKey);
    await db.delete(files).where(eq(files.id, fileId));
  } else {
    await db.update(files).set({ deletedAt: new Date(), status: "trashed" }).where(eq(files.id, fileId));
  }
  await db
    .update(users)
    .set({
      storageUsed: sql`greatest(0, ${users.storageUsed} - ${row.size})`,
      fileCount: sql`greatest(0, ${users.fileCount} - 1)`,
    })
    .where(eq(users.id, userId));
  if (row.folderId) {
    await db
      .update(folders)
      .set({ fileCount: sql`greatest(0, ${folders.fileCount} - 1)` })
      .where(eq(folders.id, row.folderId));
  }
  return row;
}

/** Lists trashed files (used by the trash view and the retention job). */
export async function listTrash(userId: string) {
  return getDb()
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.status, "trashed")))
    .orderBy(desc(files.deletedAt));
}

export async function restoreFile(userId: string, fileId: string) {
  const row = await ownedFile(userId, fileId, { includeTrashed: true });
  const db = getDb();
  await db.update(files).set({ deletedAt: null, status: "active" }).where(eq(files.id, row.id));
  await db
    .update(users)
    .set({ storageUsed: sql`${users.storageUsed} + ${row.size}`, fileCount: sql`${users.fileCount} + 1` })
    .where(eq(users.id, userId));
  return row;
}
