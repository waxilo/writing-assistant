import * as chapterService from "../service/ChapterService";
import { jsonResponse } from "../response";
import { ApiError } from "../errors";
import {
  assertId,
  assertIdList,
  assertOptionalInt,
  assertOptionalString,
  assertString,
} from "../utils/validate";
import type { Ctx } from "../context";

interface CreateChapterBody {
  title?: string;
}

interface SaveChapterBody {
  title?: string;
  content?: string;
  baseVersion?: number;
  baseUpdateTime?: string;
}

interface ReorderBody {
  ids: number[];
}

// Upper bound keeps a single chapter comfortably under D1's 2MB value limit.
// Measured in UTF-8 BYTES (not chars): 500k emoji characters would be ~2MB
// and hit the limit, while CJK text is ~3 bytes/char.
const CHAPTER_TITLE_MAX = 200;
const CHAPTER_CONTENT_MAX_BYTES = 2_000_000;
const UPDATE_TIME_MAX = 40;

/** Validate chapter content against the D1 row-value limit (UTF-8 bytes). */
function assertContent(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "正文不合法");
  if (new TextEncoder().encode(value).length > CHAPTER_CONTENT_MAX_BYTES) {
    throw new ApiError(400, "正文超出大小限制");
  }
  return value;
}

export async function listChapters(ctx: Ctx): Promise<Response> {
  const chapters = await chapterService.listChapters(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id")
  );
  return jsonResponse(chapters);
}

export async function createChapter(ctx: Ctx): Promise<Response> {
  const body = await ctx
    .json<CreateChapterBody>()
    .catch(() => ({} as CreateChapterBody));
  const title = assertOptionalString(body.title, "章节标题", CHAPTER_TITLE_MAX);
  const chapter = await chapterService.createChapter(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    title
  );
  return jsonResponse(chapter);
}

export async function reorderChapters(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<ReorderBody>();
  const chapters = await chapterService.reorderChapters(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    assertIdList(body.ids, "章节排序")
  );
  return jsonResponse(chapters);
}

export async function getChapter(ctx: Ctx): Promise<Response> {
  const chapter = await chapterService.getChapter(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id")
  );
  return jsonResponse(chapter);
}

export async function saveChapter(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<SaveChapterBody>();
  const chapter = await chapterService.saveChapter(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id"),
    {
      title:
        body.title === undefined
          ? undefined
          : assertString(body.title, "章节标题", CHAPTER_TITLE_MAX),
      content:
        body.content === undefined ? undefined : assertContent(body.content),
      baseVersion: assertOptionalInt(body.baseVersion, "版本号"),
      baseUpdateTime:
        body.baseUpdateTime === undefined
          ? undefined
          : assertString(body.baseUpdateTime, "更新时间", UPDATE_TIME_MAX),
    }
  );
  return jsonResponse(chapter);
}

export async function deleteChapter(ctx: Ctx): Promise<Response> {
  const result = await chapterService.deleteChapter(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id")
  );
  return jsonResponse(result);
}

/** Book-wide keyword search (match counts per chapter). */
export async function searchChapters(ctx: Ctx): Promise<Response> {
  const query = assertString(
    ctx.url.searchParams.get("q") ?? "",
    "关键字",
    200,
    1
  );
  const result = await chapterService.searchChapters(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    query
  );
  return jsonResponse(result);
}

/** Book-wide outline (heading hierarchy of every chapter). */
export async function bookOutline(ctx: Ctx): Promise<Response> {
  const result = await chapterService.getBookOutline(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id")
  );
  return jsonResponse(result);
}

interface ReplaceBody {
  from: string;
  to?: string;
}

/** Book-wide keyword replace. */
export async function replaceAllChapters(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<ReplaceBody>();
  const result = await chapterService.replaceAllChapters(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    assertString(body.from, "查找关键字", 200, 1),
    assertString(body.to ?? "", "替换内容", 200)
  );
  return jsonResponse(result);
}
