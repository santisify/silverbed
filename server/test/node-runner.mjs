/**
 * Runs the bundled API on plain Node (no Bun, no Vercel) — a smoke check that
 * the serverless entry really is Node-compatible.
 *
 *   bun run build:vercel
 *   node server/test/node-runner.mjs ./api/handler.js
 *
 * Serves the bundled handler over node:http by translating requests to the web
 * standard ones Elysia's `handle()` expects.
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";

const entry = process.argv[2] ?? "./api/handler.js";
const port = Number(process.env.PORT ?? 8900);

const module = await import(new URL(entry, `file://${process.cwd()}/`).href);
const exported = module.default?.fetch ? module.default : (module.default?.default ?? module.default);
// The serverless entry exports `{ fetch }`; a Bun-style entry exports the app itself.
const app = typeof exported?.handle === "function" ? exported : { handle: (request) => exported.fetch(request) };
if (typeof exported?.fetch !== "function" && typeof exported?.handle !== "function") {
  console.error(`the entry at ${entry} did not export an Elysia app or a fetch handler`);
  process.exit(1);
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"]);

const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? "half" : undefined,
    });

    const response = await app.handle(request);
    const outgoing = {};
    for (const [key, value] of response.headers) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) outgoing[key] = value;
    }
    res.writeHead(response.status, outgoing);
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("[node-runner]", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "server_error", message: String(err?.message ?? err) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`node runner → http://127.0.0.1:${port}`);
});
