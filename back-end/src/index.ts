import { router } from "./route";
import { corsResponse, jsonResponse } from "./response";
import { createContext } from "./context";
import { ApiError } from "./errors";

/** Minimum secret length; HS256 is only as strong as its key entropy. */
const MIN_SECRET_LENGTH = 32;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight.
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    // Fail fast with an obvious error instead of every endpoint 500-ing
    // cryptically when secrets are missing/too short (wrangler secret put).
    if (
      !env.TOKEN_SECRET ||
      env.TOKEN_SECRET.length < MIN_SECRET_LENGTH ||
      !env.REFRESH_SECRET ||
      env.REFRESH_SECRET.length < MIN_SECRET_LENGTH
    ) {
      console.error(
        "server misconfigured: TOKEN_SECRET/REFRESH_SECRET must be set and >= 32 chars"
      );
      return jsonResponse(null, 500, "服务端配置错误");
    }

    const rid = crypto.randomUUID();
    const start = Date.now();
    const path = new URL(request.url).pathname;
    let status = 500;
    let userId = 0;

    try {
      const ctx = createContext(request, env);
      const res = await router(ctx);
      status = res.status;
      userId = ctx.userId;
      return res;
    } catch (error) {
      // Only explicit ApiError messages are allowed to reach clients; anything
      // else is an internal bug and must not leak internals.
      if (error instanceof ApiError) {
        status = error.status;
        return jsonResponse(error.data ?? null, error.status, error.message);
      }
      console.error("unhandled error", error);
      return jsonResponse(null, 500, "服务端异常");
    } finally {
      // Structured request log (never include tokens or passwords).
      // Sample successful requests (10%) to stay within observability quota;
      // every error is logged in full.
      if (status >= 400 || Math.random() < 0.1) {
        console.log(
          JSON.stringify({
            rid,
            method: request.method,
            path,
            status,
            uid: userId,
            ms: Date.now() - start,
          })
        );
      }
    }
  },
} satisfies ExportedHandler<Env>;
