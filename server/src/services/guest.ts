import type { Context } from "elysia";
import { SITE_GUEST_USER } from "./guestUser";
import { storeUpload } from "./files";
import { rateLimit } from "../middleware/context";
import { readForm } from "../http/form";

/** Handles anonymous uploads by mapping them onto the reserved guest account. */
export async function guestUpload(ctx: Context) {
  const ip = (ctx.request.headers.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  rateLimit(`guest-upload:${ip}`, 20, 60 * 60 * 1000);
  const form = await readForm(ctx);
  const entries = form.files;
  if (!entries.length) {
    return json({ code: "bad_request", message: "no files provided" }, 400);
  }
  const guestId = await SITE_GUEST_USER();
  const results = [];
  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const stored = await storeUpload({
      userId: guestId,
      bytes,
      originalName: entry.name,
      accessLevel: "public",
      uploadedVia: "guest",
    });
    results.push(stored);
  }
  return json({ code: 0, data: { files: results } }, 200);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
