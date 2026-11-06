import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { config } from "./config";
import { connect, dbDriver } from "./db";
import { seedSettings } from "./db/settings";
import { authRoutes } from "./routes/auth";
import { setupRoutes } from "./routes/setup";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { tagRoutes } from "./routes/tags";
import { shareRoutes, publicShareRoutes } from "./routes/shares";
import { apiKeyRoutes } from "./routes/keys";
import { statsRoutes } from "./routes/stats";
import { adminRoutes } from "./routes/admin";
import { assetRoutes, publicUploadRoutes } from "./routes/assets";
import { oauthRoutes } from "./routes/oauth";
import { metaRoutes } from "./routes/meta";
import { shareAssetRoutes } from "./routes/publicShare";
import { galleryRoutes } from "./routes/gallery";
import { uploadRoutes } from "./routes/uploads";
import { handleError } from "./http/respond";

/**
 * Connect at boot and translate the usual remote-database mistakes into
 * something actionable — a raw "connection refused" tells an operator nothing.
 */
async function boot() {
  try {
    await connect();
  } catch (err) {
    const message = String((err as Error).message ?? err);
    const hints: string[] = [];
    if (config.databaseUrl) {
      const target = config.databaseUrl.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@");
      hints.push(`DATABASE_URL: ${target}`);
      if (/ECONNREFUSED|connect_timeout|ETIMEDOUT|ENOTFOUND/i.test(message)) {
        hints.push("the host or port is unreachable — check the firewall, that Supabase is running,");
        hints.push("and that the pooler port (6543) is exposed, not only Postgres (5432).");
      }
      if (/SSL|TLS|certificate|self.signed/i.test(message)) {
        hints.push("TLS negotiation failed — set DATABASE_SSL=require (encrypt, no verify) or");
        hints.push("DATABASE_SSL=verify-full with DATABASE_SSL_CA pointing at your CA.");
      }
      if (/prepared statement/i.test(message)) {
        hints.push("a prepared statement leaked into a transaction-mode pooler; keep prepare:false.");
      }
      if (/password|authentication|role .* does not exist/i.test(message)) {
        hints.push("credentials rejected — for Supavisor the user is postgres.<tenant> on 6543.");
      }
    }
    throw new Error(["could not open the database", message, ...hints].join("\n"));
  }
  await seedSettings();
}

/** Builds the API app. Kept free of Bun-only APIs so it also runs on Node. */
function build() {
  return new Elysia()
    .use(cors({ origin: config.allowOrigin === "*" ? true : config.allowOrigin.split(","), credentials: true }))
    .onError(({ error, set, request }) => {
      const mapped = handleError(error, request);
      set.status = mapped.status;
      return mapped.body;
    })
    .onAfterHandle(({ request, set }) => {
      if (!request.url.includes("/api/")) return;
      set.headers["X-Powered-By"] = "Silverbed";
    })
    .get("/api/v1/health", () => ({
      code: 0,
      data: { status: "ok", driver: dbDriver(), uptime: Math.round(process.uptime()), version: "1.0.0" },
    }))
    .use(metaRoutes)
    .use(setupRoutes)
    .use(authRoutes)
    .use(oauthRoutes)
    .use(fileRoutes)
    .use(uploadRoutes)
    .use(folderRoutes)
    .use(tagRoutes)
    .use(shareRoutes)
    .use(apiKeyRoutes)
    .use(statsRoutes)
    .use(adminRoutes)
    .use(galleryRoutes)
    .use(publicShareRoutes)
    .use(publicUploadRoutes)
    .use(shareAssetRoutes)
    .use(assetRoutes);
}

let pending: Promise<AppInstance> | null = null;

/** The concrete Elysia type, so route typing survives the wrapper. */
export type AppInstance = ReturnType<typeof build>;

/**
 * Boots the database once per process and returns the app. Serverless runtimes
 * reuse the module between invocations, so the connection survives warm calls.
 */
export async function createApp(): Promise<AppInstance> {
  if (!pending) {
    pending = (async () => {
      await boot();
      return build();
    })();
  }
  return pending;
}
