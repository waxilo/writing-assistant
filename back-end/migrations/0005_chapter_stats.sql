-- Denormalized character counts on t_chapter so list queries never read
-- full chapter bodies just to count words. Backfilled lazily: existing rows
-- report 0 until their next save (content is re-counted on every save).
-- NOTE: there is no practical way to backfill CJK counts in pure SQL; the
-- counts self-heal as chapters are edited.

ALTER TABLE t_chapter ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE t_chapter ADD COLUMN char_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chapter_book ON t_chapter (book_id, sort_order);
