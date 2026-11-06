import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { config } from "../config";
import { getDb } from "../db";
import { users } from "../db/schema";
import { getBool } from "../db/settings";
import { badRequest, conflict, forbidden, unauthorized } from "../lib/http";
import { newId } from "../lib/ids";
import { signToken } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/password";
import { findUserByName, toApiUser, userFromToken } from "../services/auth";
import { logActivity } from "../services/activity";
import { sendMail } from "../services/mail";
import { passwordGrant, signUp, supabaseEnabled } from "../services/supabase";
import { handleError, meta, ok } from "../http/respond";
import { rateLimit } from "../middleware/context";

function issue(user: { id: string; role: string; username: string }) {
  return signToken({ sub: user.id, role: user.role, username: user.username });
}

export const authRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .get("/providers", () => ({
    code: 0,
    data: {
      github: Boolean(config.githubClientId && config.githubClientSecret),
      google: Boolean(config.googleClientId && config.googleClientSecret),
      supabase: Boolean(config.supabaseUrl),
      supabaseLogin: Boolean(config.supabasePasswordLogin && supabaseEnabled()),
      mode: config.authMode,
      /** Supabase verifies passwords, so sign-in happens against an email address. */
      loginWithEmail: Boolean(config.supabasePasswordLogin && supabaseEnabled()),
    },
  }))
  .get("/me", async ({ request, set }) => {
    const header = request.headers.get("authorization");
    const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
    const resolved = await userFromToken(token);
    if (!resolved) {
      set.status = 401;
      return { code: "unauthorized", message: "not signed in" };
    }
    return ok({ user: toApiUser(resolved.user), token, mode: resolved.via });
  })
  .post(
    "/register",
    async (ctx) => {
      try {
        const { username, password, email } = ctx.body as { username: string; password: string; email?: string };
        const allowed = await getBool("allow_register");
        if (!allowed) throw forbidden("registration is disabled on this instance");
        rateLimit(`register:${meta(ctx).ip}`, 8, 60 * 60 * 1000);
        const name = username.trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(name)) {
          throw badRequest("username must be 3-32 chars of letters, numbers, dot, dash or underscore");
        }
        if (await findUserByName(name)) throw conflict("that username is already taken");

        // Supabase-managed accounts live in GoTrue, so an email address is required.
        if (config.supabasePasswordLogin && supabaseEnabled()) {
          const address = email?.trim().toLowerCase();
          if (!address) throw badRequest("an email address is required when Supabase manages accounts");
          const session = await signUp({ email: address, password, username: name });
          if (!session) {
            // Email confirmation is on: the account exists but cannot sign in yet.
            return ok({ pendingConfirmation: true, message: "check your email to confirm the account" });
          }
          const resolved = await userFromToken(session.access_token);
          if (!resolved) throw badRequest("could not provision the account locally");
          await logActivity("user.register", { id: resolved.user.id, username: resolved.user.username, ip: meta(ctx).ip }, resolved.user.username);
          return ok({
            token: session.access_token,
            refreshToken: session.refresh_token ?? null,
            user: toApiUser(resolved.user),
          });
        }

        const row = {
          id: newId(),
          username: name,
          email: email?.trim().toLowerCase() || null,
          passwordHash: hashPassword(password),
          role: "user",
          status: "active",
          provider: "local",
          defaultAccess: "public",
          lastLoginAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await getDb().insert(users).values(row);
        await logActivity("user.register", { id: row.id, username: name, ip: meta(ctx).ip }, name);
        if (row.email) {
          void sendMail({
            to: row.email,
            subject: "Welcome to Silverbed",
            text: `Hi ${name},\n\nYour Silverbed account is ready. Sign in at ${config.publicBaseUrl}.\n\nHappy uploading.`,
          });
        }
        return ok({ token: issue(row), user: toApiUser({ ...row, avatarUrl: null, externalId: null, storageQuota: 0, storageUsed: 0, fileCount: 0 } as never) });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ username: t.String(), password: t.String(), email: t.Optional(t.String()) }) },
  )
  .post(
    "/login",
    async (ctx) => {
      try {
        const { username, password } = ctx.body as { username: string; password: string };
        rateLimit(`login:${meta(ctx).ip}`, 12, 5 * 60 * 1000);

        // Supabase-managed passwords: GoTrue verifies, we mirror the user locally.
        if (config.supabasePasswordLogin && supabaseEnabled()) {
          const session = await passwordGrant(username, password);
          const resolved = await userFromToken(session.access_token);
          if (!resolved) throw unauthorized("this account is disabled");
          await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, resolved.user.id));
          await logActivity("user.login", { id: resolved.user.id, username: resolved.user.username, ip: meta(ctx).ip });
          return ok({
            token: session.access_token,
            refreshToken: session.refresh_token ?? null,
            expiresIn: session.expires_in ?? null,
            user: toApiUser({ ...resolved.user, lastLoginAt: new Date() }),
          });
        }

        const user = await findUserByName(username);
        if (!user || !verifyPassword(user.passwordHash, password)) throw unauthorized("incorrect username or password");
        if (user.status !== "active") throw forbidden("this account is disabled");
        await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        await logActivity("user.login", { id: user.id, username: user.username, ip: meta(ctx).ip });
        return ok({ token: issue(user), user: toApiUser({ ...user, lastLoginAt: new Date() }) });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ username: t.String(), password: t.String() }) },
  )
  .post("/logout", () => ok({ signedOut: true }))
  .patch(
    "/password",
    async (ctx) => {
      try {
        const header = ctx.request.headers.get("authorization");
        const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
        const resolved = await userFromToken(token);
        if (!resolved) throw unauthorized();
        const { current, next } = ctx.body as { current: string; next: string };
        if (!verifyPassword(resolved.user.passwordHash, current)) throw badRequest("current password is incorrect");
        await getDb()
          .update(users)
          .set({ passwordHash: hashPassword(next), updatedAt: new Date() })
          .where(eq(users.id, resolved.user.id));
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ current: t.String(), next: t.String() }) },
  )
  .patch(
    "/profile",
    async (ctx) => {
      try {
        const header = ctx.request.headers.get("authorization");
        const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
        const resolved = await userFromToken(token);
        if (!resolved) throw unauthorized();
        const body = ctx.body as { email?: string; defaultAccess?: string };
        await getDb()
          .update(users)
          .set({
            email: body.email ?? resolved.user.email,
            defaultAccess: body.defaultAccess === "private" ? "private" : "public",
            updatedAt: new Date(),
          })
          .where(eq(users.id, resolved.user.id));
        return ok({ updated: true });
      } catch (err) {
        const mapped = handleError(err);
        ctx.set.status = mapped.status;
        return mapped.body;
      }
    },
    { body: t.Object({ email: t.Optional(t.String()), defaultAccess: t.Optional(t.String()) }) },
  );
