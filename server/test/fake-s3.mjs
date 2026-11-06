/**
 * A throwaway S3-compatible endpoint for local checks: path-style PUT/GET/HEAD/
 * DELETE over an in-memory map. It does not verify signatures — it exists so the
 * direct-upload flow (sign → PUT → import → 302 to the object) can be exercised
 * without a real bucket.
 *
 *   node server/test/fake-s3.mjs [port]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9900);
const objects = new Map();

const keyOf = (url) => {
  const path = decodeURIComponent(new URL(url, "http://x").pathname).replace(/^\//, "");
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(slash + 1);
};

const server = createServer((req, res) => {
  const key = keyOf(req.url);
  if (!key) {
    res.writeHead(400).end("no key");
    return;
  }

  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      objects.set(key, { body, type: req.headers["content-type"] ?? "application/octet-stream" });
      res.writeHead(200, { ETag: `"${body.length}"` }).end();
    });
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(objects.has(key) ? 200 : 404).end();
    return;
  }

  if (req.method === "DELETE") {
    objects.delete(key);
    res.writeHead(204).end();
    return;
  }

  const object = objects.get(key);
  if (!object) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": object.type, "Content-Length": object.body.length }).end(object.body);
});

server.listen(port, "127.0.0.1", () => console.log(`fake s3 → http://127.0.0.1:${port}`));
