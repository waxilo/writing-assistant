-- Books and chapters for the Writer Demo (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS t_book (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '未命名书籍',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_user ON t_book (user_id, sort_order);

CREATE TABLE IF NOT EXISTS t_chapter (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '未命名章节',
  content      TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  create_time  DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chapter_book ON t_chapter (book_id, sort_order);
