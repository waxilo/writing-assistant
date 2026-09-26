/**
 * API origin. The web build is served by the same container as the API, so it
 * uses the same-origin `/api` mount; the Tauri webview loads from a `tauri://`
 * origin where a relative URL is meaningless, so it points at the public domain
 * (served through the shared gw gateway) rather than a fixed local port — the
 * container's host mapping is debug-only and no longer something to pin.
 * Override at build time with VITE_API_BASE_URL (e.g. a LAN or tunnel address).
 */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (IS_TAURI ? "https://writer.sloan.dpdns.org" : "/api");

/** Idle delay (ms) before an edit triggers an automatic save. */
export const AUTOSAVE_IDLE_MS = 3000;
