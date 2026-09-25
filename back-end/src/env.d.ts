// Project-specific environment bindings, merged with the auto-generated
// `Env` interface in worker-configuration.d.ts (do not hand-edit that file).
interface Env {
  /** HMAC signing secret for access tokens. Set via `.dev.vars` locally and
   *  `wrangler secret put TOKEN_SECRET` in production. */
  TOKEN_SECRET: string;
  /** HMAC signing secret for refresh tokens (separate key from access). Set
   *  via `.dev.vars` locally and `wrangler secret put REFRESH_SECRET`. */
  REFRESH_SECRET: string;
}
