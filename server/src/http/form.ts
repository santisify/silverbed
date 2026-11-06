import type { Context } from "elysia";

export interface UploadForm {
  files: File[];
  text(key: string): string | null;
}

const isFile = (value: unknown): value is File =>
  typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function" && "name" in (value as object);

/**
 * Elysia consumes multipart bodies before the handler runs (the parsed value
 * lands on `ctx.body`), so normalise both shapes into one small interface.
 */
export async function readForm(ctx: Context): Promise<UploadForm> {
  const body = (ctx as unknown as { body?: unknown }).body;

  if (body instanceof FormData) {
    return {
      files: [...body.getAll("files"), ...body.getAll("file")].filter(isFile),
      text: (key) => {
        const value = body.get(key);
        return typeof value === "string" ? value : null;
      },
    };
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const collect = (key: string): File[] => {
      const value = record[key];
      if (isFile(value)) return [value];
      if (Array.isArray(value)) return value.filter(isFile);
      return [];
    };
    return {
      files: [...collect("files"), ...collect("file")],
      text: (key) => {
        const value = record[key];
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        return null;
      },
    };
  }

  const form = await ctx.request.formData();
  return {
    files: [...form.getAll("files"), ...form.getAll("file")].filter(isFile),
    text: (key) => {
      const value = form.get(key);
      return typeof value === "string" ? value : null;
    },
  };
}
