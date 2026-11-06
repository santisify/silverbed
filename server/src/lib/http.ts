export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, "bad_request");
export const unauthorized = (msg = "sign in to continue") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "you do not have access to this resource") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "not found") => new HttpError(404, msg, "not_found");
export const conflict = (msg = "already exists") => new HttpError(409, msg, "conflict");
export const tooMany = (msg = "too many requests") => new HttpError(429, msg, "rate_limited");

export const ok = <T,>(data: T) => ({ code: 0, data });
export const failBody = (code: string, message: string) => ({ code, message });

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pagination(query: { page?: string | number; pageSize?: string | number }, defaultSize = 40) {
  const page = Math.max(1, Number(query.page) || 1);
  const raw = Number(query.pageSize) || defaultSize;
  const pageSize = Math.min(200, Math.max(1, raw));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}
