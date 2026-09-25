import { request } from "./http";
import type { Book } from "../types/book";

/** List the current user's books. */
export function listBooks(): Promise<Book[]> {
  return request<Book[]>("/books", { method: "GET" });
}

/** Create a new book. */
export function createBook(title?: string): Promise<Book> {
  return request<Book>("/books", { method: "POST", body: { title } });
}

/** Rename a book. */
export function renameBook(id: number, title: string): Promise<Book> {
  return request<Book>(`/books/${id}`, { method: "PUT", body: { title } });
}

/** Delete a book (cascades to its chapters). */
export function deleteBook(id: number): Promise<{ id: number }> {
  return request<{ id: number }>(`/books/${id}`, { method: "DELETE" });
}
