<script setup lang="ts">
import { ref, onMounted } from "vue";
import BaseDialog from "./dialog/BaseDialog.vue";
import { useConfirm } from "../composables/useConfirm";
import { showToast } from "../composables/useToast";
import * as writerApi from "../api/writer";
import * as chapterApi from "../api/chapter";
import type { HistoryItem, HistoryDetail } from "../types/writer";
import { formatCount } from "../utils/textStats";
import LoadingIndicator from "./LoadingIndicator.vue";

/**
 * 版本历史：列出章节最近 5 个快照（保存前自动生成），可查看内容并恢复。
 */
const props = defineProps<{ chapterId: number }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "restored", version: number): void;
}>();

const confirm = useConfirm();

const items = ref<HistoryItem[]>([]);
const loading = ref(true);
const selected = ref<HistoryDetail | null>(null);
const selectedId = ref<number | null>(null);
const restoring = ref(false);

onMounted(() => {
  void loadList();
});

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    items.value = await writerApi.getChapterHistory(props.chapterId);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "加载历史失败", "error");
  } finally {
    loading.value = false;
  }
}

let detailSeq = 0;

async function selectItem(item: HistoryItem): Promise<void> {
  if (selectedId.value === item.id) return;
  const seq = ++detailSeq; // 只接受最后一次请求的结果
  selectedId.value = item.id;
  selected.value = null;
  try {
    const detail = await writerApi.getHistoryItem(props.chapterId, item.id);
    if (seq !== detailSeq) return; // 过期响应（用户已切换其他版本）
    selected.value = detail;
  } catch (error) {
    if (seq !== detailSeq) return;
    showToast(error instanceof Error ? error.message : "加载版本失败", "error");
    selectedId.value = null;
  }
}

function formatTime(raw: string): string {
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

async function restore(): Promise<void> {
  const detail = selected.value;
  if (!detail) return;
  const ok = await confirm({
    title: "恢复此版本？",
    message: "当前章节内容将被该版本覆盖（当前内容会保留为新快照）。",
    confirmText: "恢复",
    tone: "default",
  });
  if (!ok) return;

  restoring.value = true;
  try {
    // 用服务器当前 version 作为乐观锁基线：弹窗打开期间自动保存可能已
    // 推进版本，用旧值会导致 409。
    const fresh = await chapterApi.getChapter(props.chapterId);
    await chapterApi.saveChapter(props.chapterId, {
      title: detail.title,
      content: detail.content,
      baseVersion: fresh.version,
    });
    showToast(`已恢复 v${detail.version} 版本`, "success");
    emit("restored", detail.version);
    emit("close");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "恢复失败", "error");
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <BaseDialog :visible="true" :close-on-mask="false" @close="emit('close')">
    <div class="history">
      <h3 class="history-title">版本历史</h3>
      <p class="history-sub">每次保存前的版本自动保留，最多 5 个</p>

      <div v-if="loading" class="history-loading">
        <LoadingIndicator text="加载中" />
      </div>
      <div v-else-if="items.length === 0" class="history-empty">
        暂无历史版本（保存章节后自动生成）
      </div>
      <div v-else class="history-layout">
        <ul class="history-list">
          <li
            v-for="item in items"
            :key="item.id"
            :class="{ active: selectedId === item.id }"
            @click="selectItem(item)"
          >
            <span class="history-item-main">
              <b>v{{ item.version }}</b>
              <span class="history-item-time">{{ formatTime(item.createTime) }}</span>
            </span>
            <span class="history-item-meta">{{ formatCount(item.wordCount) }} 字</span>
          </li>
        </ul>

        <div class="history-preview">
          <div v-if="selectedId !== null && !selected" class="history-preview-empty">
            <LoadingIndicator text="加载中" />
          </div>
          <div v-else-if="!selected" class="history-preview-empty">
            点击左侧版本查看内容
          </div>
          <template v-else>
            <div class="history-preview-head">
              <span>{{ selected.title || "未命名章节" }}</span>
              <button
                class="history-restore"
                :disabled="restoring"
                @click="restore"
              >
                {{ restoring ? "恢复中…" : "恢复此版本" }}
              </button>
            </div>
            <pre class="history-content">{{ selected.content || "（空内容）" }}</pre>
          </template>
        </div>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #2a2a2a;
}

.history-sub {
  margin: 0 0 4px;
  font-size: 12px;
  color: #999;
}

.history-loading,
.history-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: #b6b0a1;
}

.history-layout {
  display: flex;
  gap: 12px;
  min-height: 280px;
}

.history-list {
  flex: 0 0 200px;
  margin: 0;
  padding: 0;
  list-style: none;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  overflow-y: auto;
}

.history-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.14s ease;
}

.history-list li:hover {
  background: #f5f3ee;
}

.history-list li.active {
  background: #e8edfb;
}

.history-item-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.history-item-main b {
  font-size: 13px;
  color: #333;
}

.history-item-time {
  font-size: 11px;
  color: #999;
}

.history-item-meta {
  font-size: 11px;
  color: #b6b0a1;
}

.history-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #b6b0a1;
}

.history-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #333;
}

.history-restore {
  padding: 5px 12px;
  font-size: 12.5px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 7px;
  cursor: pointer;
}

.history-restore:hover {
  background: #3f5de0;
}

.history-restore:disabled {
  opacity: 0.55;
  cursor: default;
}

.history-content {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px 14px;
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    serif;
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
  background: #faf8f3;
  border-radius: 10px;
  overflow-y: auto;
}
</style>
