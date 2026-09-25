import type { Chapter, ChapterRow, ChapterSummary } from "../types";
import { getOwnedBook } from "./BookService";
import { ApiError } from "../errors";
import { sha256Hex } from "../utils/token";
import { computeSaveHash } from "../utils/saveHash";
import { snapshotChapter } from "./WriteLogService";

export interface SaveChapterInput {
  /** 缺省表示不修改该字段（字段级保存：只更新实际修改的部分）。 */
  title?: string;
  content?: string;
  /**
   * The `version` the client loaded. The write itself is conditioned on it
   * (`WHERE version = ?`), so concurrent saves are serialized atomically:
   * exactly one succeeds, the loser gets 409. Prefer this over baseUpdateTime
   * (second-precision timestamps let same-second saves slip through).
   */
  baseVersion?: number;
  /** Legacy lock (kept for compatibility); version takes precedence. */
  baseUpdateTime?: string;
}

const CJK_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const WHITESPACE_PATTERN = /\s/u;

function getContentStats(content: string): {
  wordCount: number;
  charCount: number;
} {
  return {
    wordCount: content.match(CJK_CHARACTER_PATTERN)?.length ?? 0,
    charCount: Array.from(content).filter(
      (character) => !WHITESPACE_PATTERN.test(character)
    ).length,
  };
}

function toSummary(row: ChapterRow): ChapterSummary {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    sortOrder: row.sort_order,
    updateTime: row.update_time,
    wordCount: row.word_count ?? 0,
    charCount: row.char_count ?? 0,
    version: row.version,
    volumeId: row.volume_id ?? null,
  };
}

function toChapter(row: ChapterRow): Chapter {
  return {
    ...toSummary(row),
    content: row.content,
    contentHash: row.content_hash,
    saveHash: "",
    createTime: row.create_time,
    version: row.version,
  };
}



/** Load a chapter row and verify the current user owns its book. */
async function getOwnedChapterRow(
  env: Env,
  userId: number,
  chapterId: number
): Promise<ChapterRow> {
  const row = await env.DB.prepare(`select * from t_chapter where id = ?`)
    .bind(chapterId)
    .first<ChapterRow>();
  if (!row) throw new ApiError(404, "章节不存在");

  const book = await getOwnedBook(env, userId, row.book_id);
  if (!book) throw new ApiError(403, "无权操作");

  return row;
}

/** List chapters of a book the user owns (metadata only, no content). */
export async function listChapters(
  env: Env,
  userId: number,
  bookId: number
): Promise<ChapterSummary[]> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id, book_id, title, sort_order, update_time, word_count, char_count, version, volume_id
     from t_chapter where book_id = ? order by sort_order asc, id asc`
  )
    .bind(bookId)
    .all<ChapterRow>();
  return results.map(toSummary);
}

/** Get a single chapter with content. */
export async function getChapter(
  env: Env,
  userId: number,
  chapterId: number
): Promise<Chapter> {
  const row = await getOwnedChapterRow(env, userId, chapterId);
  return {
    ...toChapter(row),
    saveHash: await computeSaveHash(row.title, row.content),
  };
}

/** Create a chapter under a book the user owns. */
export async function createChapter(
  env: Env,
  userId: number,
  bookId: number,
  title?: string
): Promise<Chapter> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const row = await env.DB.prepare(
    `insert into t_chapter (book_id, title, sort_order, word_count, char_count)
     values (?, ?, (select coalesce(max(sort_order), 0) + 1 from t_chapter where book_id = ?), 0, 0)
     returning *`
  )
    .bind(bookId, title?.trim() || "未命名章节", bookId)
    .first<ChapterRow>();

  if (!row) throw new ApiError(500, "创建章节失败");
  return {
    ...toChapter(row),
    saveHash: await computeSaveHash(row.title, row.content),
  };
}

/**
 * Save a chapter with optimistic concurrency control: the UPDATE itself is
 * conditioned on the version the client loaded (`WHERE version = ?`), so two
 * concurrent saves are serialized atomically — the loser matches zero rows and
 * gets 409. Without baseVersion we fall back to the legacy update_time check.
 * The content hash is computed server-side; stats are denormalized into the
 * row.
 */
export async function saveChapter(
  env: Env,
  userId: number,
  chapterId: number,
  input: SaveChapterInput
): Promise<Chapter> {
  const row = await getOwnedChapterRow(env, userId, chapterId);

  // 字段级合并：缺省的字段保留服务器当前值。
  const nextTitle = input.title === undefined ? row.title : input.title.trim() || "未命名章节";
  const nextContent = input.content === undefined ? row.content : input.content;

  const stats = getContentStats(nextContent);
  const contentHash = await sha256Hex(nextContent);

  const useVersion =
    typeof input.baseVersion === "number" && Number.isSafeInteger(input.baseVersion);
  const versionGuard = useVersion ? " and version = ?" : "";
  const args: unknown[] = [
    nextTitle,
    nextContent,
    contentHash,
    stats.wordCount,
    stats.charCount,
    chapterId,
  ];
  if (useVersion) args.push(input.baseVersion);

  const updated = await env.DB.prepare(
    `update t_chapter
     set title = ?, content = ?, content_hash = ?, word_count = ?, char_count = ?,
         version = version + 1, update_time = CURRENT_TIMESTAMP
     where id = ?${versionGuard} returning *`
  )
    .bind(...args)
    .first<ChapterRow>();

  if (!updated) {
    if (useVersion) {
      // Zero rows matched: another device saved in between -> conflict. The
      // payload carries the server's current state so the client can align
      // its base version without an extra round-trip (or fetching content).
      throw new ApiError(409, "章节已在其他设备被修改", {
        version: row.version,
        updateTime: row.update_time,
        chapter: {
          ...toChapter(row),
          saveHash: await computeSaveHash(row.title, row.content),
        },
      });
    }
    // Legacy path: pre-check update_time (best effort, second precision).
    if (
      input.baseUpdateTime !== undefined &&
      row.update_time !== input.baseUpdateTime
    ) {
      throw new ApiError(409, "章节已在其他设备被修改", {
        version: row.version,
        updateTime: row.update_time,
        chapter: {
          ...toChapter(row),
          saveHash: await computeSaveHash(row.title, row.content),
        },
      });
    }
    throw new ApiError(500, "保存章节失败");
  }

  // Writing activity: snapshot the previous state (version history) and
  // record net words written today (writing calendar). Best effort — a
  // failure here must not fail the save itself.
  await snapshotChapter(
    env,
    chapterId,
    row.version,
    row.title,
    row.content,
    row.word_count ?? 0
  ).catch(() => undefined);

  return {
    ...toChapter(updated),
    saveHash: await computeSaveHash(nextTitle, nextContent),
  };
}

/**
 * Reorder the chapters of a book to match the given id sequence. Verifies the
 * user owns the book, that the sequence covers exactly the book's chapters
 * (no duplicates, no omissions), then writes each chapter's sort_order to its
 * index. D1 batches are limited to 100 statements, so large books are written
 * in chunks (each chunk is its own transaction; a crash mid-way leaves a
 * partially reordered list, which the next successful reorder heals).
 */
export async function reorderChapters(
  env: Env,
  userId: number,
  bookId: number,
  ids: number[]
): Promise<ChapterSummary[]> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id from t_chapter where book_id = ?`
  )
    .bind(bookId)
    .all<{ id: number }>();
  const owned = new Set(results.map((r) => r.id));

  if (new Set(ids).size !== ids.length || ids.length !== owned.size) {
    throw new ApiError(400, "排序列表不合法");
  }
  for (const id of ids) {
    if (!owned.has(id)) throw new ApiError(400, "章节不属于该书");
  }

  const statements = ids.map((id, index) =>
    env.DB.prepare(
      `update t_chapter set sort_order = ? where id = ? and book_id = ?`
    ).bind(index, id, bookId)
  );
  const BATCH_LIMIT = 100; // D1 hard cap per batch call
  for (let i = 0; i < statements.length; i += BATCH_LIMIT) {
    await env.DB.batch(statements.slice(i, i + BATCH_LIMIT));
  }

  return listChapters(env, userId, bookId);
}

/** Delete a chapter the user owns. */
export async function deleteChapter(
  env: Env,
  userId: number,
  chapterId: number
): Promise<{ id: number }> {
  await getOwnedChapterRow(env, userId, chapterId);
  await env.DB.prepare(`delete from t_chapter where id = ?`)
    .bind(chapterId)
    .run();
  return { id: chapterId };
}

// --- book-wide find & replace ------------------------------------------------

export interface ChapterMatch {
  id: number;
  title: string;
  count: number;
}

export interface SearchResult {
  /** Total matches across the whole book. */
  totalMatches: number;
  /** Per-chapter match counts (only chapters with at least one match). */
  chapters: ChapterMatch[];
}

export interface ReplaceResult {
  totalReplaced: number;
  chapters: { id: number; title: string; replaced: number }[];
}

// --- book-wide outline -------------------------------------------------------

export interface OutlineHeading {
  level: number;
  text: string;
}

export interface BookOutlineChapter {
  id: number;
  title: string;
  headings: OutlineHeading[];
}

const OUTLINE_HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * Extract heading lines (`#` … `######`) from chapter content. Shared by the
 * per-chapter outline and the book-wide outline.
 */
export function extractHeadings(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(OUTLINE_HEADING_PATTERN);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

/**
 * Book-wide outline: heading hierarchy of EVERY chapter (only heading lines
 * are transferred, never the full content). Powers the right-side navigation
 * panel's "全书" mode.
 */
export async function getBookOutline(
  env: Env,
  userId: number,
  bookId: number
): Promise<{ chapters: BookOutlineChapter[] }> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id, title, content from t_chapter where book_id = ?`
  )
    .bind(bookId)
    .all<{ id: number; title: string; content: string }>();

  const chapters: BookOutlineChapter[] = [];
  for (const row of results) {
    const headings = extractHeadings(row.content);
    chapters.push({ id: row.id, title: row.title, headings });
  }
  return { chapters };
}

/** Count case-insensitive literal occurrences of `query` in `content`. */
function countMatches(content: string, query: string): number {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  if (q === "") return 0;
  let count = 0;
  let index = lower.indexOf(q);
  while (index !== -1) {
    count++;
    index = lower.indexOf(q, index + q.length);
  }
  return count;
}

/**
 * Book-wide search: counts matches per chapter WITHOUT transferring full
 * content to the client (statistics only; case-insensitive literal match).
 */
export async function searchChapters(
  env: Env,
  userId: number,
  bookId: number,
  query: string
): Promise<SearchResult> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id, title, content from t_chapter where book_id = ?`
  )
    .bind(bookId)
    .all<{ id: number; title: string; content: string }>();

  let totalMatches = 0;
  const chapters: ChapterMatch[] = [];
  for (const row of results) {
    const count = countMatches(row.content, query);
    if (count > 0) {
      totalMatches += count;
      chapters.push({ id: row.id, title: row.title, count });
    }
  }
  return { totalMatches, chapters };
}

/**
 * Book-wide replace of a literal string across all chapters. Replacement is
 * case-sensitive and applied to the whole word occurrences; stats and
 * content hashes are recomputed and version bumped exactly like a normal
 * save. The version condition makes concurrent writes fail-safe (a mismatch
 * simply skips that chapter — single-session policy makes this unlikely).
 */
export async function replaceAllChapters(
  env: Env,
  userId: number,
  bookId: number,
  from: string,
  to: string
): Promise<ReplaceResult> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id, title, content, version, word_count from t_chapter where book_id = ?`
  )
    .bind(bookId)
    .all<{ id: number; title: string; content: string; version: number; word_count: number }>();

  let totalReplaced = 0;
  const chapters: ReplaceResult["chapters"] = [];
  for (const row of results) {
    if (!row.content.includes(from)) continue;
    const nextContent = row.content.split(from).join(to);
    const replaced = countMatches(row.content, from);
    const stats = getContentStats(nextContent);
    const contentHash = await sha256Hex(nextContent);
    await env.DB.prepare(
      `update t_chapter
       set content = ?, content_hash = ?, word_count = ?, char_count = ?,
           version = version + 1, update_time = CURRENT_TIMESTAMP
       where id = ? and version = ?`
    )
      .bind(
        nextContent,
        contentHash,
        stats.wordCount,
        stats.charCount,
        row.id,
        row.version
      )
      .run();
    totalReplaced += replaced;
    chapters.push({ id: row.id, title: row.title, replaced });
  }
  return { totalReplaced, chapters };
}
