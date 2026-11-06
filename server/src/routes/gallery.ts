import { Elysia } from "elysia";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files, folders, users } from "../db/schema";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { logActivity } from "../services/activity";
import { deleteFile, restoreFile } from "../services/files";
import { currentUser, requestMeta } from "../middleware/context";
import { handleError, ok, paged } from "../http/respond";
import { serializeFile, syncFileTags, tagsForFiles } from "./files";

/**
 * The shared "all images" sheet.
 *
 * Anonymous visitors see every public frame on the instance. A signed-in user
 * gets batch controls for the frames they uploaded; an administrator gets the
 * same controls for every frame, plus the shared trash. Nothing private is ever
 * listed here — private frames stay in their owner's library.
 */

const MAX_BATCH = 500;

async function ownersById(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, { id: string; username: string }>();
  const rows = await getDb()
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

function canManage(viewer: Awaited<ReturnType<typeof currentUser>>, ownerId: string) {
  return Boolean(viewer && (viewer.role === "admin" || viewer.id === ownerId));
}

export const galleryRoutes = new Elysia({ prefix: "/api/v1/gallery" })
  .get("/", async (ctx) => {
    try {
      const viewer = await currentUser(ctx).catch(() => null);
      const q = ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 24));
      const scope = q.scope === "trash" ? "trash" : "active";
      if (scope === "trash" && viewer?.role !== "admin") {
        throw forbidden("only administrators can review the shared trash");
      }

      const db = getDb();
      const conditions = [
        eq(files.accessLevel, "public"),
        scope === "trash" ? isNotNull(files.deletedAt) : isNull(files.deletedAt),
      ];
      if (scope === "active") {
        // Expired frames are served as 410, so they have no place on the sheet.
        conditions.push(or(isNull(files.expiresAt), sql`${files.expiresAt} > now()`)!);
      }
      if (q.q) {
        const needle = `%${q.q}%`;
        conditions.push(or(ilike(files.name, needle), ilike(files.description, needle))!);
      }
      if (q.mine === "1") {
        if (!viewer) throw unauthorized();
        conditions.push(eq(files.userId, viewer.id));
      }
      if (q.owner) {
        const owner = (
          await db.select().from(users).where(eq(users.username, q.owner.trim().toLowerCase())).limit(1)
        )[0];
        if (!owner) return paged([], 0, page, pageSize);
        conditions.push(eq(files.userId, owner.id));
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

      const rows = await db
        .select()
        .from(files)
        .where(where)
        .orderBy(order)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(files).where(where);
      const tagMap = await tagsForFiles(rows.map((row) => row.id));
      const ownerMap = await ownersById(rows.map((row) => row.userId));

      return paged(
        rows.map((row) => ({
          ...serializeFile(row, tagMap.get(row.id) ?? []),
          owner: ownerMap.get(row.userId) ?? { id: row.userId, username: "unknown" },
          canManage: canManage(viewer, row.userId),
        })),
        Number(count),
        page,
        pageSize,
      );
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  /** Uploaders that currently have public frames — feeds the admin owner filter. */
  .get("/owners", async (ctx) => {
    try {
      const viewer = await currentUser(ctx);
      if (!viewer) throw unauthorized();
      if (viewer.role !== "admin") throw forbidden("administrator access required");
      const rows = await getDb()
        .select({
          id: users.id,
          username: users.username,
          count: sql<number>`count(${files.id})::int`,
        })
        .from(files)
        .innerJoin(users, eq(users.id, files.userId))
        .where(and(eq(files.accessLevel, "public"), isNull(files.deletedAt)))
        .groupBy(users.id, users.username)
        .orderBy(desc(sql`count(${files.id})`));
      return ok(rows);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  /** Folders of the uploader whose frames are being moved (admin or self only). */
  .get("/owners/:id/folders", async (ctx) => {
    try {
      const viewer = await currentUser(ctx);
      if (!viewer) throw unauthorized();
      const ownerId = ctx.params.id;
      if (viewer.role !== "admin" && viewer.id !== ownerId) throw forbidden("you can only browse your own folders");
      const rows = await getDb()
        .select({ id: folders.id, name: folders.name, parentId: folders.parentId, fileCount: folders.fileCount })
        .from(folders)
        .where(and(eq(folders.userId, ownerId), isNull(folders.deletedAt)))
        .orderBy(asc(folders.name));
      return ok(rows);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  /**
   * Batch management from the shared sheet: your own frames, or any frame when
   * you are an administrator. Counters always move with the frame's owner.
   */
  .post("/batch", async (ctx) => {
    try {
      const viewer = await currentUser(ctx);
      if (!viewer) throw unauthorized();
      const body = ctx.body as { action?: unknown; ids?: unknown; value?: unknown };
      const action = String(body.action ?? "");
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.map((id) => String(id)).filter(Boolean))]
        : [];
      const value = typeof body.value === "string" ? body.value : undefined;
      if (!ids.length) throw badRequest("no images selected");
      if (ids.length > MAX_BATCH) throw badRequest(`select at most ${MAX_BATCH} images per batch`);

      const db = getDb();
      const rows = await db.select().from(files).where(inArray(files.id, ids));
      if (!rows.length) throw notFound("none of the selected images exist");

      const skipped: { id: string; reason: string }[] = [];
      const manageable = rows.filter((row) => {
        if (canManage(viewer, row.userId)) return true;
        skipped.push({ id: row.id, reason: "not_your_upload" });
        return false;
      });
      if (!manageable.length) throw forbidden("you can only manage images you uploaded");

      const active = manageable.filter((row) => !row.deletedAt);
      const trashed = manageable.filter((row) => row.deletedAt);
      let affected = 0;

      switch (action) {
        case "delete":
          for (const row of active) {
            await deleteFile(row.userId, row.id);
            affected++;
          }
          break;
        case "purge":
          for (const row of trashed) {
            await deleteFile(row.userId, row.id, true);
            affected++;
          }
          break;
        case "restore":
          for (const row of trashed) {
            await restoreFile(row.userId, row.id);
            affected++;
          }
          break;
        case "access": {
          if (!active.length) break;
          const level = value === "private" ? "private" : "public";
          await db
            .update(files)
            .set({ accessLevel: level, updatedAt: new Date() })
            .where(inArray(files.id, active.map((row) => row.id)));
          affected = active.length;
          break;
        }
        case "move": {
          const targetId = value?.trim() || null;
          let target: typeof folders.$inferSelect | undefined;
          if (targetId) {
            target = (await db.select().from(folders).where(eq(folders.id, targetId)).limit(1))[0];
            if (!target || target.deletedAt) throw notFound("target folder not found");
          }
          for (const row of active) {
            // A folder belongs to one account: only its owner's frames may enter it.
            if (target && target.userId !== row.userId) {
              skipped.push({ id: row.id, reason: "folder_belongs_to_another_account" });
              continue;
            }
            await db.update(files).set({ folderId: targetId, updatedAt: new Date() }).where(eq(files.id, row.id));
            affected++;
          }
          break;
        }
        case "tag": {
          const names = (value ?? "").split(",");
          for (const row of active) {
            await syncFileTags(row.id, row.userId, names);
            affected++;
          }
          break;
        }
        default:
          throw badRequest(`unsupported batch action: ${action}`);
      }

      if (!affected && !skipped.length) throw badRequest("nothing to do for the selected images");
      if (affected) {
        await logActivity(
          `gallery.batch.${action}`,
          { id: viewer.id, username: viewer.username, ip: requestMeta(ctx).ip },
          `${affected} file(s)`,
        );
      }
      return ok({ affected, skipped });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
