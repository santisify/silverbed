import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files, folders } from "../db/schema";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { newId } from "../lib/ids";
import { currentUser } from "../middleware/context";
import { handleError, ok } from "../http/respond";

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  accessLevel: string;
  fileCount: number;
  createdAt: Date;
  children: FolderNode[];
}

function buildTree(rows: (typeof folders.$inferSelect)[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      accessLevel: row.accessLevel,
      fileCount: row.fileCount,
      createdAt: row.createdAt,
      children: [],
    });
  }
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export const folderRoutes = new Elysia({ prefix: "/api/v1/folders" })
  .get("/", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const rows = await getDb()
        .select()
        .from(folders)
        .where(and(eq(folders.userId, user.id), isNull(folders.deletedAt)))
        .orderBy(asc(folders.name));
      const rootCount = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(files)
        .where(and(eq(files.userId, user.id), isNull(files.folderId), isNull(files.deletedAt)));
      return ok({
        folders: rows,
        tree: buildTree(rows),
        rootFileCount: Number(rootCount[0]?.count ?? 0),
      });
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
        const body = ctx.body as { name: string; parentId?: string | null; accessLevel?: string };
        const name = body.name.trim().slice(0, 120);
        if (!name) throw badRequest("folder name is required");
        const parentId = body.parentId?.trim() || null;
        if (parentId) {
          const parent = (await getDb().select().from(folders).where(eq(folders.id, parentId)).limit(1))[0];
          if (!parent || parent.userId !== user.id) throw notFound("parent folder not found");
        }
        const row = {
          id: newId(),
          userId: user.id,
          parentId,
          name,
          accessLevel: body.accessLevel === "public" ? "public" : "private",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await getDb().insert(folders).values(row);
        return ok(row);
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ name: t.String(), parentId: t.Optional(t.Nullable(t.String())), accessLevel: t.Optional(t.String()) }) },
  )
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const user = await currentUser(ctx);
        if (!user) throw unauthorized();
        const existing = (await getDb().select().from(folders).where(eq(folders.id, ctx.params.id)).limit(1))[0];
        if (!existing || existing.userId !== user.id || existing.deletedAt) throw notFound("folder not found");
        const body = ctx.body as { name?: string; parentId?: string | null; accessLevel?: string };
        await getDb()
          .update(folders)
          .set({
            name: body.name?.trim() ? body.name.trim().slice(0, 120) : existing.name,
            parentId: body.parentId === undefined ? existing.parentId : body.parentId || null,
            accessLevel: body.accessLevel ? (body.accessLevel === "public" ? "public" : "private") : existing.accessLevel,
            updatedAt: new Date(),
          })
          .where(eq(folders.id, existing.id));
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        parentId: t.Optional(t.Nullable(t.String())),
        accessLevel: t.Optional(t.String()),
      }),
    },
  )
  .delete("/:id", async (ctx) => {
    try {
      const user = await currentUser(ctx);
      if (!user) throw unauthorized();
      const db = getDb();
      const existing = (await db.select().from(folders).where(eq(folders.id, ctx.params.id)).limit(1))[0];
      if (!existing || existing.userId !== user.id) throw notFound("folder not found");
      await db.update(files).set({ folderId: null }).where(eq(files.folderId, existing.id));
      await db.update(folders).set({ deletedAt: new Date() }).where(eq(folders.id, existing.id));
      return ok({ deleted: true });
    } catch (err) {
      const mapped = handleError(err);
      ctx.set.status = mapped.status;
      return mapped.body;
    }
  });
