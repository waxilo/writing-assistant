import { request } from "./http";
import type {
  Chapter,
  ChapterSummary,
  SaveChapterPayload,
  SearchResult,
  ReplaceResult,
} from "../types/chapter";

/** List chapters of a book (no content). */
export function listChapters(bookId: number): Promise<ChapterSummary[]> {
  return request<ChapterSummary[]>(`/books/${bookId}/chapters`, {
    method: "GET",
  });
}

/** Create a chapter under a book. */
export function createChapter(bookId: number, title?: string): Promise<Chapter> {
  return request<Chapter>(`/books/${bookId}/chapters`, {
    method: "POST",
    body: { title },
  });
}

/** Get a chapter with its content. */
export function getChapter(id: number): Promise<Chapter> {
  return request<Chapter>(`/chapters/${id}`, { method: "GET" });
}

/** Save a chapter (Ctrl+S / autosave). */
export function saveChapter(
  id: number,
  payload: SaveChapterPayload
): Promise<Chapter> {
  return request<Chapter>(`/chapters/${id}`, { method: "PUT", body: payload });
}

/** Delete a chapter. */
export function deleteChapter(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/chapters/${id}`, { method: "DELETE" });
}

/** Persist a new chapter order (array of chapter ids in the desired order). */
export function reorderChapters(
  bookId: number,
  ids: number[]
): Promise<ChapterSummary[]> {
  return request<ChapterSummary[]>(`/books/${bookId}/chapters`, {
    method: "PUT",
    body: { ids },
  });
}

/** Book-wide keyword search: match counts per chapter (no content transfer). */
export function searchChapters(
  bookId: number,
  query: string
): Promise<SearchResult> {
  return request<SearchResult>(
    `/books/${bookId}/search?q=${encodeURIComponent(query)}`,
    { method: "GET" }
  );
}

/** Book-wide literal replace across all chapters (server-side, one round-trip). */
export function replaceAllChapters(
  bookId: number,
  from: string,
  to: string
): Promise<ReplaceResult> {
  return request<ReplaceResult>(`/books/${bookId}/replace`, {
    method: "POST",
    body: { from, to },
  });
}
