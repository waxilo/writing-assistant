-- Initial schema for the Writer Demo API (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS t_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  token_expire_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO t_user (username, password, nickname, avatar) VALUES
  ('admin', '123456', '管理员', 'https://example.com/avatar/admin.png'),
  ('zhangsan', '123456', '张三', 'https://example.com/avatar/zhangsan.png');
