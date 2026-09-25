// Refresh-token session store, backed by t_login_log. A session is created at
// login and rotated on every refresh (old session revoked, new one inserted),
// which enables logout and stolen-token replay detection.

import { sha256Hex } from "../utils/token";

interface SessionRow {
  id: number;
  user_id: number;
  jti: string;
  revoked: number;
  /** Refresh token lifetime in ms (a duration, relative to `login_time`). */
  token_expire_ms: number;
  /** Derived in SQL: `login_time + token_expire_ms`, as ms since epoch. */
  expire_at_ms: number;
  /** 1 for AI-tool (MCP) sessions, exempt from the single-session kick. */
  is_mcp?: number;
}

/** Register a new refresh-token session (stores only the token hash). */
export async function createSession(
  env: Env,
  userId: number,
  jti: string,
  token: string,
  ttlMs: number,
  isMcp = false
): Promise<void> {
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    `insert into t_login_log (user_id, token, token_expire_ms, jti, revoked, last_used, is_mcp)
     values (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?)`
  )
    .bind(userId, hash, ttlMs, jti, isMcp ? 1 : 0)
    .run();
}

/**
 * Look up an active (not revoked, not expired) session by jti + owner.
 * `token_expire_ms` is a lifetime, so the absolute expiry is computed from
 * `login_time` (stored by SQLite as UTC) inside SQL.
 */
export async function getActiveSession(
  env: Env,
  userId: number,
  jti: string
): Promise<SessionRow | null> {
  const row = await env.DB.prepare(
    `select id, user_id, jti, revoked, token_expire_ms,
            strftime('%s', login_time) * 1000 + token_expire_ms as expire_at_ms
     from t_login_log where jti = ? and user_id = ?`
  )
    .bind(jti, userId)
    .first<SessionRow>();

  if (!row) return null;
  if (row.revoked === 1) return null;
  if (row.expire_at_ms <= Date.now()) return null;
  return row;
}

/**
 * Find any session row (active or revoked) by jti + owner. Used by /refresh
 * to tell apart a genuine replay (no row at all) from a concurrent rotation
 * that just revoked this jti (row exists with revoked=1) — the latter must
 * NOT trigger a blanket revoke-all, or two tabs refreshing at the same time
 * would log every device out.
 */
export async function findSession(
  env: Env,
  userId: number,
  jti: string
): Promise<SessionRow | null> {
  return env.DB.prepare(
    `select id, user_id, jti, revoked, token_expire_ms
     from t_login_log where jti = ? and user_id = ?`
  )
    .bind(jti, userId)
    .first<SessionRow>();
}

/**
 * Rotate a session: atomically revoke the old jti (recording which jti
 * superseded it) and insert the new session. The conditional UPDATE doubles
 * as replay detection: if the old session was already revoked/rotated (e.g. a
 * concurrent refresh won the race), the rotation fails and the caller decides
 * how to respond (see /refresh — concurrent rotations are not punished, only
 * genuinely unknown jtis trigger a blanket revoke). Returns false when the
 * old session was not active.
 */
export async function rotateSession(
  env: Env,
  userId: number,
  oldJti: string,
  newJti: string,
  newToken: string,
  newTtlMs: number,
  isMcp = false
): Promise<boolean> {
  const hash = await sha256Hex(newToken);

  // Conditional revoke first: a concurrent /refresh with the same old RT can
  // no longer both succeed — only the first one matches `revoked = 0`.
  const revoke = await env.DB.prepare(
    `update t_login_log set revoked = 1, rotated_to = ?, last_used = CURRENT_TIMESTAMP
     where jti = ? and user_id = ? and revoked = 0`
  )
    .bind(newJti, oldJti, userId)
    .run();

  if (revoke.meta.changes === 0) {
    // The old session was already revoked/rotated by a concurrent refresh.
    // Not punished here: /refresh handles the replay-vs-concurrency decision
    // via findSession (punishing would log out every device on a race).
    return false;
  }

  await env.DB.prepare(
    `insert into t_login_log (user_id, token, token_expire_ms, jti, revoked, last_used, is_mcp)
     values (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, ?)`
  )
    .bind(userId, hash, newTtlMs, newJti, isMcp ? 1 : 0)
    .run();

  // Opportunistic cleanup of expired/revoked rows (keeps the table bounded).
  // token_expire_ms is a DURATION, so absolute expiry is derived in SQL.
  await env.DB.prepare(
    `delete from t_login_log
     where revoked = 1 and strftime('%s', login_time) * 1000 + token_expire_ms < ?`
  )
    .bind(Date.now())
    .run();

  return true;
}

/** Revoke a single session (logout). */
export async function revokeSession(env: Env, jti: string): Promise<void> {
  await env.DB.prepare(`update t_login_log set revoked = 1 where jti = ?`)
    .bind(jti)
    .run();
}

/** Revoke every session for a user (used on refresh-token replay detection). */
export async function revokeAllForUser(
  env: Env,
  userId: number
): Promise<void> {
  await env.DB.prepare(
    `update t_login_log set revoked = 1 where user_id = ? and revoked = 0`
  )
    .bind(userId)
    .run();
}
