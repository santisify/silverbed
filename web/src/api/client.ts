export interface ApiResult<T> {
    code: number;
    data: T;
}

export class ApiError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const TOKEN_KEY = "sb.token";

export const tokenStore = {
    get(): string | null {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch {
            return null;
        }
    },
    set(token: string | null) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch {
            /* ignore */
        }
    },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
    onUnauthorized = fn;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const token = tokenStore.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    const res = await fetch(`/api/v1${path}`, {...init, headers});
    const text = await res.text();
    let payload: any = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }
    if (!res.ok) {
        const message = payload?.message ?? res.statusText ?? "request failed";
        if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized?.();
        throw new ApiError(res.status, payload?.code ?? "error", message);
    }
    return (payload?.data ?? payload) as T;
}

export const http = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
          method: "POST",
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)
      }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, {method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body)}),
    del: <T>(path: string) => request<T>(path, {method: "DELETE"}),
    raw: request,
};
