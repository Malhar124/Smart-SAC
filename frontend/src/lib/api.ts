import { API_BASE_URL } from "@/lib/config";

export interface FieldError {
  path?: string;
  location?: string;
  message: string;
  code?: string;
  [key: string]: unknown;
}

/** A failed API call. `errors` carries one entry per invalid field, or a `code` for special cases. */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: FieldError[];

  constructor(status: number, message: string, errors: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }

  /** The `code` of the first error entry, e.g. BORROWING_BLOCKED or EMAIL_NOT_VERIFIED */
  get code(): string | undefined {
    return this.errors.find((e) => e.code)?.code;
  }

  /** Field path -> message, for showing errors under inputs */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.errors) if (e.path && !out[e.path]) out[e.path] = e.message;
    return out;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export type AccountKind = "student" | "admin";

// ---------------------------------------------------------------- session refresh

let accountKind: AccountKind | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let sessionExpiredHandler: (() => void) | null = null;

/** Which account's refresh endpoint to use when a request comes back 401 */
export const setAccountKind = (kind: AccountKind | null) => {
  accountKind = kind;
};

/** Called once a refresh fails, so the app can sign the person out */
export const onSessionExpired = (handler: (() => void) | null) => {
  sessionExpiredHandler = handler;
};

const refreshPath = (kind: AccountKind) => (kind === "admin" ? "/admin/refresh-token" : "/users/refresh-token");

const postRefresh = (kind: AccountKind) =>
  fetch(`${API_BASE_URL}${refreshPath(kind)}`, { method: "POST", credentials: "include" })
    .then((res) => res.ok)
    .catch(() => false);

/**
 * Rotate the session cookies. Concurrent 401s share one refresh request, so a page that fires
 * five queries at once after the access token expires refreshes once, not five times.
 * Other tabs take turns through a Web Lock: the server ends a session when a refresh token that was
 * already used comes back, so two tabs must never send the same one. The tab that waits sends the
 * newer cookie the first tab received.
 */
export const refreshSession = (kind: AccountKind | null = accountKind): Promise<boolean> => {
  if (!kind) return Promise.resolve(false);
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  refreshInFlight ??= (locks ? locks.request("smart-sac-session-refresh", () => postRefresh(kind)) : postRefresh(kind)).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
};

// ---------------------------------------------------------------- requests

type Method = "GET" | "POST" | "PATCH" | "DELETE";

const NO_REFRESH = ["/refresh-token", "/login", "/register"];

async function request<T>(method: Method, endpoint: string, body?: unknown, retried = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the Smart SAC server. Check your connection and try again.");
  }

  if (response.status === 401 && !retried && accountKind && !NO_REFRESH.some((p) => endpoint.includes(p))) {
    if (await refreshSession()) return request<T>(method, endpoint, body, true);
    sessionExpiredHandler?.();
  }

  let payload: { success?: boolean; message?: string; errors?: FieldError[]; data?: T } | null = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new ApiError(response.status, "The server sent an unexpected response. Try again in a moment.");
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(response.status, payload?.message ?? "Something went wrong. Try again.", payload?.errors ?? []);
  }
  return (payload?.data ?? payload) as T;
}

export const api = {
  get: <T = unknown>(endpoint: string) => request<T>("GET", endpoint),
  post: <T = unknown>(endpoint: string, body?: unknown) => request<T>("POST", endpoint, body ?? {}),
  patch: <T = unknown>(endpoint: string, body?: unknown) => request<T>("PATCH", endpoint, body ?? {}),
  delete: <T = unknown>(endpoint: string) => request<T>("DELETE", endpoint),
};

/** Query string from an object, skipping empty values */
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};
