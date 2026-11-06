import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { getDb } from "../db";
import { oauthStates } from "../db/schema";
import { badRequest, forbidden } from "../lib/http";
import { newToken } from "../lib/ids";
import { signToken } from "../lib/jwt";
import { ensureExternalUser } from "../services/auth";
import { logActivity } from "../services/activity";
import { handleError } from "../http/respond";

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
}

function providerConfig(provider: string): ProviderConfig | null {
  if (provider === "github" && config.githubClientId && config.githubClientSecret) {
    return {
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userUrl: "https://api.github.com/user",
      scope: "read:user user:email",
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    };
  }
  if (provider === "google" && config.googleClientId && config.googleClientSecret) {
    return {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: "openid email profile",
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    };
  }
  return null;
}

const callbackUrl = (provider: string) => `${config.publicBaseUrl}/api/v1/oauth/${provider}/callback`;

export const oauthRoutes = new Elysia({ prefix: "/api/v1/oauth" })
  .get("/:provider/start", async (ctx) => {
    const provider = ctx.params.provider;
    const cfg = providerConfig(provider);
    if (!cfg) return new Response("this sign-in provider is not configured", { status: 404 });
    const state = newToken();
    await getDb().insert(oauthStates).values({ state, provider, redirect: (ctx.query as Record<string, string>).redirect ?? "/", createdAt: new Date() });
    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(provider));
    url.searchParams.set("scope", cfg.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    return new Response(null, { status: 302, headers: { Location: url.toString() } });
  })
  .get("/:provider/callback", async (ctx) => {
    try {
      const provider = ctx.params.provider;
      const cfg = providerConfig(provider);
      if (!cfg) throw forbidden("this sign-in provider is not configured");
      const { code, state } = ctx.query as Record<string, string>;
      if (!code || !state) throw badRequest("missing OAuth code or state");
      const stored = (await getDb().select().from(oauthStates).where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider))).limit(1))[0];
      if (!stored) throw badRequest("invalid OAuth state, please retry sign-in");
      await getDb().delete(oauthStates).where(eq(oauthStates.state, state));

      const tokenRes = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: callbackUrl(provider),
          grant_type: "authorization_code",
        }),
      });
      const tokenJson = (await tokenRes.json()) as Record<string, string>;
      const accessToken = tokenJson.access_token;
      if (!accessToken) throw badRequest(tokenJson.error_description ?? "could not exchange OAuth code");

      const profileRes = await fetch(cfg.userUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "silverbed" },
      });
      const profile = (await profileRes.json()) as Record<string, unknown>;

      let email = (profile.email as string | undefined) ?? null;
      if (provider === "github" && !email) {
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "silverbed" },
        });
        const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
      }

      const externalId = String(profile.id ?? profile.sub ?? "");
      if (!externalId) throw badRequest("OAuth provider did not return an account id");
      const username = String(profile.login ?? profile.name ?? email?.split("@")[0] ?? `user_${externalId.slice(0, 6)}`);
      const avatar = String(profile.avatar_url ?? profile.picture ?? "") || undefined;

      const user = await ensureExternalUser({ externalId, email: email ?? undefined, username, avatarUrl: avatar, provider });
      await logActivity(`user.oauth.${provider}`, { id: user.id, username: user.username }, email ?? "");
      const token = signToken({ sub: user.id, role: user.role, username: user.username });
      const redirectTo = `${stored.redirect ?? "/"}${(stored.redirect ?? "/").includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
      return new Response(null, { status: 302, headers: { Location: redirectTo } });
    } catch (err) {
      const mapped = handleError(err);
      return new Response(null, {
        status: 302,
        headers: { Location: `/?authError=${encodeURIComponent(mapped.body.message)}` },
      });
    }
  });
