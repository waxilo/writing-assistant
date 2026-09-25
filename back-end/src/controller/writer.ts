import * as volumeService from "../service/VolumeService";
import * as chapterService from "../service/ChapterService";
import * as writeLogService from "../service/WriteLogService";
import { jsonResponse } from "../response";
import { assertId, assertOptionalString, assertString } from "../utils/validate";
import type { Ctx } from "../context";

interface VolumeBody {
  title?: string;
}

export async function listVolumes(ctx: Ctx): Promise<Response> {
  const volumes = await volumeService.listVolumes(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id")
  );
  return jsonResponse(volumes);
}

export async function createVolume(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<VolumeBody>().catch(() => ({} as VolumeBody));
  const volume = await volumeService.createVolume(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.bookId, "书籍 id"),
    assertOptionalString(body.title, "卷名", 100)
  );
  return jsonResponse(volume);
}

export async function renameVolume(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<VolumeBody>();
  const volume = await volumeService.renameVolume(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "卷 id"),
    assertString(body.title ?? "", "卷名", 100)
  );
  return jsonResponse(volume);
}

export async function deleteVolume(ctx: Ctx): Promise<Response> {
  const result = await volumeService.deleteVolume(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "卷 id")
  );
  return jsonResponse(result);
}

interface MoveBody {
  volumeId: number | null;
}

/** Move a chapter into a volume (or ungroup it). */
export async function moveChapter(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<MoveBody>();
  const result = await volumeService.moveChapterToVolume(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id"),
    body.volumeId === null ? null : assertId(String(body.volumeId), "卷 id")
  );
  return jsonResponse(result);
}

/** Version history list (metadata only). */
export async function chapterHistory(ctx: Ctx): Promise<Response> {
  const items = await writeLogService.getChapterHistory(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id")
  );
  return jsonResponse(items);
}

/** A single history snapshot (with content). */
export async function historyItem(ctx: Ctx): Promise<Response> {
  const item = await writeLogService.getHistoryItem(
    ctx.env,
    ctx.userId,
    assertId(ctx.params.id, "章节 id"),
    assertId(ctx.params.hid, "历史版本 id")
  );
  return jsonResponse({
    id: item.id,
    version: item.version,
    title: item.title,
    content: item.content,
    wordCount: item.word_count,
    createTime: item.create_time,
  });
}

