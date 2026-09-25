import { ref, computed } from "vue";
import * as bookApi from "../api/book";
import type { Book } from "../types/book";
import { useBusy } from "./useBusy";

/**
 * Bookshelf state: the user's books and which one is currently open.
 * `currentId` drives the login/bookshelf/editor view switch in App.vue.
 */
export function useBooks() {
  const list = ref<Book[]>([]);
  const currentId = ref<number | null>(null);
  const loading = ref(false);
  const error = ref("");
  /** 创建书籍进行中（书架新建按钮禁用）。 */
  const { busy: creating, run: runCreate } = useBusy();

  const current = computed(
    () => list.value.find((b) => b.id === currentId.value) ?? null
  );

  async function loadList(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      list.value = await bookApi.listBooks();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Open a book -> switch to the editor view. */
  function open(id: number): void {
    currentId.value = id;
  }

  /** Return to the bookshelf. Caller should flush unsaved edits first. */
  function backToShelf(): void {
    currentId.value = null;
  }

  async function create(): Promise<void> {
    await runCreate(async () => {
      const book = await bookApi.createBook();
      list.value.push(book);
      currentId.value = book.id;
    });
  }

  async function remove(id: number): Promise<void> {
    await bookApi.deleteBook(id);
    list.value = list.value.filter((b) => b.id !== id);
    if (currentId.value === id) currentId.value = null;
  }

  /** Rename a book and update it in the local list. */
  async function rename(id: number, title: string): Promise<void> {
    const updated = await bookApi.renameBook(id, title);
    const book = list.value.find((b) => b.id === id);
    if (book) book.title = updated.title;
  }

  return {
    list,
    current,
    currentId,
    loading,
    error,
    creating,
    loadList,
    open,
    backToShelf,
    create,
    remove,
    rename,
  };
}
