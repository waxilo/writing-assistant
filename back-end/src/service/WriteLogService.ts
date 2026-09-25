// Chapter version-history snapshots, hooked into saveChapter/replaceAllChapters.

import type { HistoryItem, HistoryRow } from "../types";
import { ApiError } from "../errors";

/** Number of history snapshots kept per chapter (oldest dropped first). */
const HISTORY_LIMIT = 5;

/**
 * Snapshot the PREVIOUS state of a chapter before it is overwritten, and
 * prune old snapshots so at most HISTORY_LIMIT remain per chapter.
 */
export async function snapshotChapter(
  env: Env,
  chapterId: number,
  previousVersion: number,
  previousTitle: string,
  previousContent: string,
  previousWordCount: number
): Promise<void> {
  if (previousContent === "") return; // nothing meaningful to snapshot
  await env.DB.prepare(
    `insert into t_chapter_history (chapter_id, version, title, content, word_count)
     values (?, ?, ?, ?, ?)`
  )
    .bind(
      chapterId,
      previousVersion,
      previousTitle,
      previousContent,
      previousWordCount
    )
    .run();
  // Keep only the newest HISTORY_LIMIT rows for this chapter.
  await env.DB.prepare(
    `delete from t_chapter_history
     where chapter_id = ? and id not in (
       select id from t_chapter_history
       where chapter_id = ? order by create_time desc, id desc limit ?
     )`
  )
    .bind(chapterId, chapterId, HISTORY_LIMIT)
    .run();
}

/** History list for a chapter (metadata only, no content). */
export async function getChapterHistory(
  env: Env,
  userId: number,
  chapterId: number
): Promise<HistoryItem[]> {
  const owned = await env.DB.prepare(
    `select book_id from t_chapter where id = ?`
  )
    .bind(chapterId)
    .first<{ book_id: number }>();
  if (!owned) throw new ApiError(404, "章节不存在");
  const book = await env.DB
    .prepare(`select id from t_book where id = ? and user_id = ?`)
    .bind(owned.book_id, userId)
    .first();
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select id, version, title, word_count, create_time
     from t_chapter_history where chapter_id = ?
     order by create_time desc, id desc`
  )
    .bind(chapterId)
    .all<HistoryRow>();
  return results.map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    wordCount: row.word_count,
    createTime: row.create_time,
  }));
}

/** Full snapshot (with content) for a history item. */
export async function getHistoryItem(
  env: Env,
  userId: number,
  chapterId: number,
  historyId: number
): Promise<HistoryRow> {
  // Ownership check through the chapter's book first.
  const book = await env.DB
    .prepare(
      `select b.id from t_book b
       join t_chapter c on c.book_id = b.id
       where c.id = ? and b.user_id = ?`
    )
    .bind(chapterId, userId)
    .first();
  if (!book) throw new ApiError(403, "无权操作");

  const row = await env.DB.prepare(
    `select * from t_chapter_history where id = ? and chapter_id = ?`
  )
    .bind(historyId, chapterId)
    .first<HistoryRow>();
  if (!row) throw new ApiError(404, "历史版本不存在");
  return row;
}
