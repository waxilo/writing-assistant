-- MySQL schema for the Writing Assistant API — the D1 migrations 0001-0010
-- collapsed into their final state, so this file is the single source of
-- truth for a fresh MySQL database.
--
-- Kept deliberately aligned with the SQLite/D1 side:
--   * same table/column names, so the SQL in src/service/*.ts runs on both;
--   * `INTEGER` there means 8 bytes, so epoch-ms columns are BIGINT here;
--   * DATETIME holds UTC text (the driver pins each connection's time_zone),
--     matching how D1 stores CURRENT_TIMESTAMP;
--   * column defaults matter as much as types: `createChapter`/`createEntry`
--     insert no `content`, so the D1 `DEFAULT ''` has to be carried over —
--     MySQL writes it as the expression default `DEFAULT ('')` because plain
--     `DEFAULT ''` is rejected on TEXT columns (error 1101).
--
-- No sample accounts: unlike 0001_init.sql this database is reachable from a
-- real deployment, so register the first user through the API.

CREATE TABLE IF NOT EXISTS t_user (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  username    VARCHAR(64) NOT NULL,
  -- PBKDF2 hash: 'pbkdf2$iterations$salt$digest'
  password    VARCHAR(255) NOT NULL,
  nickname    VARCHAR(64),
  avatar      VARCHAR(1024),
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Case-insensitive by collation (utf8mb4_unicode_ci), which is stricter
  -- than D1's BINARY comparison and matches the app's folded usernames.
  UNIQUE KEY uk_user_username (username)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Refresh-token sessions: token is the SHA-256 hex digest, never the plaintext.
CREATE TABLE IF NOT EXISTS t_login_log (
  id              BIGINT NOT NULL AUTO_INCREMENT,
  user_id         BIGINT NOT NULL,
  token           CHAR(64) NOT NULL,
  login_time      DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Lifetime in ms relative to login_time (see D1 migration 0007).
  token_expire_ms BIGINT NOT NULL,
  jti             VARCHAR(64),
  revoked         TINYINT NOT NULL DEFAULT 0,
  rotated_to      VARCHAR(64),
  last_used       DATETIME,
  is_mcp          TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_login_log_token (token),
  KEY idx_login_log_jti (jti),
  KEY idx_login_log_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Brute-force counter: rows are epoch-ms ints, pruned on every failure.
CREATE TABLE IF NOT EXISTS t_login_attempt (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  username   VARCHAR(64) NOT NULL,
  ip         VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_login_attempt_lookup (username, ip, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_book (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  user_id     BIGINT NOT NULL,
  title       VARCHAR(255) NOT NULL DEFAULT '未命名书籍',
  sort_order  INT NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_book_user (user_id, sort_order)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_volume (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  book_id     BIGINT NOT NULL,
  title       VARCHAR(255) NOT NULL DEFAULT '新卷',
  sort_order  INT NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_volume_book (book_id, sort_order)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_chapter (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  book_id      BIGINT NOT NULL,
  volume_id    BIGINT,
  title        VARCHAR(255) NOT NULL DEFAULT '未命名章节',
  -- utf8mb4 needs up to 4 bytes per char and a novel chapter is far past the
  -- 65 535-byte TEXT ceiling, so chapter bodies are LONGTEXT on both sides.
  -- The parenthesised '' is MySQL's expression-default syntax: plain
  -- `DEFAULT ''` is rejected on BLOB/TEXT columns, and createChapter relies on
  -- this default because it inserts only book_id/title/sort_order.
  content      LONGTEXT NOT NULL DEFAULT (''),
  content_hash CHAR(64),
  sort_order   INT NOT NULL DEFAULT 0,
  word_count   INT NOT NULL DEFAULT 0,
  char_count   INT NOT NULL DEFAULT 0,
  version      INT NOT NULL DEFAULT 0,
  create_time  DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chapter_book (book_id, sort_order),
  KEY idx_chapter_volume (volume_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Pre-save snapshots; at most 5 per chapter (pruned by WriteLogService).
CREATE TABLE IF NOT EXISTS t_chapter_history (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  chapter_id  BIGINT NOT NULL,
  version     INT NOT NULL,
  title       VARCHAR(255) NOT NULL,
  content     LONGTEXT NOT NULL,
  word_count  INT NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chapter_history (chapter_id, create_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Per-day net words written (UTC date), drives the writing heatmap.
CREATE TABLE IF NOT EXISTS t_write_log (
  id      BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  day     VARCHAR(10) NOT NULL,
  words   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_write_log_user_day (user_id, day)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Setting library: character | location | concept entries.
CREATE TABLE IF NOT EXISTS t_entry (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  book_id     BIGINT NOT NULL,
  type        VARCHAR(16) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  content     MEDIUMTEXT NOT NULL DEFAULT (''),
  sort_order  INT NOT NULL DEFAULT 0,
  version     INT NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_entry_book (book_id, type, sort_order)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
