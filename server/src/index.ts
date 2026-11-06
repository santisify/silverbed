import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import { createApp, type AppInstance } from "./app";
import { dbDriver } from "./db";

/**
 * Bun/Docker entry point: the same API plus static hosting for the built SPA.
 * Serverless deployments (Vercel) import `app.ts` instead and let the platform
 * serve `web/dist` from its CDN.
 */
let app: AppInstance;
try {
  app = await createApp();
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
}

const webDist = resolve(config.webDist);

// Serve the built SPA when present, with history fallback for client routes.
if (existsSync(join(webDist, "index.html"))) {
  app.get("/assets/*", async ({ params, set }) => {
    const file = Bun.file(join(webDist, "assets", params["*"]));
    if (!(await file.exists())) {
      set.status = 404;
      return "not found";
    }
    set.headers["Cache-Control"] = "public, max-age=31536000, immutable";
    return file;
  });
  app.get("/favicon.svg", () => Bun.file(join(webDist, "favicon.svg")));
  app.get("/fonts/*", async ({ params, set }) => {
    const file = Bun.file(join(webDist, "fonts", params["*"]));
    if (!(await file.exists())) {
      set.status = 404;
      return "not found";
    }
    set.headers["Cache-Control"] = "public, max-age=31536000, immutable";
    return file;
  });
  app.get("/*", ({ request, set }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/i/")) {
      set.status = 404;
      return { code: "not_found", message: "route not found" };
    }
    set.headers["Cache-Control"] = "no-cache";
    return Bun.file(join(webDist, "index.html"));
  });
}

app.listen({ port: config.port, hostname: config.host });

console.log(`\n  Silverbed API  http://${config.host}:${config.port}`);
console.log(`  driver=${dbDriver()}  storage=${config.storageDriver}  web=${existsSync(join(webDist, "index.html")) ? webDist : "not built"}\n`);
export type App = typeof app;
