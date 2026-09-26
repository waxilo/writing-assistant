import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  build: {
    // Modern evergreen targets (Tauri webviews are current WebView2/WKWebView).
    target: "es2022",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // `npm run dev` talks to the containerized API through this proxy, so the
    // browser build can keep using the same-origin /api base it ships with.
    proxy: {
      "/api": {
        // @ts-expect-error process is a nodejs global
        target: process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:7001",
        changeOrigin: true,
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
