import { Elysia, t } from "elysia";
import { getDb } from "../db";
import { users } from "../db/schema";
import { allSettings, setSetting } from "../db/settings";
import { badRequest, conflict } from "../lib/http";
import { newId } from "../lib/ids";
import { signToken } from "../lib/jwt";
import { hashPassword } from "../lib/password";
import { toApiUser } from "../services/auth";
import { logActivity } from "../services/activity";
import { handleError, meta, ok } from "../http/respond";

export const setupRoutes = new Elysia({ prefix: "/api/v1/setup" })
  .get("/status", async () => {
    const rows = await getDb().select({ id: users.id }).from(users).limit(1);
    const settings = await allSettings();
    return ok({
      installed: rows.length > 0,
      siteName: settings.site_name,
      siteDescription: settings.site_description,
      allowRegister: settings.allow_register === "true",
      guestUpload: settings.guest_upload === "true",
    });
  })
  .post(
    "/install",
    async (ctx) => {
      try {
        const existing = await getDb().select({ id: users.id }).from(users).limit(1);
        if (existing.length) throw conflict("this instance is already installed");
        const body = ctx.body as {
          username: string;
          password: string;
          email?: string;
          siteName?: string;
          siteDescription?: string;
        };
        const name = body.username.trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw badRequest("username must be 3-32 chars of letters, numbers, dot, dash or underscore");
        const row = {
          id: newId(),
          username: name,
          email: body.email?.trim().toLowerCase() || null,
          passwordHash: hashPassword(body.password),
          role: "admin",
          status: "active",
          provider: "local",
          defaultAccess: "public",
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await getDb().insert(users).values(row);
        if (body.siteName?.trim()) await setSetting("site_name", body.siteName.trim());
        if (body.siteDescription?.trim()) await setSetting("site_description", body.siteDescription.trim());
        await logActivity("setup.install", { id: row.id, username: name, ip: meta(ctx).ip }, "instance");
        return ok({
          token: signToken({ sub: row.id, role: row.role, username: row.username }),
          user: toApiUser({ ...row, avatarUrl: null, externalId: null, storageQuota: 0, storageUsed: 0, fileCount: 0 } as never),
        });
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
        siteName: t.Optional(t.String()),
        siteDescription: t.Optional(t.String()),
      }),
    },
  );
