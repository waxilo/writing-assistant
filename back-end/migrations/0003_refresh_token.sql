-- Refresh-token sessions for rotating/revocable auth (Cloudflare D1 / SQLite).
-- Reuses t_login_log as the session store.
--   token           : SHA-256 hash of the refresh token (never the plaintext)
--   jti             : refresh token unique id, used to locate the session
--   token_expire_ms : refresh token lifetime in ms (see 0004: relative to login_time)
--   revoked         : 1 once the session is logged out / rotated / replayed
--   rotated_to      : jti of the session that superseded this one (replay detection)
--   last_used       : last time this session was refreshed

ALTER TABLE t_login_log ADD COLUMN jti TEXT;
ALTER TABLE t_login_log ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE t_login_log ADD COLUMN rotated_to TEXT;
ALTER TABLE t_login_log ADD COLUMN last_used DATETIME;

CREATE INDEX IF NOT EXISTS idx_login_log_jti ON t_login_log (jti);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON t_login_log (user_id);
