import { Elysia } from "elysia";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files } from "../db/schema";
import { allSettings } from "../db/settings";
import { config } from "../config";
import { storage } from "../services/storage";
import { rateLimit } from "../middleware/context";
import { handleError, ok } from "../http/respond";

export const metaRoutes = new Elysia({ prefix: "/api/v1" })
  .get("/meta", async () => {
    const settings = await allSettings();
    const [totals] = await getDb()
      .select({ files: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(size),0)::bigint` })
      .from(files)
      .where(isNull(files.deletedAt));
    return ok({
      siteName: settings.site_name,
      siteDescription: settings.site_description,
      announcement: settings.announcement,
      allowRegister: settings.allow_register === "true",
      guestUpload: settings.guest_upload === "true",
      maxUploadMb: Number(settings.max_upload_mb) || config.maxUploadMb,
      storageDriver: storage().name,
      authMode: config.authMode,
      providers: {
        github: Boolean(config.githubClientId && config.githubClientSecret),
        google: Boolean(config.googleClientId && config.googleClientSecret),
        password: true,
      },
      totals: { files: Number(totals?.files ?? 0), bytes: Number(totals?.bytes ?? 0) },
      version: "1.0.0",
    });
  })
  .get("/open/random", async (ctx) => {
    try {
      rateLimit(`random:${(ctx.request.headers.get("x-forwarded-for") ?? "local").split(",")[0]}`, 300, 60_000);
      const q = ctx.query as Record<string, string | undefined>;
      const db = getDb();
      const conditions = [isNull(files.deletedAt), eq(files.accessLevel, "public")];
      const rows = await db
        .select({ id: files.id, ext: files.ext, name: files.name, width: files.width, height: files.height, size: files.size })
        .from(files)
        .where(and(...conditions))
        .orderBy(sql`random()`)
        .limit(1);
      const file = rows[0];
      if (!file) return new Response(JSON.stringify({ code: "not_found", message: "no public images yet" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const url = `${config.publicBaseUrl}/i/${file.id}.${file.ext}`;
      if (q.redirect === "0" || q.format === "json") return ok({ url, ...file });
      return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/open/list", async (ctx) => {
    try {
      const q = ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 24));
      const db = getDb();
      const where = and(isNull(files.deletedAt), eq(files.accessLevel, "public"));
      const rows = await db.select().from(files).where(where).orderBy(desc(files.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(files).where(where);
      return ok({
        total: Number(count),
        page,
        pageSize,
        items: rows.map((f) => ({
          id: f.id,
          name: f.name,
          ext: f.ext,
          width: f.width,
          height: f.height,
          size: f.size,
          url: `${config.publicBaseUrl}/i/${f.id}.${f.ext}`,
          thumbUrl: f.thumbKey ? `${config.publicBaseUrl}/i/${f.id}.thumb.webp` : null,
          createdAt: f.createdAt,
        })),
      });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
