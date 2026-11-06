import { Elysia, t } from "elysia";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, fileTags, files, folders, tags } from "../db/schema";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { humanSize } from "../lib/format";
import { logActivity } from "../services/activity";
import { deleteFile, ownedFile, restoreFile, storeUpload } from "../services/files";
import { activeApiKey, currentUser, rateLimit } from "../middleware/context";
import { handleError, ok, paged } from "../http/respond";
import { readForm } from "../http/form";
import type { Context } from "elysia";

const meta = (ctx: Context) => ({
  ip: (ctx.request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "127.0.0.1",
  userAgent: ctx.request.headers.get("user-agent") ?? "",
  referer: ctx.request.headers.get("referer") ?? "",
});

export function serializeFile(row: typeof files.$inferSelect, tagList: { id: string; name: string; color: string }[] = []) {
  return {
    id: row.id,
    name: row.name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    sizeHuman: humanSize(row.size),
    width: row.width,
    height: row.height,
    hash: row.hash,
    folderId: row.folderId,
    accessLevel: row.accessLevel,
    status: row.status,
    description: row.description,
    views: row.views,
    downloads: row.downloads,
    storage: row.storage,
    hasThumb: Boolean(row.thumbKey),
    hasPreview: Boolean(row.previewKey),
    uploadedVia: row.uploadedVia,
    apiKeyId: row.apiKeyId,
    exif: row.exif ?? null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    tags: tagList,
  };
}

export async function tagsForFiles(fileIds: string[]) {
  if (!fileIds.length) return new Map<string, { id: string; name: string; color: string }[]>();
  const rows = await getDb()
    .select({ fileId: fileTags.fileId, id: tags.id, name: tags.name, color: tags.color })
    .from(fileTags)
    .innerJoin(tags, eq(tags.id, fileTags.tagId))
    .where(inArray(fileTags.fileId, fileIds));
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  for (const row of rows) {
    const list = map.get(row.fileId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.fileId, list);
  }
  return map;
}

export async function syncFileTags(fileId: string, userId: string, names: string[]) {
  const db = getDb();
  await db.delete(fileTags).where(eq(fileTags.fileId, fileId));
  const clean = [...new Set(names.map((n) => n.trim().slice(0, 32)).filter(Boolean))];
  for (const name of clean) {
    const existing = (await db.select().from(tags).where(and(eq(tags.userId, userId), eq(tags.name, name))).limit(1))[0];
    let tagId = existing?.id;
    if (!tagId) {
      tagId = `tag_${Math.random().toString(36).slice(2, 12)}`;
      await db.insert(tags).values({ id: tagId, userId, name, color: "slate", createdAt: new Date() });
    }
    await db.insert(fileTags).values({ fileId, tagId }).onConflictDoNothing();
    await db
      .update(tags)
      .set({ fileCount: sql`(select count(*) from file_tags ft where ft.tag_id = ${tagId})` })
      .where(eq(tags.id, tagId));
  }
}

export const fileRoutes = new Elysia({ prefix: "/api/v1/files" })
  .post("/upload", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const requestMeta = meta(ctx);
      rateLimit(`upload:${user.id}`, 600, 60 * 60 * 1000);

      const form = await readForm(ctx);
      const entries = form.files;
      if (!entries.length) throw badRequest("no files were provided (use the `files` form field)");

      const folderId = form.text("folderId")?.trim() || null;
      if (folderId) {
        const folder = (await getDb().select().from(folders).where(eq(folders.id, folderId)).limit(1))[0];
        if (!folder || folder.userId !== user.id) throw notFound("target folder not found");
      }
      const accessLevel = (form.text("accessLevel") || user.defaultAccess) === "private" ? "private" : "public";
      const description = (form.text("description") || "").slice(0, 500) || undefined;
      const tagNames = (form.text("tags") || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const days = Number(form.text("expiresInDays") || 0);
      const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
      const key = await activeApiKey(ctx);

      const results = [];
      for (const entry of entries) {
        const bytes = new Uint8Array(await entry.arrayBuffer());
        const stored = await storeUpload({
          userId: user.id,
          bytes,
          originalName: entry.name,
          folderId,
          accessLevel,
          description,
          expiresAt,
          uploadedVia: key ? "api" : "web",
          apiKeyId: key?.id ?? null,
        });
        if (tagNames.length && !stored.deduplicated) await syncFileTags(stored.id, user.id, tagNames);
        results.push(stored);
      }
      if (key) {
        await getDb()
          .update(apiKeys)
          .set({ uploadCount: sql`${apiKeys.uploadCount} + ${results.length}` })
          .where(eq(apiKeys.id, key.id));
      }
      await logActivity("file.upload", { id: user.id, username: user.username, ip: requestMeta.ip }, `${results.length} file(s)`);
      return ok({ files: results, deduplicated: results.filter((r) => r.deduplicated).length });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const q = ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 40));
      const db = getDb();

      const conditions = [eq(files.userId, user.id)];
      const scope = q.scope ?? "active";
      if (scope === "trash") conditions.push(isNotNull(files.deletedAt));
      else conditions.push(isNull(files.deletedAt));
      if (q.folderId) conditions.push(eq(files.folderId, q.folderId));
      if (q.folderId === "root") conditions.push(isNull(files.folderId));
      if (q.access === "public" || q.access === "private") conditions.push(eq(files.accessLevel, q.access));
      if (q.ext) conditions.push(eq(files.ext, q.ext.toLowerCase()));
      if (q.q) {
        const needle = `%${q.q}%`;
        conditions.push(or(ilike(files.name, needle), ilike(files.description, needle))!);
      }
      if (q.tag) {
        const tagRow = (await db.select().from(tags).where(and(eq(tags.userId, user.id), eq(tags.name, q.tag))).limit(1))[0];
        if (!tagRow) return paged([], 0, page, pageSize);
        const tagged = await db.select({ fileId: fileTags.fileId }).from(fileTags).where(eq(fileTags.tagId, tagRow.id));
        const ids = tagged.map((t) => t.fileId);
        if (!ids.length) return paged([], 0, page, pageSize);
        conditions.push(inArray(files.id, ids));
      }

      const where = and(...conditions)!;
      const sortMap: Record<string, ReturnType<typeof desc>> = {
        newest: desc(files.createdAt),
        oldest: asc(files.createdAt),
        name: asc(files.name),
        size: desc(files.size),
        views: desc(files.views),
      };
      const order = sortMap[q.sort ?? "newest"] ?? desc(files.createdAt);

      const rows = await db.select().from(files).where(where).orderBy(order).limit(pageSize).offset((page - 1) * pageSize);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(files).where(where);
      const tagMap = await tagsForFiles(rows.map((r) => r.id));
      return paged(rows.map((r) => serializeFile(r, tagMap.get(r.id) ?? [])), Number(count), page, pageSize);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/stats", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const db = getDb();
      const [totals] = await db
        .select({
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size),0)::bigint`,
          views: sql<number>`coalesce(sum(views),0)::bigint`,
          downloads: sql<number>`coalesce(sum(downloads),0)::bigint`,
        })
        .from(files)
        .where(and(eq(files.userId, user.id), isNull(files.deletedAt)));
      const formats = await db
        .select({ ext: files.ext, count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(size),0)::bigint` })
        .from(files)
        .where(and(eq(files.userId, user.id), isNull(files.deletedAt)))
        .groupBy(files.ext)
        .orderBy(desc(sql`count(*)`));
      return ok({
        files: Number(totals?.count ?? 0),
        bytes: Number(totals?.bytes ?? 0),
        bytesHuman: humanSize(Number(totals?.bytes ?? 0)),
        views: Number(totals?.views ?? 0),
        downloads: Number(totals?.downloads ?? 0),
        formats,
        quota: user.storageQuota,
      });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post("/batch", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const body = ctx.body as { action: string; ids: string[]; value?: string };
      if (!body.ids?.length) throw badRequest("no files selected");
      const db = getDb();
      const owned = await db
        .select()
        .from(files)
        .where(and(eq(files.userId, user.id), inArray(files.id, body.ids)));
      if (!owned.length) throw notFound("none of the selected images exist");

      switch (body.action) {
        case "delete":
          for (const row of owned) if (!row.deletedAt) await deleteFile(user.id, row.id);
          break;
        case "purge":
          for (const row of owned) await deleteFile(user.id, row.id, true);
          break;
        case "restore":
          for (const row of owned) await restoreFile(user.id, row.id);
          break;
        case "move": {
          const target = body.value?.trim() || null;
          if (target) {
            const folder = (await db.select().from(folders).where(eq(folders.id, target)).limit(1))[0];
            if (!folder || folder.userId !== user.id) throw notFound("target folder not found");
          }
          await db.update(files).set({ folderId: target, updatedAt: new Date() }).where(inArray(files.id, owned.map((r) => r.id)));
          break;
        }
        case "access": {
          const level = body.value === "private" ? "private" : "public";
          await db
            .update(files)
            .set({ accessLevel: level, updatedAt: new Date() })
            .where(inArray(files.id, owned.map((r) => r.id)));
          break;
        }
        case "tag": {
          for (const row of owned) await syncFileTags(row.id, user.id, (body.value ?? "").split(","));
          break;
        }
        default:
          throw badRequest(`unsupported batch action: ${body.action}`);
      }
      await logActivity(`file.batch.${body.action}`, { id: user.id, username: user.username, ip: meta(ctx).ip }, `${owned.length} file(s)`);
      return ok({ affected: owned.length });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const row = await ownedFile(user.id, ctx.params.id);
      const tagMap = await tagsForFiles([row.id]);
      return ok(serializeFile(row, tagMap.get(row.id) ?? []));
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        const row = await ownedFile(user.id, ctx.params.id);
        const body = ctx.body as {
          name?: string;
          description?: string;
          accessLevel?: string;
          folderId?: string | null;
          tags?: string[];
        };
        const db = getDb();
        if (body.folderId) {
          const folder = (await db.select().from(folders).where(eq(folders.id, body.folderId)).limit(1))[0];
          if (!folder || folder.userId !== user.id) throw notFound("target folder not found");
        }
        await db
          .update(files)
          .set({
            name: body.name?.trim() ? body.name.trim().slice(0, 200) : row.name,
            description: body.description !== undefined ? body.description.slice(0, 1000) : row.description,
            accessLevel: body.accessLevel ? (body.accessLevel === "private" ? "private" : "public") : row.accessLevel,
            folderId: body.folderId === undefined ? row.folderId : body.folderId || null,
            updatedAt: new Date(),
          })
          .where(eq(files.id, row.id));
        if (body.tags) await syncFileTags(row.id, user.id, body.tags);
        const updated = await ownedFile(user.id, row.id);
        const tagMap = await tagsForFiles([row.id]);
        return ok(serializeFile(updated, tagMap.get(row.id) ?? []));
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        accessLevel: t.Optional(t.String()),
        folderId: t.Optional(t.Nullable(t.String())),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .delete("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const hard = (ctx.query as Record<string, string>).hard === "1";
      await deleteFile(user.id, ctx.params.id, hard);
      return ok({ deleted: true, purged: hard });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post("/:id/restore", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      await restoreFile(user.id, ctx.params.id);
      return ok({ restored: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
