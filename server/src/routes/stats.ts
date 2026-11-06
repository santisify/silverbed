import { Elysia } from "elysia";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accessLogs, activityLogs, files } from "../db/schema";
import { humanSize } from "../lib/format";
import { unauthorized } from "../lib/http";
import { currentUser } from "../middleware/context";
import { handleError, ok } from "../http/respond";

export const statsRoutes = new Elysia({ prefix: "/api/v1/stats" })
  .get("/overview", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const db = getDb();
      const alive = and(eq(files.userId, user.id), isNull(files.deletedAt));

      const [totals] = await db
        .select({
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size),0)::bigint`,
          views: sql<number>`coalesce(sum(views),0)::bigint`,
          downloads: sql<number>`coalesce(sum(downloads),0)::bigint`,
        })
        .from(files)
        .where(alive);

      const timeline = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size),0)::bigint`,
        })
        .from(files)
        .where(and(eq(files.userId, user.id), gte(files.createdAt, new Date(Date.now() - 29 * 86_400_000))))
        .groupBy(sql`date_trunc('day', created_at)`)
        .orderBy(sql`date_trunc('day', created_at)`);

      const top = await db
        .select({ id: files.id, name: files.name, ext: files.ext, views: files.views, size: files.size, thumbKey: files.thumbKey })
        .from(files)
        .where(alive)
        .orderBy(desc(files.views))
        .limit(8);

      const byFormat = await db
        .select({ ext: files.ext, count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(size),0)::bigint` })
        .from(files)
        .where(alive)
        .groupBy(files.ext)
        .orderBy(desc(sql`count(*)`))
        .limit(8);

      const recentAccess = await db
        .select({ id: accessLogs.id, kind: accessLogs.kind, ip: accessLogs.ip, referer: accessLogs.referer, createdAt: accessLogs.createdAt, fileId: accessLogs.fileId })
        .from(accessLogs)
        .where(eq(accessLogs.userId, user.id))
        .orderBy(desc(accessLogs.createdAt))
        .limit(10);

      const recentActivity = await db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.userId, user.id))
        .orderBy(desc(activityLogs.createdAt))
        .limit(10);

      const bytes = Number(totals?.bytes ?? 0);
      return ok({
        totals: {
          files: Number(totals?.count ?? 0),
          bytes,
          bytesHuman: humanSize(bytes),
          views: Number(totals?.views ?? 0),
          downloads: Number(totals?.downloads ?? 0),
        },
        quota: { used: user.storageUsed, limit: user.storageQuota, percent: user.storageQuota ? Math.min(100, (user.storageUsed / user.storageQuota) * 100) : null },
        timeline,
        top,
        byFormat,
        recentAccess,
        recentActivity,
      });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
