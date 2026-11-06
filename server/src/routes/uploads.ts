import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { files, folders } from "../db/schema";
import { getInt } from "../db/settings";
import { badRequest, forbidden, notFound, tooMany, unauthorized } from "../lib/http";
import { extOf, humanSize, mimeForExt, safeName } from "../lib/format";
import { currentUser, rateLimit } from "../middleware/context";
import { handleError, ok } from "../http/respond";
import { keyFor, storage } from "../services/storage";
import { newId } from "../lib/ids";
import { storeUpload } from "../services/files";
import { syncFileTags } from "./files";

/**
 * Direct uploads.
 *
 * Vercel Functions cap request bodies at 4.5 MB, and images are routinely
 * larger. The browser asks for a presigned PUT, pushes the bytes straight into
 * the bucket, then calls `/files/import` — the function only downloads the
 * object to build the thumbnail, and never carries the bytes upstream.
 */

const R2_KEY_PREFIX = "orig/";

export const uploadRoutes = new Elysia()
  .post(
    "/api/v1/uploads/sign",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        rateLimit(`sign:${user.id}`, 120, 60_000);

        const body = ctx.body as { name: string; size: number; folderId?: string | null; accessLevel?: string };
        const name = safeName(body.name ?? "upload");
        const ext = extOf(name) || "bin";
        const size = Number(body.size) || 0;
        if (size <= 0) throw badRequest("a file size is required");

        const maxMb = await getInt("max_upload_mb", 32);
        if (size > maxMb * 1024 * 1024) throw tooMany(`file exceeds the ${maxMb} MB upload limit`);
        if (user.storageQuota > 0 && user.storageUsed + size > user.storageQuota) {
          throw tooMany("storage quota exceeded");
        }

        const folderId = body.folderId?.trim() || null;
        if (folderId) {
          const folder = (
            await getDb().select().from(folders).where(eq(folders.id, folderId)).limit(1)
          )[0];
          if (!folder || folder.userId !== user.id) throw notFound("target folder not found");
        }

        const id = newId();
        const key = keyFor(user.id, id, "orig", ext);
        const mime = mimeForExt(ext);
        const ticket = await storage().signedPutUrl(key, mime, 900);
        if (!ticket) throw badRequest("this instance does not accept direct uploads — use /files/upload");

        return ok({
          id,
          key,
          name,
          ext,
          mime,
          size,
          folderId,
          accessLevel: body.accessLevel === "private" ? "private" : user.defaultAccess,
          maxMb,
          uploadUrl: ticket.url,
          headers: ticket.headers,
          expiresIn: 900,
        });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ name: t.String(), size: t.Number(), folderId: t.Optional(t.Union([t.String(), t.Null()])), accessLevel: t.Optional(t.String()) }) },
  )
  .post(
    "/api/v1/files/import",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        const body = ctx.body as {
          id: string;
          key: string;
          name: string;
          folderId?: string | null;
          accessLevel?: string;
          description?: string;
          tags?: string;
          expiresInDays?: number;
        };

        // The key is handed out by /uploads/sign; refuse anything outside the
        // caller's own namespace so one account cannot import another's object.
        if (!body.key?.startsWith(`${R2_KEY_PREFIX}${user.id}/`)) throw forbidden("this upload does not belong to you");

        const driver = storage();
        if (!(await driver.exists(body.key))) throw notFound("the upload was not found in storage — did the PUT succeed?");
        const object = await driver.get(body.key);
        if (!object) throw notFound("the upload could not be read back from storage");

        const maxMb = await getInt("max_upload_mb", 32);
        if (object.size > maxMb * 1024 * 1024) {
          await driver.remove(body.key).catch(() => {});
          throw tooMany(`file exceeds the ${maxMb} MB upload limit`);
        }

        const days = Number(body.expiresInDays ?? 0);
        const stored = await storeUpload({
          userId: user.id,
          bytes: object.body,
          originalName: body.name,
          folderId: body.folderId?.trim() || null,
          accessLevel: body.accessLevel === "private" ? "private" : user.defaultAccess,
          description: body.description?.slice(0, 500),
          expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
          uploadedVia: "direct",
          existing: { id: body.id, storageKey: body.key },
        });

        const tagNames = (body.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        if (tagNames.length && !stored.deduplicated) await syncFileTags(stored.id, user.id, tagNames);

        return ok({ ...stored, sizeHuman: humanSize(stored.size) });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        id: t.String(),
        key: t.String(),
        name: t.String(),
        folderId: t.Optional(t.Union([t.String(), t.Null()])),
        accessLevel: t.Optional(t.String()),
        description: t.Optional(t.String()),
        tags: t.Optional(t.String()),
        expiresInDays: t.Optional(t.Number()),
      }),
    },
  );
