import * as entryService from "../service/EntryService";
import { jsonResponse } from "../response";
import {
  assertId,
  assertIdList,
  assertOptionalString,
  assertString,
} from "../utils/validate";
import type { Ctx } from "../context";

interface EntryBody {
  type?: string;
  title?: string;
  content?: string;
  baseVersion?: number;
}

/** List entries of a book, optionally filtered by ?type=character|location|concept. */
export async function listEntries(ctx: Ctx): Promise<Response> {
  const type = ctx.url.searchParams.get("type") ?? undefined;
  const entries = await entryService.listEntries(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    type
  );
  return jsonResponse(entries);
}

export async function createEntry(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<EntryBody>().catch(() => ({} as EntryBody));
  const entry = await entryService.createEntry(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    assertString(body.type ?? "", "条目类型", 20, 1),
    assertOptionalString(body.title, "条目标题", 200)
  );
  return jsonResponse(entry);
}

/** Fetch a single entry detail. */
export async function getEntry(ctx: Ctx): Promise<Response> {
  const entry = await entryService.getEntry(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "条目 id")
  );
  return jsonResponse(entry);
}

export async function updateEntry(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<EntryBody>();
  const entry = await entryService.updateEntry(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "条目 id"),
    {
      type:
        body.type === undefined
          ? undefined
          : assertString(body.type, "条目类型", 20, 1),
      title:
        body.title === undefined
          ? undefined
          : assertString(body.title, "条目标题", 200),
      content:
        body.content === undefined
          ? undefined
          : assertString(body.content, "条目内容", 500_000),
    },
    body.baseVersion
  );
  return jsonResponse(entry);
}

export async function deleteEntry(ctx: Ctx): Promise<Response> {
  const result = await entryService.deleteEntry(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "条目 id")
  );
  return jsonResponse(result);
}

interface ReorderBody {
  type?: string;
  ids?: number[];
}

/** Reorder entries of one type by id sequence. */
export async function reorderEntries(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<ReorderBody>().catch(() => ({} as ReorderBody));
  const entries = await entryService.reorderEntries(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    assertString(body.type ?? "", "条目类型", 20, 1),
    assertIdList(body.ids, "条目排序")
  );
  return jsonResponse(entries);
}
