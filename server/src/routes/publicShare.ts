import { Elysia } from "elysia";
import { buildShareZip } from "./shares";
import { handleError } from "../http/respond";

export const shareAssetRoutes = new Elysia().get("/s/:token/download", async (ctx) => {
  try {
    const archive = await buildShareZip(ctx.params.token);
    return new Response(archive.data as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const mapped = handleError(err);
    return new Response(JSON.stringify(mapped.body), {
      status: mapped.status,
      headers: { "Content-Type": "application/json" },
    });
  }
});
