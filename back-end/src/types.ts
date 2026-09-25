// Shared domain types for the backend.

/** Row shape for t_book. */
export interface BookRow {
  id: number;
  user_id: number;
  title: string;
  sort_order: number;
  create_time: string;
  update_time: string;
  /** Aggregates, present only on the list query. */
  chapter_count?: number;
  word_count?: number;
}

/** Row shape for t_chapter. */
export interface ChapterRow {
  id: number;
  book_id: number;
  title: string;
  content: string;
  content_hash: string | null;
  sort_order: number;
  create_time: string;
  update_time: string;
  /** Denormalized stats (written on save; 0 for pre-migration rows). */
  word_count: number;
  char_count: number;
  /** Optimistic-lock counter, bumped on every save. */
  version: number;
  /** Volume grouping (nullable). */
  volume_id: number | null;
}

/** Book list item / detail returned to the client (camelCase). */
export interface Book {
  id: number;
  title: string;
  sortOrder: number;
  updateTime: string;
  /** Number of chapters in the book. */
  chapterCount: number;
  /** Total character count across all chapters. */
  wordCount: number;
}

/** Chapter list item (no content). */
export interface ChapterSummary {
  id: number;
  bookId: number;
  title: string;
  sortOrder: number;
  updateTime: string;
  /** Chinese character count. */
  wordCount: number;
  /** Visible character count, including punctuation. */
  charCount: number;
  /** Optimistic-lock counter; lets clients detect remote edits via the list. */
  version: number;
  /** Volume grouping (nullable). */
  volumeId: number | null;
}

/** Row shape for t_volume. */
export interface VolumeRow {
  id: number;
  book_id: number;
  title: string;
  sort_order: number;
  create_time: string;
}

/** Volume returned to the client. */
export interface Volume {
  id: number;
  bookId: number;
  title: string;
  sortOrder: number;
  /** Number of chapters in this volume (from list aggregation). */
  chapterCount?: number;
}

/** Row shape for t_write_log. */

/** Row shape for t_chapter_history. */
export interface HistoryRow {
  id: number;
  chapter_id: number;
  version: number;
  title: string;
  content: string;
  word_count: number;
  create_time: string;
}

/** History list item (no content). */
export interface HistoryItem {
  id: number;
  version: number;
  title: string;
  wordCount: number;
  createTime: string;
}

/** Row shape for t_entry (setting library: character/location/concept). */
export interface EntryRow {
  id: number;
  book_id: number;
  type: string;
  title: string;
  content: string;
  sort_order: number;
  create_time: string;
  update_time: string;
  version: number;
}

/** Entry returned to the client. */
export interface Entry {
  id: number;
  bookId: number;
  type: string;
  title: string;
  content: string;
  sortOrder: number;
  updateTime: string;
  version: number;
}

/** Writing calendar: words written per UTC day. */
export interface CalendarDay {
  day: string;
  words: number;
}

/** Chapter detail (with content). */
export interface Chapter extends ChapterSummary {
  content: string;
  contentHash: string | null;
  /** 服务器权威保存基准：sha256(title+content) 整体哈希，前端据此判断是否需保存。 */
  saveHash: string;
  createTime: string;
  /** Optimistic-lock counter; pass back as baseVersion when saving. */
  version: number;
}

/** Result of token verification. */
export interface TokenCheck {
  success: boolean;
  userId?: number;
  /** Refresh-session id embedded in the access token (may be absent on old tokens). */
  sid?: string;
}

/** Row shape for t_user. */
export interface UserRow {
  id: number;
  username: string;
  password: string;
  nickname: string | null;
  avatar: string | null;
  create_time: string;
  update_time: string;
}

/** Current user info returned to the client (no password). */
export interface UserInfo {
  id: number;
  username: string;
  nickname: string | null;
  avatar: string | null;
}
