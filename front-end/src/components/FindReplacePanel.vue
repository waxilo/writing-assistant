<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount, nextTick } from "vue";
import type { useChapters } from "../composables/useChapters";
import * as chapterApi from "../api/chapter";
import { useConfirm } from "../composables/useConfirm";
import { showToast } from "../composables/useToast";

/**
 * 查找 / 全局替换面板。
 * 范围：本章（本地统计 + 替换）或全书（后端统计 + 批量替换）。
 * 定位/重载编辑器 DOM 通过 emit 交由父组件调用 ChapterEditor 的暴露方法。
 */
const props = defineProps<{
  bookId: number;
  chapters: ReturnType<typeof useChapters>;
}>();

const emit = defineEmits<{
  /** 让父组件重载编辑器 DOM（本章替换后内容已变） */
  (e: "reload-editor"): void;
  /** 让父组件在编辑器内定位关键字 */
  (e: "locate", keyword: string): void;
  /** 让父组件切换章节并定位 */
  (e: "open-and-locate", chapterId: number, keyword: string): void;
}>();

const confirm = useConfirm();

const query = ref("");
const replaceTo = ref("");
const scope = ref<"chapter" | "book">("chapter");
const queryInput = ref<HTMLInputElement | null>(null);

/** 打开面板时聚焦查找框（由父组件在 Ctrl+F 时调用）。 */
function focusQuery(): void {
  void nextTick(() => {
    queryInput.value?.focus();
    queryInput.value?.select();
  });
}

defineExpose({ focusQuery });

// --- stats ------------------------------------------------------------------

/** 本章匹配数（本地统计，区分大小写与替换一致）。 */
const chapterMatches = computed(() => {
  const content = props.chapters.current.value?.content ?? "";
  if (!query.value) return 0;
  return countOccurrences(content, query.value);
});

/** 全书匹配统计（后端）。 */
const bookSearch = ref<{ totalMatches: number; chapters: { id: number; title: string; count: number }[] } | null>(null);
const searching = ref(false);
const replacing = ref(false);

function countOccurrences(content: string, keyword: string): number {
  let count = 0;
  let index = content.indexOf(keyword);
  while (index !== -1) {
    count++;
    index = content.indexOf(keyword, index + keyword.length);
  }
  return count;
}

const summaryText = computed(() => {
  if (!query.value) return "";
  if (scope.value === "chapter") {
    return chapterMatches.value > 0
      ? `本章共 ${chapterMatches.value} 处`
      : "本章无匹配";
  }
  if (!bookSearch.value) return "";
  return bookSearch.value.totalMatches > 0
    ? `全书 ${bookSearch.value.chapters.length} 章共 ${bookSearch.value.totalMatches} 处`
    : "全书无匹配";
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;

// 查询防抖：本章即时；全书 400ms 后调接口。
watch([query, scope], () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  bookSearch.value = null;
  if (!query.value) return;
  if (scope.value === "chapter") return; // 本地统计，即时
  searchTimer = setTimeout(() => {
    void runBookSearch();
  }, 400);
});

async function runBookSearch(): Promise<void> {
  const q = query.value.trim();
  if (!q) return;
  searching.value = true;
  try {
    bookSearch.value = await chapterApi.searchChapters(props.bookId, q);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "查找失败", "error");
  } finally {
    searching.value = false;
  }
}

/** 查找下一个：本章内定位（再次调用会滚动到第一处）。 */
function onFindNext(): void {
  const q = query.value.trim();
  if (!q) return;
  if (scope.value === "book" && bookSearch.value && bookSearch.value.chapters.length > 0) {
    const first = bookSearch.value.chapters[0];
    emit("open-and-locate", first.id, q);
    return;
  }
  emit("locate", q);
}

/** 点击全书结果中的章节：跳转并定位。 */
function onJumpToChapter(chapterId: number): void {
  emit("open-and-locate", chapterId, query.value.trim());
}

// --- replace ----------------------------------------------------------------

async function onReplaceChapter(): Promise<void> {
  const chapter = props.chapters.current.value;
  const q = query.value.trim();
  if (!chapter || !q) return;
  const count = chapterMatches.value;
  if (count === 0) return;

  const ok = await confirm({
    title: "替换本章全部？",
    message: `将替换本章 ${count} 处「${q}」为「${replaceTo.value}」，保存后不可撤销。`,
    confirmText: "全部替换",
    tone: "default",
  });
  if (!ok) return;

  replacing.value = true;
  chapter.content = chapter.content.split(q).join(replaceTo.value);
  emit("reload-editor");
  try {
    await props.chapters.save();
    showToast(`已替换本章 ${count} 处`, "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    replacing.value = false;
  }
}

async function onReplaceBook(): Promise<void> {
  const q = query.value.trim();
  if (!q) return;
  if (!bookSearch.value || bookSearch.value.totalMatches === 0) {
    showToast("全书无匹配，无需替换", "info");
    return;
  }
  const total = bookSearch.value.totalMatches;
  const ok = await confirm({
    title: "替换全书？",
    message: `将在 ${bookSearch.value.chapters.length} 章中替换 ${total} 处「${q}」为「${replaceTo.value}」，保存后不可撤销。`,
    confirmText: "全部替换",
    tone: "default",
  });
  if (!ok) return;

  replacing.value = true;
  try {
    // 先保存当前章节的未保存编辑，再执行全书替换（服务器基于最新内容）。
    try {
      await props.chapters.flush();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败", "error");
      return;
    }
    const result = await chapterApi.replaceAllChapters(
      props.bookId,
      q,
      replaceTo.value
    );
    showToast(`已替换 ${result.totalReplaced} 处`, "success");

    // 刷新列表元数据（版本/字数已变）。
    const currentId = props.chapters.current.value?.id;
    const freshList = await chapterApi.listChapters(props.bookId);
    props.chapters.list.value = freshList;

    // 当前章节若被替换，重新加载最新内容（applyServerChapter 重置保存基准）。
    if (typeof currentId === "number") {
      const touched = result.chapters.some((c) => c.id === currentId);
      if (touched) {
        const fresh = await chapterApi.getChapter(currentId);
        props.chapters.applyServerChapter(fresh);
      }
    }
    // 重新统计。
    if (bookSearch.value) await runBookSearch();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "替换失败", "error");
  } finally {
    replacing.value = false;
  }
}

// 切换范围时若全书无统计则自动补一次查询。
watch(scope, (value) => {
  if (value === "book" && query.value.trim() && !bookSearch.value) {
    void runBookSearch();
  }
});

onBeforeUnmount(() => {
  if (searchTimer !== null) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="find-panel">
    <div class="find-row">
      <input
        ref="queryInput"
        v-model="query"
        class="find-input"
        placeholder="查找关键字…"
        aria-label="查找关键字"
        spellcheck="false"
        @keydown.enter.prevent="onFindNext"
      />
      <select v-model="scope" class="find-scope" aria-label="查找范围">
        <option value="chapter">本章</option>
        <option value="book">全书</option>
      </select>
      <span class="find-summary" :class="{ muted: searching }">
        {{ searching ? "查找中…" : summaryText }}
      </span>
    </div>

    <div v-if="scope === 'book' && bookSearch && bookSearch.chapters.length > 0" class="find-results">
      <button
        v-for="ch in bookSearch.chapters"
        :key="ch.id"
        class="find-result"
        :class="{ active: ch.id === chapters.current.value?.id }"
        @click="onJumpToChapter(ch.id)"
      >
        <span class="result-title">{{ ch.title || "未命名章节" }}</span>
        <span class="result-count">{{ ch.count }} 处</span>
      </button>
    </div>

    <div class="find-row find-row-actions">
      <input
        v-model="replaceTo"
        class="find-input"
        placeholder="替换为…"
        aria-label="替换为"
        spellcheck="false"
        @keydown.enter.prevent="scope === 'chapter' ? onReplaceChapter() : onReplaceBook()"
      />
      <button class="find-btn" :disabled="replacing" @click="scope === 'chapter' ? onReplaceChapter() : onReplaceBook()">
        {{ scope === "chapter" ? "替换本章全部" : "替换全书全部" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.find-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  background: #fffdf8;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
}

.find-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.find-row-actions {
  padding-top: 2px;
}

.find-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  padding: 7px 12px;
  font-size: 13px;
  color: #333;
  background: #fff;
  border: 1px solid #e2ddd2;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s ease;
}

.find-input:focus {
  border-color: #4f6ef7;
}

.find-scope {
  padding: 6px 8px;
  font-size: 13px;
  color: #555;
  background: #f5f3ee;
  border: 1px solid #e2ddd2;
  border-radius: 8px;
  outline: none;
  cursor: pointer;
}

.find-summary {
  font-size: 12.5px;
  color: #6b7a9c;
  white-space: nowrap;
}

.find-summary.muted {
  color: #aaa;
}

.find-results {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 84px;
  overflow-y: auto;
}

.find-result {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12.5px;
  color: #444;
  background: #f5f3ee;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.find-result:hover {
  background: #efece4;
}

.find-result.active {
  background: #e8edfb;
  border-color: #c9d4f5;
}

.result-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-count {
  color: #8a95ad;
  font-variant-numeric: tabular-nums;
}

.find-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  font-size: 13px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.find-btn:hover {
  background: #3f5de0;
}

.find-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
