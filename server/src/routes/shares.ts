import { Elysia, t } from "elysia";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files, shareAccessLogs, shareItems, shares, users } from "../db/schema";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { newId, newToken } from "../lib/ids";
import { hashPassword, verifyPassword } from "../lib/password";
import { humanSize } from "../lib/format";
import { makeZip, type ZipEntry } from "../lib/zip";
import { logActivity } from "../services/activity";
import { sendMail } from "../services/mail";
import { serializeFile } from "./files";
import { storage } from "../services/storage";
import { currentUser, rateLimit } from "../middleware/context";
import { handleError, ok } from "../http/respond";
import { config } from "../config";
import { parseAccessToken, signAccessToken } from "../services/shareToken";

function toShare(row: typeof shares.$inferSelect) {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    kind: row.kind,
    folderId: row.folderId,
    hasPassword: Boolean(row.passwordHash),
    expiresAt: row.expiresAt,
    allowDownload: row.allowDownload,
    viewCount: row.viewCount,
    downloadCount: row.downloadCount,
    revoked: row.revoked,
    createdAt: row.createdAt,
    url: `${config.publicBaseUrl}/s/${row.token}`,
    expired: row.expiresAt ? row.expiresAt.getTime() < Date.now() : false,
  };
}

async function shareWithItems(userId: string, shareId: string) {
  const share = (await getDb().select().from(shares).where(eq(shares.id, shareId)).limit(1))[0];
  if (!share || share.userId !== userId) throw notFound("share not found");
  const items = await getDb()
    .select({ item: shareItems, file: files })
    .from(shareItems)
    .innerJoin(files, eq(files.id, shareItems.fileId))
    .where(and(eq(shareItems.shareId, shareId), isNull(files.deletedAt)))
    .orderBy(shareItems.sortOrder);
  return { share, items };
}

export const shareRoutes = new Elysia({ prefix: "/api/v1/shares" })
  .get("/", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const db = getDb();
      const rows = await db.select().from(shares).where(eq(shares.userId, user.id)).orderBy(desc(shares.createdAt));
      const counts = rows.length
        ? await db
            .select({ shareId: shareItems.shareId, count: sql<number>`count(*)::int` })
            .from(shareItems)
            .where(inArray(shareItems.shareId, rows.map((r) => r.id)))
            .groupBy(shareItems.shareId)
        : [];
      const countMap = new Map(counts.map((c) => [c.shareId, Number(c.count)]));
      return ok(rows.map((row) => ({ ...toShare(row), itemCount: countMap.get(row.id) ?? 0 })));
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post(
    "/",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        const body = ctx.body as {
          title?: string;
          fileIds?: string[];
          folderId?: string;
          password?: string;
          expiresInDays?: number;
          allowDownload?: boolean;
        };
        const fileIds = [...new Set(body.fileIds ?? [])];
        if (!fileIds.length) throw badRequest("select at least one image to share");
        const db = getDb();
        const owned = await db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.userId, user.id), inArray(files.id, fileIds), isNull(files.deletedAt)));
        if (owned.length !== fileIds.length) throw forbidden("some selected images are not yours");

        const share = {
          id: newId(),
          token: newToken(),
          userId: user.id,
          title: (body.title ?? "").trim().slice(0, 160),
          kind: "files",
          folderId: null,
          passwordHash: body.password ? hashPassword(body.password) : null,
          expiresAt: body.expiresInDays && body.expiresInDays > 0 ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
          allowDownload: body.allowDownload ?? true,
          viewCount: 0,
          downloadCount: 0,
          revoked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.insert(shares).values(share);
        await db.insert(shareItems).values(owned.map((f, index) => ({ id: newId(), shareId: share.id, fileId: f.id, sortOrder: index })));
        await logActivity("share.create", { id: user.id, username: user.username, ip: "" }, share.token);
        return ok(toShare(share));
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        fileIds: t.Array(t.String()),
        password: t.Optional(t.String()),
        expiresInDays: t.Optional(t.Number()),
        allowDownload: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const { share, items } = await shareWithItems(user.id, ctx.params.id);
      return ok({ ...toShare(share), items: items.map((i) => ({ ...serializeFile(i.file), sortOrder: i.item.sortOrder })) });
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
        const body = ctx.body as { title?: string; password?: string | null; revoked?: boolean; allowDownload?: boolean };
        const share = (await getDb().select().from(shares).where(eq(shares.id, ctx.params.id)).limit(1))[0];
        if (!share || share.userId !== user.id) throw notFound("share not found");
        await getDb()
          .update(shares)
          .set({
            title: body.title !== undefined ? body.title.slice(0, 160) : share.title,
            passwordHash: body.password === undefined ? share.passwordHash : body.password ? hashPassword(body.password) : null,
            revoked: body.revoked ?? share.revoked,
            allowDownload: body.allowDownload ?? share.allowDownload,
            updatedAt: new Date(),
          })
          .where(eq(shares.id, share.id));
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        password: t.Optional(t.Nullable(t.String())),
        revoked: t.Optional(t.Boolean()),
        allowDownload: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const share = (await getDb().select().from(shares).where(eq(shares.id, ctx.params.id)).limit(1))[0];
      if (!share || share.userId !== user.id) throw notFound("share not found");
      await getDb().delete(shareItems).where(eq(shareItems.shareId, share.id));
      await getDb().delete(shares).where(eq(shares.id, share.id));
      return ok({ deleted: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });

/** Public share surface — no session required, password gate when configured. */
export const publicShareRoutes = new Elysia({ prefix: "/api/v1/public/shares" })
  .get("/:token", async (ctx) => {
    try {
      const share = (await getDb().select().from(shares).where(eq(shares.token, ctx.params.token)).limit(1))[0];
      if (!share || share.revoked) throw notFound("this share link is not available");
      if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw forbidden("this share link has expired");
      const meta = {
        token: share.token,
        title: share.title,
        kind: share.kind,
        hasPassword: Boolean(share.passwordHash),
        allowDownload: share.allowDownload,
        expiresAt: share.expiresAt,
        createdAt: share.createdAt,
      };
      const supplied = ctx.query.t;
      const unlocked = !share.passwordHash || (supplied ? verifyPassword(share.passwordHash, supplied) : parseAccessToken(ctx)?.shareId === share.id);
      if (!unlocked) return ok({ ...meta, locked: true, items: [] });

      await getDb().update(shares).set({ viewCount: sql`${shares.viewCount} + 1` }).where(eq(shares.id, share.id));
      await getDb().insert(shareAccessLogs).values({
        id: newId(),
        shareId: share.id,
        ip: (ctx.request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
        userAgent: ctx.request.headers.get("user-agent") ?? null,
        referer: ctx.request.headers.get("referer") ?? null,
        unlocked: true,
        createdAt: new Date(),
      });

      const { items } = await shareWithItems(share.userId, share.id);
      const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);
      return ok({
        ...meta,
        locked: false,
        totalBytes,
        totalHuman: humanSize(totalBytes),
        items: items.map((i) => ({
          ...serializeFile(i.file),
          url: `${config.publicBaseUrl}/i/${i.file.id}.${i.file.ext}`,
          thumbUrl: i.file.thumbKey ? `${config.publicBaseUrl}/i/${i.file.id}.thumb.webp` : null,
          previewUrl: i.file.previewKey ? `${config.publicBaseUrl}/i/${i.file.id}.preview.webp` : null,
        })),
      });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post(
    "/:token/unlock",
    async (ctx) => {
      try {
        rateLimit(`unlock:${ctx.params.token}:${(ctx.request.headers.get("x-forwarded-for") ?? "local").split(",")[0]}`, 20, 10 * 60 * 1000);
        const share = (await getDb().select().from(shares).where(eq(shares.token, ctx.params.token)).limit(1))[0];
        if (!share || share.revoked) throw notFound("this share link is not available");
        const { password } = ctx.body as { password: string };
        if (share.passwordHash && !verifyPassword(share.passwordHash, password ?? "")) {
          throw forbidden("incorrect password");
        }
        return ok({ accessToken: signAccessToken(share.id, share.token) });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ password: t.Optional(t.String()) }) },
  )
  .post("/:token/report", async (ctx) => {
    try {
      const share = (await getDb().select().from(shares).where(eq(shares.token, ctx.params.token)).limit(1))[0];
      if (!share) throw notFound("share not found");
      const owner = (await getDb().select().from(users).where(eq(users.id, share.userId)).limit(1))[0];
      const { reason } = ctx.body as { reason?: string };
      if (owner?.email) {
        void sendMail({
          to: owner.email,
          subject: `New visit to your share "${share.title || share.token}"`,
          text: `Your share link ${config.publicBaseUrl}/s/${share.token} received a new report: ${reason ?? "no reason provided"}`,
        });
      }
      return ok({ received: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });

export async function buildShareZip(token: string): Promise<{ name: string; data: Uint8Array }> {
  const share = (await getDb().select().from(shares).where(eq(shares.token, token)).limit(1))[0];
  if (!share || share.revoked) throw notFound("this share link is not available");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw forbidden("this share link has expired");
  if (!share.allowDownload) throw forbidden("downloads are disabled for this share");
  const { items } = await shareWithItems(share.userId, share.id);
  const entries: ZipEntry[] = [];
  for (const { file } of items) {
    const object = await storage().get(file.storageKey);
    if (object) entries.push({ name: `${file.name}`, data: object.body });
  }
  await getDb().update(shares).set({ downloadCount: sql`${shares.downloadCount} + 1` }).where(eq(shares.id, share.id));
  return { name: `${(share.title || "silverbed-share").replace(/[^\w.-]+/g, "-")}.zip`, data: makeZip(entries) };
}
