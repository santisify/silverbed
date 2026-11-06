import { Elysia, t } from "elysia";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { fileTags, tags } from "../db/schema";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { currentUser } from "../middleware/context";
import { handleError, ok } from "../http/respond";

export const tagRoutes = new Elysia({ prefix: "/api/v1/tags" })
  .get("/", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const rows = await getDb()
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
          createdAt: tags.createdAt,
          fileCount: sql<number>`(select count(*)::int from file_tags ft where ft.tag_id = ${tags.id})`,
        })
        .from(tags)
        .where(eq(tags.userId, user.id))
        .orderBy(asc(tags.name));
      return ok(rows);
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
        const body = ctx.body as { name: string; color?: string };
        const name = body.name.trim().slice(0, 32);
        if (!name) throw badRequest("tag name is required");
        const existing = (
          await getDb().select().from(tags).where(and(eq(tags.userId, user.id), eq(tags.name, name))).limit(1)
        )[0];
        if (existing) return ok(existing);
        const row = {
          id: `tag_${Math.random().toString(36).slice(2, 12)}`,
          userId: user.id,
          name,
          color: body.color?.slice(0, 16) || "slate",
          createdAt: new Date(),
        };
        await getDb().insert(tags).values(row);
        return ok(row);
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ name: t.String(), color: t.Optional(t.String()) }) },
  )
  .delete("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const db = getDb();
      const existing = (await db.select().from(tags).where(eq(tags.id, ctx.params.id)).limit(1))[0];
      if (!existing || existing.userId !== user.id) throw notFound("tag not found");
      await db.delete(fileTags).where(eq(fileTags.tagId, existing.id));
      await db.delete(tags).where(eq(tags.id, existing.id));
      return ok({ deleted: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
