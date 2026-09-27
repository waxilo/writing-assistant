/**
 * API origin. The web build is served by the same container as the API, so it
 * uses the same-origin `/api` mount; the Tauri webview loads from a `tauri://`
 * origin where a relative URL is meaningless, so it dials the same /api mount
 * on the host loopback port the container is published on. The public domain is
 * the gateway's concern only — callers on this machine don't know it, so adding
 * a second DNS zone changes nothing here. Off this machine the loopback address
 * does not resolve, by design; override at build time with VITE_API_BASE_URL
 * (e.g. a LAN address) if you really need to.
 */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (IS_TAURI ? "http://127.0.0.1:7001/api" : "/api");

/** Idle delay (ms) before an edit triggers an automatic save. */
export const AUTOSAVE_IDLE_MS = 3000;
