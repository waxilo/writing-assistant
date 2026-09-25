-- Brute-force protection: failed login/register attempts for rate limiting.
-- Rows are short-lived (cleaned on each failed attempt); the table stays small.

CREATE TABLE IF NOT EXISTS t_login_attempt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  ip         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempt_lookup
  ON t_login_attempt (username, ip, created_at);
