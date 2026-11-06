import { Elysia } from "elysia";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files } from "../db/schema";
import { getBool, getSetting } from "../db/settings";
import { config } from "../config";
import { storage } from "../services/storage";
import { logAccess } from "../services/activity";
import { currentUser, originAllowed } from "../middleware/context";

const NOT_MODIFIED = new Response(null, { status: 304 });

const cacheHeaders = (contentType: string, etag: string, immutable: boolean) => ({
  "Content-Type": contentType,
  "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
  ETag: etag,
  "X-Content-Type-Options": "nosniff",
});

async function resolveFile(id: string) {
  return (
    await getDb()
      .select()
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1)
  )[0];
}

/**
 * Public asset delivery: /i/<id>.<ext>, /i/<id>.thumb.webp, /i/<id>.preview.webp
 * Honours access level, expiry, hotlink protection and counts views/downloads.
 */
export const assetRoutes = new Elysia()
  .get("/i/:filename", async (ctx) => {
    const filename = ctx.params.filename;
    const download = (ctx.query as Record<string, string>).dl === "1";
    let id = filename;
    let variant: "orig" | "thumb" | "preview" = "orig";

    if (filename.endsWith(".thumb.webp")) {
      id = filename.slice(0, -".thumb.webp".length);
      variant = "thumb";
    } else if (filename.endsWith(".preview.webp")) {
      id = filename.slice(0, -".preview.webp".length);
      variant = "preview";
    } else {
      const dot = filename.lastIndexOf(".");
      id = dot > 0 ? filename.slice(0, dot) : filename;
    }

    const file = await resolveFile(id);
    if (!file) return new Response("not found", { status: 404 });
    if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
      return new Response("this image has expired", { status: 410 });
    }

    // Private images require the owner (or an admin) session.
    if (file.accessLevel === "private" || file.status !== "active") {
      const viewer = await currentUser(ctx).catch(() => null);
      if (!viewer || (viewer.id !== file.userId && viewer.role !== "admin")) {
        return new Response("not found", { status: 404 });
      }
    } else if (await getBool("hotlink_protect")) {
      const allowed = await getSetting("allowed_domains");
      const referer = ctx.request.headers.get("referer") ?? "";
      if (!originAllowed(referer, allowed)) {
        return new Response("hotlinking is not allowed for this file", { status: 403 });
      }
    }

    const key = variant === "thumb" ? file.thumbKey : variant === "preview" ? file.previewKey : file.storageKey;
    if (!key) return new Response("variant not available", { status: 404 });

    const etag = `"${file.id}-${variant}-${file.updatedAt.getTime()}"`;
    if (ctx.request.headers.get("if-none-match") === etag) return NOT_MODIFIED;

    // With an S3/R2 bucket the browser can fetch the bytes itself: a public
    // object by its CDN URL, a private one via a short-lived signature. That
    // keeps large originals out of the function's 4.5 MB response budget.
    const driver = storage();
    const disposition = download ? `attachment; filename="${encodeURIComponent(file.name)}"` : undefined;
    const publicUrl = !disposition && file.accessLevel === "public" ? driver.publicUrl(key) : null;
    const target = publicUrl ?? (await driver.signedGetUrl(key, 300, disposition).catch(() => null));

    if (target) {
      void getDb()
        .update(files)
        .set(download ? { downloads: sql`${files.downloads} + 1` } : { views: sql`${files.views} + 1` })
        .where(eq(files.id, file.id))
        .catch(() => {});
      void logAccess({
        fileId: file.id,
        userId: file.userId,
        kind: download ? "download" : "view",
        ip: (ctx.request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "",
        referer: ctx.request.headers.get("referer") ?? "",
        userAgent: ctx.request.headers.get("user-agent") ?? "",
        bytes: variant === "orig" ? file.size : 0,
      }).catch(() => {});
      return new Response(null, {
        status: 302,
        headers: {
          Location: target,
          "Cache-Control": publicUrl
            ? variant === "orig"
              ? "public, max-age=86400"
              : "public, max-age=31536000, immutable"
            : "no-store",
        },
      });
    }

    const object = await driver.get(key);
    if (!object) return new Response("object missing from storage", { status: 404 });

    const contentType = variant === "orig" ? file.mime : "image/webp";
    void getDb()
      .update(files)
      .set(download ? { downloads: sql`${files.downloads} + 1` } : { views: sql`${files.views} + 1` })
      .where(eq(files.id, file.id))
      .catch(() => {});
    void logAccess({
      fileId: file.id,
      userId: file.userId,
      kind: download ? "download" : "view",
      ip: (ctx.request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "",
      referer: ctx.request.headers.get("referer") ?? "",
      userAgent: ctx.request.headers.get("user-agent") ?? "",
      bytes: object.size,
    }).catch(() => {});

    const headers: Record<string, string> = cacheHeaders(contentType, etag, variant !== "orig");
    if (variant === "orig") headers["Cache-Control"] = "public, max-age=86400";
    if (file.ext === "svg") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    if (download) headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(file.name)}"`;
    return new Response(object.body as BodyInit, { headers });
  })
  .get("/image/:id", async (ctx) => {
    const file = await resolveFile(ctx.params.id);
    if (!file) return new Response("not found", { status: 404 });
    if (file.accessLevel === "private") {
      const viewer = await currentUser(ctx).catch(() => null);
      if (!viewer || (viewer.id !== file.userId && viewer.role !== "admin")) return new Response("not found", { status: 404 });
    }
    const url = `${config.publicBaseUrl}/i/${file.id}.${file.ext}`;
    const thumb = file.thumbKey ? `${config.publicBaseUrl}/i/${file.id}.thumb.webp` : url;
    const dimensions = file.width && file.height ? `${file.width}×${file.height}` : "";
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(file.name)} — ${escapeHtml(await getSetting("site_name"))}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(file.name)}" />
<meta property="og:image" content="${thumb}" />
<meta property="og:description" content="${dimensions} · ${file.size} bytes" />
<meta name="twitter:card" content="summary_large_image" />
<style>body{margin:0;background:#0f0f10;color:#f4f4f2;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{max-width:min(1100px,94vw);text-align:center}img{max-width:100%;height:auto;border-radius:2px}
dl{display:flex;gap:1.5rem;justify-content:center;margin:1rem 0 0;color:#a1a1a0;font-size:13px}dt{display:none}</style>
</head><body><main>
<h1 style="font-size:16px;font-weight:500;margin:0 0 1rem">${escapeHtml(file.name)}</h1>
<img src="${url}" alt="${escapeHtml(file.name)}" />
<dl><dd>${dimensions}</dd><dd>${(file.size / 1024).toFixed(1)} KB</dd><dd>${escapeHtml(file.ext.toUpperCase())}</dd></dl>
</main></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
  });

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}


/** Guest upload surface, used by the landing page when enabled. */
export const publicUploadRoutes = new Elysia({ prefix: "/api/v1/public" }).post("/upload", async (ctx) => {
  const enabled = await getBool("guest_upload");
  if (!enabled) return new Response(JSON.stringify({ code: "forbidden", message: "guest uploads are disabled" }), { status: 403, headers: { "Content-Type": "application/json" } });
  const { guestUpload } = await import("../services/guest");
  return guestUpload(ctx);
});

