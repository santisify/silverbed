import { Elysia, t } from "elysia";

/** Bun reports its version on globalThis; Node has neither Bun nor a stable alias. */
function runtimeLabel(): string {
  const bun = (globalThis as { Bun?: { version?: string } }).Bun;
  return bun?.version ? `bun ${bun.version}` : `node ${process.version}`;
}
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { accessLogs, activityLogs, apiKeys, files, folders, mailLogs, shares, users } from "../db/schema";
import { allSettings, setSetting } from "../db/settings";
import { humanSize } from "../lib/format";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/password";
import { toApiUser } from "../services/auth";
import { logActivity } from "../services/activity";
import { sendMail } from "../services/mail";
import { currentUser } from "../middleware/context";
import { handleError, ok, paged } from "../http/respond";
import { storage } from "../services/storage";
import { config } from "../config";

const requireAdmin = async (ctx: Parameters<typeof currentUser>[0]) => {
  const user = await currentUser(ctx);
  if (!user) throw unauthorized();
  if (user.role !== "admin") throw forbidden("administrator access required");
  return user;
};

export const adminRoutes = new Elysia({ prefix: "/api/v1/admin" })
  .get("/overview", async (ctx) => {
    try {
      await requireAdmin(ctx);
      const db = getDb();
      const [totals] = await db
        .select({
          files: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size),0)::bigint`,
          views: sql<number>`coalesce(sum(views),0)::bigint`,
          trashed: sql<number>`count(*) filter (where deleted_at is not null)::int`,
        })
        .from(files);
      const [userTotals] = await db.select({ count: sql<number>`count(*)::int`, disabled: sql<number>`count(*) filter (where status <> 'active')::int` }).from(users);
      const [shareTotals] = await db.select({ count: sql<number>`count(*)::int`, views: sql<number>`coalesce(sum(view_count),0)::bigint` }).from(shares);
      const [logTotals] = await db.select({ count: sql<number>`count(*)::int` }).from(accessLogs);

      const timeline = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', created_at), 'YYYY-MM-DD')`,
          uploads: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(size),0)::bigint`,
        })
        .from(files)
        .where(gte(files.createdAt, new Date(Date.now() - 29 * 86_400_000)))
        .groupBy(sql`date_trunc('day', created_at)`)
        .orderBy(sql`date_trunc('day', created_at)`);

      const topUploaders = await db
        .select({ id: users.id, username: users.username, files: users.fileCount, bytes: users.storageUsed })
        .from(users)
        .orderBy(desc(users.storageUsed))
        .limit(8);

      const recentActivity = await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(20);

      const bytes = Number(totals?.bytes ?? 0);
      return ok({
        totals: {
          files: Number(totals?.files ?? 0),
          bytes,
          bytesHuman: humanSize(bytes),
          views: Number(totals?.views ?? 0),
          trashed: Number(totals?.trashed ?? 0),
          users: Number(userTotals?.count ?? 0),
          disabledUsers: Number(userTotals?.disabled ?? 0),
          shares: Number(shareTotals?.count ?? 0),
          shareViews: Number(shareTotals?.views ?? 0),
          accessEvents: Number(logTotals?.count ?? 0),
        },
        system: {
          storageDriver: storage().name,
          database: config.databaseUrl ? "postgres" : "pglite",
          authMode: config.authMode,
          smtp: Boolean(config.smtp.host),
          publicBaseUrl: config.publicBaseUrl,
          uptimeSeconds: Math.round(process.uptime()),
          runtime: runtimeLabel(),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
        timeline,
        topUploaders,
        recentActivity,
      });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/users", async (ctx) => {
    try {
      await requireAdmin(ctx);
      const q = ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
      const db = getDb();
      const where = q.q ? sql`username ilike ${`%${q.q}%`} or email ilike ${`%${q.q}%`}` : undefined;
      const rows = await db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(where);
      return paged(rows.map(toApiUser), Number(count), page, pageSize);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post(
    "/users",
    async (ctx) => {
      try {
        const admin = await requireAdmin(ctx);
        const body = ctx.body as { username: string; password: string; email?: string; role?: string; storageQuota?: number };
        const name = body.username.trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw badRequest("invalid username");
        const existing = (await getDb().select().from(users).where(eq(users.username, name)).limit(1))[0];
        if (existing) throw badRequest("that username already exists");
        const row = {
          id: newId(),
          username: name,
          email: body.email?.trim().toLowerCase() || null,
          passwordHash: hashPassword(body.password),
          role: body.role === "admin" ? "admin" : "user",
          status: "active",
          provider: "local",
          storageQuota: Number(body.storageQuota) > 0 ? Number(body.storageQuota) : 0,
          defaultAccess: "public",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await getDb().insert(users).values(row);
        await logActivity("admin.user.create", { id: admin.id, username: admin.username }, name);
        return ok(toApiUser({ ...row, avatarUrl: null, externalId: null, storageUsed: 0, fileCount: 0, lastLoginAt: null } as never));
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
        email: t.Optional(t.String()),
        role: t.Optional(t.String()),
        storageQuota: t.Optional(t.Number()),
      }),
    },
  )
  .patch(
    "/users/:id",
    async (ctx) => {
      try {
        const admin = await requireAdmin(ctx);
        const row = (await getDb().select().from(users).where(eq(users.id, ctx.params.id)).limit(1))[0];
        if (!row) throw notFound("user not found");
        const body = ctx.body as { role?: string; status?: string; storageQuota?: number; password?: string; email?: string };
        if (row.id === admin.id && body.role && body.role !== "admin") throw badRequest("you cannot demote yourself");
        await getDb()
          .update(users)
          .set({
            role: body.role === "admin" || body.role === "user" ? body.role : row.role,
            status: body.status === "disabled" || body.status === "active" ? body.status : row.status,
            storageQuota: body.storageQuota !== undefined ? Math.max(0, Number(body.storageQuota)) : row.storageQuota,
            email: body.email !== undefined ? body.email.trim().toLowerCase() || null : row.email,
            passwordHash: body.password ? hashPassword(body.password) : row.passwordHash,
            updatedAt: new Date(),
          })
          .where(eq(users.id, row.id));
        await logActivity("admin.user.update", { id: admin.id, username: admin.username }, row.username);
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        role: t.Optional(t.String()),
        status: t.Optional(t.String()),
        storageQuota: t.Optional(t.Number()),
        password: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
    },
  )
  .delete("/users/:id", async (ctx) => {
    try {
      const admin = await requireAdmin(ctx);
      if (admin.id === ctx.params.id) throw badRequest("you cannot delete your own account");
      const row = (await getDb().select().from(users).where(eq(users.id, ctx.params.id)).limit(1))[0];
      if (!row) throw notFound("user not found");
      const db = getDb();
      await db.update(files).set({ deletedAt: new Date() }).where(eq(files.userId, row.id));
      await db.update(folders).set({ deletedAt: new Date() }).where(eq(folders.userId, row.id));
      await db.update(shares).set({ revoked: true }).where(eq(shares.userId, row.id));
      await db.update(apiKeys).set({ enabled: false, revokedAt: new Date() }).where(eq(apiKeys.userId, row.id));
      await db.delete(users).where(eq(users.id, row.id));
      await logActivity("admin.user.delete", { id: admin.id, username: admin.username }, row.username);
      return ok({ deleted: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/settings", async (ctx) => {
    try {
      await requireAdmin(ctx);
      return ok(await allSettings());
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .patch(
    "/settings",
    async (ctx) => {
      try {
        const admin = await requireAdmin(ctx);
        const body = ctx.body as Record<string, string | number | boolean>;
        const allowed = new Set(Object.keys(await allSettings()));
        for (const [key, value] of Object.entries(body)) {
          if (!allowed.has(key)) continue;
          await setSetting(key, typeof value === "boolean" ? String(value) : String(value));
        }
        await logActivity("admin.settings.update", { id: admin.id, username: admin.username }, Object.keys(body).join(","));
        return ok(await allSettings());
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean()])) },
  )
  .get("/activity", async (ctx) => {
    try {
      await requireAdmin(ctx);
      const page = Math.max(1, Number((ctx.query as Record<string, string>).page) || 1);
      const pageSize = 50;
      const rows = await getDb().select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
      const [{ count }] = await getDb().select({ count: sql<number>`count(*)::int` }).from(activityLogs);
      return paged(rows, Number(count), page, pageSize);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .get("/mail", async (ctx) => {
    try {
      await requireAdmin(ctx);
      const rows = await getDb().select().from(mailLogs).orderBy(desc(mailLogs.createdAt)).limit(50);
      return ok(rows);
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post(
    "/mail/test",
    async (ctx) => {
      try {
        const admin = await requireAdmin(ctx);
        const { to } = ctx.body as { to: string };
        const result = await sendMail({
          to,
          subject: "Silverbed SMTP test",
          text: `This is a test message sent from your Silverbed instance at ${new Date().toISOString()}.`,
        });
        await logActivity("admin.mail.test", { id: admin.id, username: admin.username }, to);
        return ok(result);
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ to: t.String() }) },
  )
  .post("/maintenance/purge-trash", async (ctx) => {
    try {
      const admin = await requireAdmin(ctx);
      const db = getDb();
      const trashed = await db.select().from(files).where(and(isNotNull(files.deletedAt), gte(sql`now()`, files.deletedAt)));
      await db.delete(files).where(and(isNotNull(files.deletedAt), gte(sql`now()`, files.deletedAt)));
      await logActivity("admin.purge_trash", { id: admin.id, username: admin.username }, `${trashed.length} file(s)`);
      return ok({ purged: trashed.length });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  })
  .post("/maintenance/expire", async (ctx) => {
    try {
      const admin = await requireAdmin(ctx);
      const db = getDb();
      const expired = await db
        .select({ id: files.id })
        .from(files)
        .where(and(isNotNull(files.expiresAt), sql`${files.expiresAt} < now()`));
      if (expired.length) {
        await db.update(files).set({ deletedAt: new Date(), status: "trashed" }).where(sql`${files.expiresAt} < now()`);
      }
      await logActivity("admin.expire_files", { id: admin.id, username: admin.username }, `${expired.length} file(s)`);
      return ok({ expired: expired.length });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
