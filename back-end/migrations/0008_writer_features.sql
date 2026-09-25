-- 第二批功能：分卷结构（t_volume）、写作日志（t_write_log）、
-- 章节历史快照（t_chapter_history）、设定资料库（t_entry）。

-- 1. 分卷：章节可按卷归组（第一卷 / 第二卷 …），卷内顺序沿用全局 sort_order。
CREATE TABLE IF NOT EXISTS t_volume (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '新卷',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_volume_book ON t_volume (book_id, sort_order);

ALTER TABLE t_chapter ADD COLUMN volume_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_chapter_volume ON t_chapter (volume_id);

-- 2. 写作日志：每次保存/替换记录当日新增字数（UTC 日期），驱动热力图。
CREATE TABLE IF NOT EXISTS t_write_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day   TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_write_log_user ON t_write_log (user_id, day);

-- 3. 章节历史快照：保存前把旧版本存入，每章保留最近 5 条。
CREATE TABLE IF NOT EXISTS t_chapter_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id  INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chapter_history ON t_chapter_history (chapter_id, create_time);

-- 4. 设定资料库：人物 / 地点 / 设定 通用条目。
CREATE TABLE IF NOT EXISTS t_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL,
  type        TEXT NOT NULL, -- character | location | concept
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entry_book ON t_entry (book_id, type, sort_order);
