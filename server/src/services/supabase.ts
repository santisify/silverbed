/**
 * Minimal Supabase Auth (GoTrue) client for self-hosted deployments.
 *
 * We talk to the GoTrue REST API directly rather than pulling in the Supabase
 * JS SDK: the API only needs the password grant, which is two POSTs. Using the
 * anon key keeps the requests identical to what the browser would send, so
 * rate limits and security settings on the Supabase side behave the same.
 *
 * Only used when SUPABASE_PASSWORD_LOGIN=true — otherwise passwords are
 * verified against our own scrypt hashes.
 */
import { config } from "../config";
import { badRequest, unauthorized } from "../lib/http";

export const supabaseEnabled = () => Boolean(config.supabaseUrl);

function endpoint(path: string): string {
  return `${config.supabaseUrl}/auth/v1${path}`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.supabaseAnonKey) h.apikey = config.supabaseAnonKey;
  return h;
}

export interface GotrueUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface GotrueSession {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user: GotrueUser;
}

/** Turns GoTrue's error envelope into our error type. */
async function failure(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { msg?: string; error_description?: string; message?: string; error?: string };
    message = body.msg || body.error_description || body.message || body.error || fallback;
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 400 || res.status === 401) throw unauthorized(message);
  throw badRequest(message);
}

/**
 * Password grant. Accepts either an email address or a username: self-hosted
 * GoTrue needs `email`, so a bare username only works when it is an email.
 */
export async function passwordGrant(identifier: string, password: string): Promise<GotrueSession> {
  if (!supabaseEnabled()) throw badRequest("Supabase auth is not configured");

  const value = identifier.trim();
  const payload = value.includes("@")
    ? { email: value.toLowerCase(), password }
    : { email: value, password };

  const res = await fetch(endpoint("/token?grant_type=password"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return failure(res, "incorrect username or password");
  return (await res.json()) as GotrueSession;
}

/** Creates an account in Supabase. Emails must already be confirmed by the admin flow. */
export async function signUp(input: {
  email: string;
  password: string;
  username: string;
}): Promise<GotrueSession | null> {
  if (!supabaseEnabled()) throw badRequest("Supabase auth is not configured");
  const res = await fetch(endpoint("/signup"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      data: { username: input.username },
      gotrue_meta_security: {},
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return failure(res, "could not create the account");
  const body = (await res.json()) as GotrueSession | { user?: GotrueUser };
  // Auto-confirm off (the default) returns just { user } with no session.
  return "access_token" in body ? (body as GotrueSession) : null;
}

/** Refreshes an access token, so long-lived sessions survive token expiry. */
export async function refreshSession(refreshToken: string): Promise<GotrueSession> {
  if (!supabaseEnabled()) throw badRequest("Supabase auth is not configured");
  const res = await fetch(endpoint("/token?grant_type=refresh_token"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return failure(res, "your session has expired");
  return (await res.json()) as GotrueSession;
}

/** Updates a password using the Supabase-side user id (admin/service context). */
export async function adminUpdatePassword(userId: string, password: string): Promise<void> {
  if (!supabaseEnabled() || !config.supabaseAnonKey) throw badRequest("Supabase admin access is not configured");
  const res = await fetch(endpoint(`/admin/users/${encodeURIComponent(userId)}`), {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return failure(res, "could not update the password in Supabase");
}

/** The public settings Supabase exposes — useful for a health/diagnostics view. */
export async function health(): Promise<{ ok: boolean; url: string; detail?: string }> {
  const url = endpoint("/settings");
  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, url, detail: `HTTP ${res.status}` };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, url, detail: (err as Error).message };
  }
}
