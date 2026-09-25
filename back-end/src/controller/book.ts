import * as bookService from "../service/BookService";
import { jsonResponse } from "../response";
import { assertId, assertOptionalString, assertString } from "../utils/validate";
import type { Ctx } from "../context";

interface BookBody {
  title?: string;
}

const BOOK_TITLE_MAX = 100;

export async function listBooks(ctx: Ctx): Promise<Response> {
  const books = await bookService.listBooks(ctx.env, ctx.userId);
  return jsonResponse(books);
}

export async function createBook(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<BookBody>().catch(() => ({} as BookBody));
  const title = assertOptionalString(body.title, "书名", BOOK_TITLE_MAX);
  const book = await bookService.createBook(ctx.env, ctx.userId, title);
  return jsonResponse(book);
}

export async function renameBook(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<BookBody>();
  const book = await bookService.renameBook(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "书籍 id"),
    assertString(body.title ?? "", "书名", BOOK_TITLE_MAX)
  );
  return jsonResponse(book);
}

export async function deleteBook(ctx: Ctx): Promise<Response> {
  const result = await bookService.deleteBook(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "书籍 id")
  );
  return jsonResponse(result);
}
