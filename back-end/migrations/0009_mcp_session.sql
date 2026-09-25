-- AI 工具会话标记（MCP）：is_mcp=1 的会话豁免于单会话抢占——
-- 网页端写操作不踢 MCP 会话，MCP 写操作也不踢网页端（并发写靠乐观锁）。
-- 修改密码仍会全踢（含 MCP）。

ALTER TABLE t_login_log ADD COLUMN is_mcp INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_login_log_user ON t_login_log (user_id);
