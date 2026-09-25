import { ref, computed } from "vue";
import type { AuthTokens } from "../types/auth";

// Single source of truth for the auth session (access token + refresh token +
// access-token expiry). Backed by localStorage and exposed as reactive refs so
// views can react to login/logout (including a forced logout on refresh
// failure). Kept dependency-free to avoid the useAuth -> api -> http cycle.
//
// Tabs share localStorage: when ANOTHER tab writes new tokens (e.g. it just
// refreshed), the `storage` event updates this tab's refs, so a concurrent
// refresh here can pick up the newest refresh token instead of force-logging
// the user out.

const ACCESS_KEY = "writer_access";
const REFRESH_KEY = "writer_refresh";
const EXPIRES_KEY = "writer_access_exp";

const accessToken = ref<string>(localStorage.getItem(ACCESS_KEY) ?? "");
const refreshToken = ref<string>(localStorage.getItem(REFRESH_KEY) ?? "");
const accessExp = ref<number>(Number(localStorage.getItem(EXPIRES_KEY) ?? 0));

// Sync in-memory refs with other tabs (never fires for this tab's own writes).
window.addEventListener("storage", (e) => {
  if (e.key === ACCESS_KEY) accessToken.value = e.newValue ?? "";
  if (e.key === REFRESH_KEY) refreshToken.value = e.newValue ?? "";
  if (e.key === EXPIRES_KEY) accessExp.value = Number(e.newValue ?? 0);
});

/** Reactive "logged in" flag: true while we hold a refresh token. */
const loggedIn = computed(() => !!refreshToken.value);

/** Reactive login state, drives the login/app view switch in App.vue. */
export function sessionRef() {
  return loggedIn;
}

export function getAccessToken(): string {
  return accessToken.value;
}

export function getRefreshToken(): string {
  return refreshToken.value;
}

/**
 * The freshest refresh token directly from localStorage. In cross-tab
 * scenarios another tab may have rotated the token AFTER our in-memory ref
 * was read; this reads the shared storage to find the newest value.
 */
export function getStoredRefreshToken(): string {
  return localStorage.getItem(REFRESH_KEY) ?? "";
}

/** Epoch ms at which the current access token expires (0 when logged out). */
export function getAccessExp(): number {
  return accessExp.value;
}

/** Persist a freshly issued token pair. */
export function setSession(tokens: AuthTokens): void {
  accessToken.value = tokens.accessToken;
  refreshToken.value = tokens.refreshToken;
  accessExp.value = Date.now() + tokens.expiresIn * 1000;
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(EXPIRES_KEY, String(accessExp.value));
}

/** Clear the session (logout / forced logout). */
export function clearSession(): void {
  accessToken.value = "";
  refreshToken.value = "";
  accessExp.value = 0;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}
