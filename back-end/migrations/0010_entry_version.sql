-- Precise optimistic-locking column for setting entries (mirrors
-- 0006_chapter_version.sql). Every update bumps `version`; the write is
-- conditioned on the version the client loaded (`WHERE version = ?`), so a
-- stale client (e.g. a web page whose autosave overwrites a newer MCP write)
-- matches zero rows and gets a 409 instead of silently clobbering it.
-- Existing rows start at 0; their first save bumps to 1.

ALTER TABLE t_entry ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
