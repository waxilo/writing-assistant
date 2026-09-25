-- Precise optimistic-locking column for chapters. The previous lock compared
-- `update_time`, which is second-precision (D1 CURRENT_TIMESTAMP): two windows
-- saving within the same second could overwrite each other undetected. Every
-- save now bumps `version` and the write is conditioned on the version the
-- client loaded. Existing rows start at 0, which is fine: their first save
-- bumps to 1.

ALTER TABLE t_chapter ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
