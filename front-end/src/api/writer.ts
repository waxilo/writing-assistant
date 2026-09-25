import { request } from "./http";
import type {
  Volume,
  HistoryItem,
  HistoryDetail,
  Entry,
  EntryType,
} from "../types/writer";

// --- volumes -----------------------------------------------------------------

export function listVolumes(bookId: number): Promise<Volume[]> {
  return request<Volume[]>(`/books/${bookId}/volumes`, { method: "GET" });
}

export function createVolume(bookId: number, title?: string): Promise<Volume> {
  return request<Volume>(`/books/${bookId}/volumes`, {
    method: "POST",
    body: { title },
  });
}

export function renameVolume(id: number, title: string): Promise<Volume> {
  return request<Volume>(`/volumes/${id}`, { method: "PUT", body: { title } });
}

export function deleteVolume(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/volumes/${id}`, { method: "DELETE" });
}

/** Move a chapter into a volume (null = ungrouped). */
export function moveChapterToVolume(
  chapterId: number,
  volumeId: number | null
): Promise<{ id: number; volumeId: number | null }> {
  return request<{ id: number; volumeId: number | null }>(
    `/chapters/${chapterId}/volume`,
    { method: "PUT", body: { volumeId } }
  );
}

// --- version history ---------------------------------------------------------

export function getChapterHistory(chapterId: number): Promise<HistoryItem[]> {
  return request<HistoryItem[]>(`/chapters/${chapterId}/history`, {
    method: "GET",
  });
}

export function getHistoryItem(
  chapterId: number,
  historyId: number
): Promise<HistoryDetail> {
  return request<HistoryDetail>(`/chapters/${chapterId}/history/${historyId}`, {
    method: "GET",
  });
}


// --- setting library (entries) -----------------------------------------------

export function listEntries(
  bookId: number,
  type?: EntryType
): Promise<Entry[]> {
  const qs = type ? `?type=${type}` : "";
  return request<Entry[]>(`/books/${bookId}/entries${qs}`, { method: "GET" });
}

export function getEntry(id: number): Promise<Entry> {
  return request<Entry>(`/entries/${id}`, { method: "GET" });
}

export function createEntry(
  bookId: number,
  type: EntryType,
  title?: string
): Promise<Entry> {
  return request<Entry>(`/books/${bookId}/entries`, {
    method: "POST",
    body: { type, title },
  });
}

export function updateEntry(
  id: number,
  patch: { title?: string; content?: string; type?: EntryType; baseVersion?: number }
): Promise<Entry> {
  return request<Entry>(`/entries/${id}`, { method: "PUT", body: patch });
}

export function deleteEntry(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/entries/${id}`, { method: "DELETE" });
}

/** Reorder entries of one type by id sequence (returns the new ordered list). */
export function reorderEntries(
  bookId: number,
  type: EntryType,
  ids: number[]
): Promise<Entry[]> {
  return request<Entry[]>(`/books/${bookId}/entries`, {
    method: "PUT",
    body: { type, ids },
  });
}
