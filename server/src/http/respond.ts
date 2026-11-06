import type { Context } from "elysia";
import { HttpError } from "../lib/http";

export const ok = <T,>(data: T) => ({ code: 0, data });

export const paged = <T,>(items: T[], total: number, page: number, pageSize: number) => ({
  code: 0,
  data: { items, total, page, pageSize },
});

export function fail(status: number, code: string, message: string) {
  return { status, body: { code, message } } as const;
}

/**
 * Elysia raises tagged objects for routing, parsing and validation failures —
 * they are not HttpErrors, but they are still the client's fault. Mapping them
 * here keeps a mistyped URL from being reported as a logged 500.
 */
const TAGGED: Record<string, { status: number; code: string }> = {
  NOT_FOUND: { status: 404, code: "not_found" },
  PARSE: { status: 400, code: "bad_request" },
  VALIDATION: { status: 400, code: "bad_request" },
  INVALID_COOKIE_SIGNATURE: { status: 400, code: "bad_request" },
  INVALID_FILE_TYPE: { status: 422, code: "bad_request" },
};

const GENERIC: Record<string, string> = {
  not_found: "route not found",
  bad_request: "the request could not be understood",
};

/** Turns Elysia's serialised validation blob into one readable sentence. */
function describe(message: unknown, tag: string, code: string): string {
  const raw = typeof message === "string" ? message.trim() : "";
  if (!raw || raw === tag) return GENERIC[code] || "request rejected";
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { summary?: string; message?: string; property?: string };
      if (parsed.summary) return parsed.summary.slice(0, 200);
      if (parsed.property && parsed.message) return `${parsed.property}: ${parsed.message}`.slice(0, 200);
    } catch {
      /* not JSON after all */
    }
    return GENERIC[code] || "request rejected";
  }
  return raw.slice(0, 200);
}

export function handleError(
  err: unknown,
  request?: Request,
): { status: number; body: { code: string; message: string } } {
  if (err instanceof HttpError) return fail(err.status, err.code, err.message);

  const tagged = err as { code?: unknown; status?: unknown; message?: unknown } | null;
  const tag = typeof tagged?.code === "string" ? tagged.code : "";
  const status = typeof tagged?.status === "number" ? tagged.status : 0;

  const mapped = TAGGED[tag];
  if (mapped) {
    return fail(mapped.status, mapped.code, describe(tagged?.message, tag, mapped.code));
  }

  // Anything else that already carries a 4xx status is a domain answer we did
  // not wrap — surface it rather than escalating to 500.
  if (status >= 400 && status < 500) {
    return fail(status, tag || "bad_request", String(tagged?.message ?? GENERIC.bad_request));
  }

  const where = request ? ` ${request.method} ${new URL(request.url).pathname}` : "";
  console.error(`[api] unhandled error${where}:`, err);
  const message = err instanceof Error ? err.message : String(err);
  return fail(500, "server_error", message);
}

export const meta = (ctx: Context) => ({
  ip: (ctx.request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "127.0.0.1",
  userAgent: ctx.request.headers.get("user-agent") ?? "",
  referer: ctx.request.headers.get("referer") ?? "",
});
