// Volume (分卷) management: create/rename/delete volumes and assign chapters.

import type { Volume, VolumeRow } from "../types";
import { getOwnedBook } from "./BookService";
import { ApiError } from "../errors";

function toVolume(row: VolumeRow): Volume {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    sortOrder: row.sort_order,
  };
}

/** List volumes of a book, with per-volume chapter counts. */
export async function listVolumes(
  env: Env,
  userId: number,
  bookId: number
): Promise<Volume[]> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const { results } = await env.DB.prepare(
    `select v.*, (select count(*) from t_chapter c where c.volume_id = v.id) as chapter_count
     from t_volume v where v.book_id = ? order by v.sort_order asc, v.id asc`
  )
    .bind(bookId)
    .all<VolumeRow & { chapter_count: number }>();
  return results.map((row) => ({ ...toVolume(row), chapterCount: row.chapter_count }));
}

/** Create a volume at the end of the book. */
export async function createVolume(
  env: Env,
  userId: number,
  bookId: number,
  title?: string
): Promise<Volume> {
  const book = await getOwnedBook(env, userId, bookId);
  if (!book) throw new ApiError(403, "无权操作");

  const row = await env.DB.prepare(
    `insert into t_volume (book_id, title, sort_order)
     values (?, ?, (select coalesce(max(sort_order), 0) + 1 from t_volume where book_id = ?))
     returning *`
  )
    .bind(bookId, title?.trim() || "新卷", bookId)
    .first<VolumeRow>();
  if (!row) throw new ApiError(500, "创建卷失败");
  return toVolume(row);
}

/** Rename a volume. */
export async function renameVolume(
  env: Env,
  userId: number,
  volumeId: number,
  title: string
): Promise<Volume> {
  const row = await env.DB.prepare(
    `update t_volume set title = ?
     where id = ? and book_id in (select id from t_book where user_id = ?)
     returning *`
  )
    .bind(title.trim() || "新卷", volumeId, userId)
    .first<VolumeRow>();
  if (!row) throw new ApiError(403, "无权操作");
  return toVolume(row);
}

/** Delete a volume; its chapters become ungrouped (volume_id = NULL). */
export async function deleteVolume(
  env: Env,
  userId: number,
  volumeId: number
): Promise<{ id: number }> {
  const row = await env.DB.prepare(
    `select id from t_volume where id = ? and book_id in (select id from t_book where user_id = ?)`
  )
    .bind(volumeId, userId)
    .first<{ id: number }>();
  if (!row) throw new ApiError(403, "无权操作");

  await env.DB.batch([
    env.DB.prepare(`update t_chapter set volume_id = null where volume_id = ?`).bind(volumeId),
    env.DB.prepare(`delete from t_volume where id = ?`).bind(volumeId),
  ]);
  return { id: volumeId };
}

/** Move a chapter into a volume (or ungroup it with null). */
export async function moveChapterToVolume(
  env: Env,
  userId: number,
  chapterId: number,
  volumeId: number | null
): Promise<{ id: number; volumeId: number | null }> {
  const chapter = await env.DB.prepare(`select book_id from t_chapter where id = ?`)
    .bind(chapterId)
    .first<{ book_id: number }>();
  if (!chapter) throw new ApiError(404, "章节不存在");
  const book = await getOwnedBook(env, userId, chapter.book_id);
  if (!book) throw new ApiError(403, "无权操作");

  if (volumeId !== null) {
    const volume = await env.DB.prepare(
      `select id from t_volume where id = ? and book_id = ?`
    )
      .bind(volumeId, chapter.book_id)
      .first<{ id: number }>();
    if (!volume) throw new ApiError(400, "卷不存在");
  }

  await env.DB.prepare(`update t_chapter set volume_id = ? where id = ?`)
    .bind(volumeId, chapterId)
    .run();
  return { id: chapterId, volumeId };
}
