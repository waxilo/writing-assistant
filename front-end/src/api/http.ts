// Use the platform's native fetch so the same code runs both in the browser
// (web deployment) and inside the Tauri webview. The backend sends permissive
// CORS headers and auth uses Bearer tokens (not cookies), so cross-origin
// requests work in both environments.
//
// Auth model: a short-lived access token + a long-lived refresh token. This
// module transparently keeps the access token fresh:
//   - before each request, if the access token is expired/near-expiry, it is
//     refreshed first (single-flight so concurrent requests share one refresh);
//   - if a request still comes back 401, one *forced* refresh + retry is attempted
//     (skips the local expiry check to cover clock skew);
//   - a proactive timer refreshes shortly before expiry so it happens in the
//     background, invisible to the user.
import { API_BASE_URL } from "../config";
import type { ApiResponse } from "../types/api";
import type { AuthTokens } from "../types/auth";
import { showToast } from "../composables/useToast";
import {
  getAccessToken,
  getRefreshToken,
  getStoredRefreshToken,
  getAccessExp,
  setSession,
  clearSession,
} from "./tokenStore";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  /** Parsed JSON body; serialized automatically for non-GET requests. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip the auth token injection and silent-refresh flow (e.g. /logout). */
  skipAuthRefresh?: boolean;
}

/** Refresh proactively this many ms before the access token actually expires. */
const SKEW_MS = 60_000;

function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// --- silent refresh (single-flight) -----------------------------------------

let refreshPromise: Promise<boolean> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

/** Stop any pending proactive refresh timer. */
export function cancelProactiveRefresh(): void {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

/** Perform the actual /refresh call with a specific token. Returns true on success. */
async function refreshWith(refreshToken: string, isRetry: boolean): Promise<boolean> {
  markRequestStart();
  try {
    const res = await fetchWithTimeout(resolveUrl("/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const json: ApiResponse<AuthTokens> = await res.json();
    if (json.code !== 200 || !json.data) {
      if (json.code === 401 && !isRetry) {
        // The token we used was rejected. Another tab may have rotated it
        // while our request was in flight and already written a newer RT to
        // localStorage — read the SHARED storage (not the in-memory ref,
        // which is stale until the storage event arrives) and retry once.
        const latest = getStoredRefreshToken();
        if (latest && latest !== refreshToken) {
          return refreshWith(latest, true);
        }
      }
      // A genuine 401 (token rejected/revoked) ends the session; anything
      // else (5xx, 429) is a server hiccup and must NOT kick the user out —
      // keep the session and let the next attempt retry.
      if (json.code === 401) {
        cancelProactiveRefresh();
        // Surface the reason (e.g. "账号已在其他设备使用" after the
        // single-active-session kick) before dropping to the login screen.
        if (json.message) showToast(json.message, "error");
        clearSession();
      }
      return false;
    }
    setSession(json.data);
    scheduleProactiveRefresh();
    return true;
  } catch {
    // Network error / timeout: keep the session and let the next attempt retry
    // (a bad network must not kick the user to the login page).
    return false;
  } finally {
    markRequestEnd();
  }
}

/** Perform the actual /refresh call. Returns true on success. */
function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);
  return refreshWith(refreshToken, false);
}

/**
 * Single-flight refresh, ALSO across tabs: two tabs refreshing at the same
 * time used to race the server-side rotation (one loses and gets a 401).
 * `navigator.locks` (Web Locks API) serializes the refresh across same-origin
 * tabs where available; the in-memory promise is the fallback and covers
 * webviews without Web Locks support.
 */
async function runRefreshOnce(): Promise<boolean> {
  const locks = navigator.locks;
  if (locks && typeof locks.request === "function") {
    return locks.request("writer-token-refresh", { mode: "exclusive" }, () =>
      doRefresh()
    );
  }
  return doRefresh();
}

/**
 * Ensure the access token is fresh. Refreshes if expired/near-expiry (or always
 * when `force` is true), sharing a single in-flight refresh across callers.
 *
 * Use `force` on 401 recovery so clock skew / premature server rejection still
 * triggers a real /refresh instead of reusing a locally-"valid" AT.
 */
export function ensureFreshToken(force = false): Promise<boolean> {
  if (!getRefreshToken()) return Promise.resolve(false);
  if (!force && Date.now() < getAccessExp() - SKEW_MS) {
    return Promise.resolve(true);
  }
  if (!refreshPromise) {
    refreshPromise = runRefreshOnce().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Retry delay after a failed proactive refresh (network blip, etc.). */
const PROACTIVE_RETRY_MS = 30_000;

function runProactiveRefresh(): void {
  void ensureFreshToken().then((ok) => {
    // Success path reschedules inside doRefresh. On transient failure, keep retrying.
    if (!ok && getRefreshToken()) {
      proactiveTimer = setTimeout(runProactiveRefresh, PROACTIVE_RETRY_MS);
    }
  });
}

/** (Re)schedule a background refresh to fire shortly before the token expires. */
export function scheduleProactiveRefresh(): void {
  cancelProactiveRefresh();
  if (!getRefreshToken()) return;
  const delay = Math.max(getAccessExp() - Date.now() - SKEW_MS, 0);
  proactiveTimer = setTimeout(runProactiveRefresh, delay);
}

// --- global pending-request indicator ----------------------------------------

let pendingRequests = 0;
const pendingListeners = new Set<(active: boolean) => void>();

function emitPending(): void {
  const active = pendingRequests > 0;
  for (const listener of pendingListeners) listener(active);
}

function markRequestStart(): void {
  pendingRequests++;
  emitPending();
}

function markRequestEnd(): void {
  pendingRequests = Math.max(0, pendingRequests - 1);
  emitPending();
}

/** 订阅"是否有请求在途"，驱动全局顶部进度条。返回取消订阅函数。 */
export function onPendingChange(listener: (active: boolean) => void): () => void {
  pendingListeners.add(listener);
  listener(pendingRequests > 0);
  return () => pendingListeners.delete(listener);
}

// --- request -----------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * fetch with a hard timeout (AbortController, works in browsers and webviews
 * that predate AbortSignal.timeout). Throws a friendly error on timeout.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("请求超时，请检查网络");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildInit(
  method: HttpMethod,
  body: unknown,
  headers: Record<string, string> | undefined,
  withAuth: boolean
): RequestInit {
  const init: RequestInit = { method, headers: { ...headers } };
  if (withAuth) {
    const token = getAccessToken();
    if (token) {
      init.headers = { Authorization: `Bearer ${token}`, ...init.headers };
    }
  }
  if (method !== "GET" && body !== undefined && body !== null) {
    init.headers = { "Content-Type": "application/json", ...init.headers };
    init.body = JSON.stringify(body);
  }
  return init;
}

/**
 * Perform a request against the API and unwrap the standard envelope.
 * Transparently keeps the access token fresh and retries once on a 401.
 * Throws on transport errors or error codes.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  markRequestStart();
  try {
    return await doRequest<T>(path, options);
  } finally {
    markRequestEnd();
  }
}

async function doRequest<T>(
  path: string,
  options: RequestOptions
): Promise<T> {
  const { method = "GET", body, headers, skipAuthRefresh = false } = options;
  const url = resolveUrl(path);

  if (!skipAuthRefresh) {
    await ensureFreshToken(); // pre-flight: refresh if expired/near-expiry
  }

  let res = await fetchWithTimeout(
    url,
    buildInit(method, body, headers, !skipAuthRefresh)
  );
  let json: ApiResponse<T> = await parse(res);

  // Recovery: AT rejected despite pre-flight (e.g. clock skew) — force refresh.
  if (json.code === 401 && !skipAuthRefresh) {
    const ok = await ensureFreshToken(true);
    if (ok) {
      res = await fetchWithTimeout(url, buildInit(method, body, headers, true));
      json = await parse(res);
    } else if (getRefreshToken()) {
      // Transient /refresh failure (network): keep session, don't kick to login.
      throw clientError(401, json.message || "网络异常，请稍后重试");
    } else {
      // RT already cleared by doRefresh (rejected/revoked).
      throw clientError(401, json.message || "登录已失效，请重新登录");
    }
  }

  if (json.code === 401) {
    cancelProactiveRefresh();
    clearSession();
    throw clientError(json.code, json.message || "登录已失效，请重新登录", json.data);
  }
  if (json.code !== 200) {
    throw clientError(json.code, json.message || `Unexpected code: ${json.code}`, json.data);
  }
  return json.data;
}

/**
 * Error thrown for business-code failures. Carries the backend `code` (e.g.
 * 409) and the envelope `data` (e.g. the server's current version on a
 * conflict) so callers can branch on the failure kind and recover without
 * extra round-trips.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function clientError(code: number, message: string, data?: unknown): ApiClientError {
  return new ApiClientError(code, message, data);
}

/**
 * Read the envelope from a response. The body is parsed FIRST so a real
 * HTTP 401/500 still surfaces its `{ code, message }` (the 401-recovery logic
 * above keys off the envelope code, not the HTTP status). Only when the body
 * is not JSON do we fall back to a generic HTTP error.
 */
async function parse<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
}

/**
 * Synchronous, best-effort request for page-unload saves (Tauri window close /
 * tab close), where async fetch is not guaranteed to complete. Errors are
 * swallowed — this is a last-resort flush, not a primary save path.
 */
export function syncRequest(method: string, path: string, body: unknown): void {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open(method, resolveUrl(path), false);
    xhr.setRequestHeader("Content-Type", "application/json");
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(JSON.stringify(body));
  } catch {
    // Best effort only.
  }
}
