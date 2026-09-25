import type { Book, BookRow } from "../types";
import { ApiError } from "../errors";

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    sortOrder: row.sort_order,
    updateTime: row.update_time,
    chapterCount: row.chapter_count ?? 0,
    wordCount: row.word_count ?? 0,
  };
}

/** Fetch a book owned by the user, or null. */
export async function getOwnedBook(
  env: Env,
  userId: number,
  bookId: number
): Promise<BookRow | null> {
  return env.DB.prepare(`select * from t_book where id = ? and user_id = ?`)
    .bind(bookId, userId)
    .first<BookRow>();
}

/**
 * List the user's books, ordered by sort_order. Aggregates come from the
 * denormalized t_chapter.word_count (no chapter bodies are read).
 */
export async function listBooks(env: Env, userId: number): Promise<Book[]> {
  const { results } = await env.DB.prepare(
    `select b.*,
       (select count(*) from t_chapter c where c.book_id = b.id) as chapter_count,
       (select coalesce(sum(c.word_count), 0) from t_chapter c where c.book_id = b.id) as word_count
     from t_book b
     where b.user_id = ?
     order by b.sort_order asc, b.id asc`
  )
    .bind(userId)
    .all<BookRow>();
  return results.map(toBook);
}

/** Create a new book for the user. */
export async function createBook(
  env: Env,
  userId: number,
  title?: string
): Promise<Book> {
  const bookTitle = title?.trim() || "未命名书籍";
  const row = await env.DB.prepare(
    `insert into t_book (user_id, title, sort_order)
     values (?, ?, (select coalesce(max(sort_order), 0) + 1 from t_book where user_id = ?))
     returning *`
  )
    .bind(userId, bookTitle, userId)
    .first<BookRow>();

  if (!row) throw new ApiError(500, "创建书籍失败");
  return toBook(row);
}

/** Rename a book the user owns. */
export async function renameBook(
  env: Env,
  userId: number,
  bookId: number,
  title: string
): Promise<Book> {
  const owned = await getOwnedBook(env, userId, bookId);
  if (!owned) throw new ApiError(403, "无权操作");

  const row = await env.DB.prepare(
    `update t_book set title = ?, update_time = CURRENT_TIMESTAMP
     where id = ? and user_id = ? returning *`
  )
    .bind(title?.trim() || "未命名书籍", bookId, userId)
    .first<BookRow>();

  if (!row) throw new ApiError(500, "更新书籍失败");
  return toBook(row);
}

/** Delete a book and cascade-delete its chapters. */
export async function deleteBook(
  env: Env,
  userId: number,
  bookId: number
): Promise<{ id: number }> {
  const owned = await getOwnedBook(env, userId, bookId);
  if (!owned) throw new ApiError(403, "无权操作");

  await env.DB.batch([
    env.DB.prepare(`delete from t_chapter where book_id = ?`).bind(bookId),
    env.DB.prepare(`delete from t_book where id = ? and user_id = ?`).bind(
      bookId,
      userId
    ),
  ]);

  return { id: bookId };
}
