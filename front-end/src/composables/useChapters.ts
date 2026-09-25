import { ref, computed, watch } from "vue";
import * as chapterApi from "../api/chapter";
import { syncRequest, ApiClientError } from "../api/http";
import { showToast } from "./useToast";
import type { Chapter, ChapterSummary } from "../types/chapter";
import { AUTOSAVE_IDLE_MS } from "../config";
import { getTextStats } from "../utils/textStats";
import { useBusy } from "./useBusy";

/** 当前内容整体 hash（sha256(title + "\x00" + content)），与后端 saveHash 同一算法
 * （见 back-end/src/utils/saveHash.ts）。分隔符拼接避免字段顺序漂移。
 * 非安全上下文（如 http://IP 访问）无 crypto.subtle：返回 null，由同步字段比较兜底。 */
async function computeHash(
  title: string,
  content: string
): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${title}\x00${content}`)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toSummary(chapter: Chapter): ChapterSummary {
  return {
    id: chapter.id,
    bookId: chapter.bookId,
    title: chapter.title,
    sortOrder: chapter.sortOrder,
    updateTime: chapter.updateTime,
    ...getTextStats(chapter.content),
    version: chapter.version,
  };
}

/**
 * Chapter state for the currently open book: the chapter list, the selected
 * chapter (with editable title/content), and save logic (manual Ctrl+S,
 * idle autosave, and flush) with MD5 dedup. A save that lands while another
 * save is in flight is queued and re-run afterwards instead of being dropped.
 */
export function useChapters() {
  const list = ref<ChapterSummary[]>([]);
  const current = ref<Chapter | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  /** Message of the last failed save (cleared on the next successful save). */
  const saveError = ref<string | null>(null);
  /** 服务器权威保存基准：后端返回的整体 hash（title+content）。 */
  const saveHash = ref("");
  /** 当前内容的整体 hash（异步计算；null = 尚未就绪）。 */
  const currentHash = ref<string | null>(null);
  /** 章节级操作等待态（打开/新建），驱动左侧列表的等待覆盖层。 */
  const { busy: selecting, run: runChapterOp } = useBusy();

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveQueued = false;
  /** 409 自动合并重试上限：连续冲突超过则采用服务器内容，避免对方持续写入时死循环。 */
  const MAX_MERGE_RETRIES = 3;
  let mergeRetries = 0;
  /** 字段级基线：上次加载/保存成功后的值（409 对比与只存脏字段）。 */
  let baseTitle = "";
  let baseContent = "";
  /** Guards the immediate post-conflict retry against infinite loops. */
  let conflictRetryInFlight = false;

  // 内容变化时异步重算当前 hash（快速输入时丢弃过期结果）。
  watch(
    [() => current.value?.title, () => current.value?.content],
    async () => {
      const c = current.value;
      if (!c) {
        currentHash.value = null;
        return;
      }
      const h = await computeHash(c.title, c.content);
      if (current.value === c) currentHash.value = h;
    },
    { immediate: true }
  );

  const dirty = computed(() => {
    if (!current.value) return false;
    if (currentHash.value !== null) {
      return currentHash.value !== saveHash.value;
    }
    // hash 未就绪（异步计算中）：同步字段比较兜底，输入后立即显示未保存。
    return (
      current.value.title !== baseTitle || current.value.content !== baseContent
    );
  });

  /**
   * The sidebar and the editor show the SAME chapter title. Whenever the
   * title of the open chapter changes (typing in the editor's title input),
   * mirror it into the list item so the sidebar updates live, and let the
   * autosave flow persist it (title is part of the dirty hash).
   */
  watch(
    () => current.value?.title,
    (title, previous) => {
      if (!current.value || title === undefined || title === previous) return;
      const item = list.value.find((c) => c.id === current.value?.id);
      if (item && item.title !== title) item.title = title;
      scheduleAutoSave();
    }
  );

  function clearAutoSaveTimer(): void {
    if (autoSaveTimer !== null) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }

  /** Reset all chapter state synchronously (e.g. logout / opening a book). */
  function reset(): void {
    clearAutoSaveTimer();
    saveQueued = false;
    list.value = [];
    current.value = null;
    saveHash.value = "";
    currentHash.value = null;
    baseTitle = "";
    baseContent = "";
    saveError.value = null;
  }

  async function loadList(bookId: number): Promise<void> {
    // Clear stale state up front so the editor doesn't flash the previously
    // opened chapter while the new list is loading.
    reset();
    loading.value = true;
    try {
      list.value = await chapterApi.listChapters(bookId);
    } finally {
      loading.value = false;
    }
  }

  async function select(id: number): Promise<void> {
    if (current.value?.id === id) return;
    // runChapterOp 在操作进行中自动忽略（防连点竞态）。
    await runChapterOp(async () => {
      await flush();
      const chapter = await chapterApi.getChapter(id);
      current.value = chapter;
      // 服务器权威基准：后端返回的整体 hash（打开即干净）。
      saveHash.value = chapter.saveHash;
      currentHash.value = null;
      mergeRetries = 0;
      baseTitle = chapter.title;
      baseContent = chapter.content;
    });
  }

  async function create(bookId: number): Promise<void> {
    await runChapterOp(async () => {
      await flush();
      const chapter = await chapterApi.createChapter(bookId);
      list.value.push(toSummary(chapter));
      current.value = chapter;
      saveHash.value = chapter.saveHash;
      currentHash.value = null;
      mergeRetries = 0;
      baseTitle = chapter.title;
      baseContent = chapter.content;
    });
  }

  async function save(): Promise<void> {
    clearAutoSaveTimer();
    const chapter = current.value;
    if (!chapter) return;

    // 服务器权威对比：本地内容 hash 与后端上次返回的 saveHash 不同才保存。
    // hash 未就绪（异步计算中）时用同步字段比较兜底，避免快速操作被跳过。
    if (currentHash.value !== null) {
      if (currentHash.value === saveHash.value) return;
    } else if (chapter.title === baseTitle && chapter.content === baseContent) {
      return;
    }
    // 字段级 patch：只发送实际变化的字段，避免覆盖其他设备（如 MCP）的写入。
    const patch: { title?: string; content?: string } = {};
    if (chapter.title !== baseTitle) patch.title = chapter.title;
    if (chapter.content !== baseContent) patch.content = chapter.content;
    if (Object.keys(patch).length === 0) return;
    if (saving.value) {
      // A save is already in flight: remember to re-save when it finishes
      // instead of silently dropping these edits.
      saveQueued = true;
      return;
    }

    saving.value = true;
    try {
      const saved = await chapterApi.saveChapter(chapter.id, {
        ...patch,
        baseVersion: chapter.version,
      });
      saveHash.value = saved.saveHash;
      mergeRetries = 0;
      baseTitle = saved.title;
      baseContent = saved.content;
      // 发送后未继续修改的字段写回规范化回显（如标题 trim），
      // 否则本地 hash 与服务器 saveHash 永久不同导致循环保存。
      if (patch.title !== undefined && chapter.title === patch.title) {
        chapter.title = saved.title;
      }
      if (patch.content !== undefined && chapter.content === patch.content) {
        chapter.content = saved.content;
      }
      chapter.updateTime = saved.updateTime;
      chapter.version = saved.version;
      chapter.contentHash = saved.contentHash;
      // A successful save clears any previous failure (failure keeps its
      // message so repeated retries don't re-toast the same error).
      saveError.value = null;
      // Reflect updated metadata in the list.
      const item = list.value.find((c) => c.id === saved.id);
      if (item) {
        item.title = saved.title;
        item.updateTime = saved.updateTime;
        Object.assign(item, getTextStats(saved.content));
        item.version = saved.version;
      }
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : "保存失败";
      if (error instanceof ApiClientError && error.code === 409) {
        // 服务器已被其他设备改写（409 带最新章节）：
        // - 对方只改了非脏字段 → 自动合并（双方保留），以服务器为基线重试；
        // - 对方改了同一字段（真冲突）→ 采用服务器内容，不覆盖对方写入。
        const data = error.data as
          | { version?: number; chapter?: Chapter }
          | undefined;
        if (data?.chapter && current.value?.id === chapter.id) {
          const server = data.chapter;
          const serverChanged = {
            title: server.title !== baseTitle,
            content: server.content !== baseContent,
          };
          const titleConflict = patch.title !== undefined && serverChanged.title;
          const contentConflict =
            patch.content !== undefined && serverChanged.content;
          if (!titleConflict && !contentConflict && mergeRetries < MAX_MERGE_RETRIES) {
            // 无真冲突：合并重试（在途标志下排队，finally 后自动续存）。
            // 连续冲突超过上限则视为对方持续写入，停止重试（避免死循环）。
            mergeRetries++;
            baseTitle = server.title;
            baseContent = server.content;
            // 服务器当前基准：合并后本地脏字段未落盘，hash 对比仍为脏 → 重试保存。
            saveHash.value = server.saveHash;
            currentHash.value = null;
            chapter.version = server.version;
            chapter.title =
              patch.title !== undefined ? chapter.title : server.title;
            chapter.content =
              patch.content !== undefined ? chapter.content : server.content;
            saveError.value = null;
            saveQueued = true;
            return;
          }
          // 真冲突：采用服务器内容，本地未保存修改丢弃（toast 明示）。
          mergeRetries = 0;
          applyServerChapter(server);
          showToast("章节已在其他设备被修改，已加载最新内容");
          return;
        }
        // 老后端无 chapter 数据：对齐 version 后重试（本地权威兜底）。
        saveQueued = false;
        const serverVersion = (error.data as { version?: number } | undefined)
          ?.version;
        if (
          typeof serverVersion === "number" &&
          current.value?.id === chapter.id &&
          !conflictRetryInFlight
        ) {
          current.value.version = serverVersion;
          conflictRetryInFlight = true;
          void save()
            .catch(() => undefined)
            .finally(() => {
              conflictRetryInFlight = false;
            });
          return;
        }
        // Second consecutive conflict (or data missing): fall back to a
        // delayed retry and let the error propagate.
        scheduleAutoSave();
        throw error;
      } else {
        // Transient failure: retry once the idle period passes (no new input
        // required). A failed save must not leave a stale queued flag.
        saveQueued = false;
        scheduleAutoSave();
      }
      throw error;
    } finally {
      saving.value = false;
    }

    // Edits that arrived while we were saving are persisted by a follow-up run.
    if (saveQueued) {
      saveQueued = false;
      void save().catch(() => undefined);
    }
  }

  /** Debounced autosave: called on every edit; fires after an idle period. */
  function scheduleAutoSave(): void {
    clearAutoSaveTimer();
    autoSaveTimer = setTimeout(() => {
      void save().catch(() => undefined);
    }, AUTOSAVE_IDLE_MS);
  }

  /** Immediately persist if there are unsaved changes. */
  async function flush(): Promise<void> {
    clearAutoSaveTimer();
    if (dirty.value) await save();
  }

  /**
   * Adopt a freshly fetched server version of the open chapter (e.g. after a
   * book-wide replace touched it): replaces the object and re-bases the save
   * marker so the editor shows the new content without a false "dirty" state.
   */
  function applyServerChapter(chapter: Chapter): void {
    if (current.value?.id !== chapter.id) return;
    current.value = chapter;
    saveHash.value = chapter.saveHash;
    currentHash.value = null;
    baseTitle = chapter.title;
    baseContent = chapter.content;
    saveError.value = null;
  }

  /**
   * Synchronous best-effort flush for page unload (window/app close), where
   * async requests are not guaranteed to complete.
   */
  function flushSync(): void {
    const chapter = current.value;
    if (!chapter) return;
    // 同步字段比较：hash 是异步计算的，关页面前可能未就绪，不能作为依据。
    if (chapter.title === baseTitle && chapter.content === baseContent) return;
    syncRequest("PUT", `/chapters/${chapter.id}`, {
      title: chapter.title,
      content: chapter.content,
      baseVersion: chapter.version,
    });
  }

  async function remove(id: number): Promise<void> {
    await chapterApi.deleteChapter(id);
    list.value = list.value.filter((c) => c.id !== id);
    if (current.value?.id === id) {
      current.value = null;
      saveHash.value = "";
      currentHash.value = null;
      baseTitle = "";
      baseContent = "";
    }
  }

  async function rename(id: number, title: string): Promise<void> {
    const normalizedTitle = title.trim() || "未命名章节";
    const item = list.value.find((chapter) => chapter.id === id);
    if (item?.title === normalizedTitle) return;

    if (current.value?.id === id) {
      const previousTitle = current.value.title;
      current.value.title = normalizedTitle;
      if (item) item.title = normalizedTitle;
      try {
        await save();
      } catch (error) {
        current.value.title = previousTitle;
        if (item) item.title = previousTitle;
        throw error;
      }
      return;
    }

    const chapter = await chapterApi.getChapter(id);
    const saved = await chapterApi.saveChapter(id, {
      title: normalizedTitle,
      content: chapter.content,
      baseVersion: chapter.version,
    });
    if (item) Object.assign(item, toSummary(saved));
  }

  async function duplicate(id: number): Promise<void> {
    await flush();
    const source =
      current.value?.id === id
        ? current.value
        : await chapterApi.getChapter(id);
    const duplicateTitle = `${source.title || "未命名章节"} 副本`;
    const created = await chapterApi.createChapter(source.bookId, duplicateTitle);

    try {
      const copied = await chapterApi.saveChapter(created.id, {
        title: duplicateTitle,
        content: source.content,
        baseVersion: created.version,
      });
      const sourceIndex = list.value.findIndex((chapter) => chapter.id === id);
      const insertIndex = sourceIndex < 0 ? list.value.length : sourceIndex + 1;
      list.value.splice(insertIndex, 0, toSummary(copied));

      const orderedIds = list.value.map((chapter) => chapter.id);
      list.value = await chapterApi.reorderChapters(source.bookId, orderedIds);
      current.value = copied;
      saveHash.value = copied.saveHash;
      currentHash.value = null;
      baseTitle = copied.title;
      baseContent = copied.content;
    } catch (error) {
      list.value = list.value.filter((chapter) => chapter.id !== created.id);
      await chapterApi.deleteChapter(created.id).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Persist a new chapter order. Applies the order optimistically to the local
   * list, then syncs with the server; on failure re-fetches the list.
   */
  async function reorder(bookId: number, orderedIds: number[]): Promise<void> {
    const byId = new Map(list.value.map((c) => [c.id, c]));
    const next = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is ChapterSummary => c !== undefined);
    if (next.length === list.value.length) list.value = next;

    try {
      list.value = await chapterApi.reorderChapters(bookId, orderedIds);
    } catch (e) {
      list.value = await chapterApi.listChapters(bookId);
      throw e;
    }
  }

  return {
    list,
    current,
    loading,
    saving,
    dirty,
    saveError,
    selecting,
    loadList,
    select,
    create,
    save,
    scheduleAutoSave,
    flush,
    flushSync,
    reset,
    applyServerChapter,
    remove,
    rename,
    duplicate,
    reorder,
  };
}
