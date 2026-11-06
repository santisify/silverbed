import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys } from "../db/schema";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { createApiKey } from "../services/auth";
import { logActivity } from "../services/activity";
import { currentUser } from "../middleware/context";
import { handleError, ok } from "../http/respond";

function publicKey(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.split(","),
    enabled: row.enabled,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    uploadCount: row.uploadCount,
    revokedAt: row.revokedAt,
  };
}

export const apiKeyRoutes = new Elysia({ prefix: "/api/v1/keys" })
  .get("/", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const rows = await getDb().select().from(apiKeys).where(eq(apiKeys.userId, user.id)).orderBy(desc(apiKeys.createdAt));
      return ok(rows.map(publicKey));
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
        const body = ctx.body as { name?: string; scopes?: string[] };
        const created = await createApiKey(user.id, body.name ?? "Untitled key", (body.scopes ?? ["upload", "read"]).join(","));
        await logActivity("apikey.create", { id: user.id, username: user.username }, created.prefix);
        const { keyHash: _hash, ...rest } = created;
        return ok({ ...rest, scopes: created.scopes.split(",") });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ name: t.Optional(t.String()), scopes: t.Optional(t.Array(t.String())) }) },
  )
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        const row = (await getDb().select().from(apiKeys).where(eq(apiKeys.id, ctx.params.id)).limit(1))[0];
        if (!row || row.userId !== user.id) throw notFound("key not found");
        const body = ctx.body as { name?: string; enabled?: boolean };
        await getDb()
          .update(apiKeys)
          .set({ name: body.name?.slice(0, 80) ?? row.name, enabled: body.enabled ?? row.enabled })
          .where(eq(apiKeys.id, row.id));
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ name: t.Optional(t.String()), enabled: t.Optional(t.Boolean()) }) },
  )
  .delete("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const row = (await getDb().select().from(apiKeys).where(eq(apiKeys.id, ctx.params.id)).limit(1))[0];
      if (!row || row.userId !== user.id) throw notFound("key not found");
      await getDb().delete(apiKeys).where(and(eq(apiKeys.id, row.id), eq(apiKeys.userId, user.id)));
      return ok({ deleted: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
