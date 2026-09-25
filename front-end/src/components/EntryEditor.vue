<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from "vue";
import * as writerApi from "../api/writer";
import { ApiClientError } from "../api/http";
import type { Entry, EntryType } from "../types/writer";
import { ENTRY_TYPE_LABELS } from "../types/writer";
import { useConfirm } from "../composables/useConfirm";
import { showToast } from "../composables/useToast";
import { useBusy } from "../composables/useBusy";
import { AUTOSAVE_IDLE_MS } from "../config";
import LoadingIndicator from "./LoadingIndicator.vue";

/**
 * 设定条目编辑器（表单核心）：标题 + 内容 + 防抖自动保存 + 删除。
 * 可被弹层（EntryEditDialog）或全屏视图（SettingsPanel）复用。
 */
const props = withDefaults(
  defineProps<{
    entryId: number;
    /** 是否显示"完成"按钮（弹窗模式显示；全屏铺开模式隐藏，点左侧条目切换）。
     * 注意：Vue 对未传的布尔 prop 会规范化为 false，必须显式默认 true。 */
    showDone?: boolean;
  }>(),
  { showDone: true }
);

const emit = defineEmits<{
  (e: "saved", entry: Entry): void;
  (e: "deleted"): void;
  (e: "close"): void;
}>();

const confirm = useConfirm();

const entry = ref<Entry | null>(null);
const loading = ref(true);
const saveState = ref<"saved" | "saving" | "dirty">("saved");
const { busy: deleting, run: runDelete } = useBusy();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 加载序号：丢弃过期响应（快速切换条目时防串写）。 */
let loadSeq = 0;
/** 保存序号：丢弃过期响应（并发保存时旧响应不得回退新响应设置的状态）。 */
let saveSeq = 0;
/** 删除进行中：在途保存的 404 属预期，不再弹错误。 */
let removing = false;
/** 409 自动合并重试上限：连续冲突超过则采用服务器内容，避免对方持续写入时死循环。 */
const MAX_MERGE_RETRIES = 3;
let mergeRetries = 0;
/** 串行化：同一时间只有一个保存请求在途，避免并发写乱序覆盖服务器值。 */
let persistInFlight = false;
/** 服务器一致基线：上次加载/保存成功后的值（用于 409 对比与字段级保存）。 */
let baseTitle = "";
let baseContent = "";
/** 用户实际修改过的字段：保存只发送这些字段，避免覆盖其他设备的写入。 */
let dirtyFields = new Set<"title" | "content">();

type DirtyPatch = { title?: string; content?: string };

/**
 * 排队中的保存（固定快照，续存不依赖 entry.value——切条目后它会被置 null，
 * 否则挂起修改会丢失）。按条目 id 去重，不同条目各自排队。
 */
let queuedSaves: Array<{
  id: number;
  patch: DirtyPatch;
  version: number;
  fields: ReadonlySet<"title" | "content">;
}> = [];

function queueSave(
  id: number,
  patch: DirtyPatch,
  version: number,
  fields: ReadonlySet<"title" | "content">
): void {
  const item = { id, patch, version, fields };
  const idx = queuedSaves.findIndex((q) => q.id === id);
  if (idx >= 0) queuedSaves[idx] = item;
  else queuedSaves.push(item);
}

/** 用户输入后的防抖保存入口（只保存脏字段）。 */
async function persist(): Promise<void> {
  const current = entry.value;
  if (!current || dirtyFields.size === 0) return;
  const patch: DirtyPatch = {};
  if (dirtyFields.has("title")) patch.title = current.title;
  if (dirtyFields.has("content")) patch.content = current.content;
  await saveSnapshot(current.id, patch, current.version, new Set(dirtyFields));
}

/**
 * 保存指定条目（串行化 + 字段级）。排队时固定快照，切条目/卸载后仍能落盘。
 * 409（服务器被其他设备改写）：对比基线自动合并——对方只改了非脏字段则保留双方；
 * 改了脏字段（真冲突）则采用服务器内容，不覆盖对方的写入。
 */
async function saveSnapshot(
  id: number,
  patch: DirtyPatch,
  version: number,
  fields: ReadonlySet<"title" | "content">
): Promise<void> {
  if (persistInFlight) {
    queueSave(id, patch, version, fields);
    return;
  }
  persistInFlight = true;
  saveTimer = null;
  // 仅当前条目才更新保存状态：切条目后的续存不应影响当前显示。
  if (entry.value && entry.value.id === id) saveState.value = "saving";
  const seq = ++saveSeq;
  try {
    const saved = await writerApi.updateEntry(id, {
      title: fields.has("title") ? patch.title : undefined,
      content: fields.has("content") ? patch.content : undefined,
      baseVersion: version,
    });
    // 已有更新的保存请求：旧响应不得覆盖新响应的状态/内容。
    if (seq !== saveSeq) return;
    // 守卫 id：切换条目后旧保存响应不得覆盖新条目。
    if (entry.value && entry.value.id === id) {
      mergeRetries = 0;
      baseTitle = saved.title;
      baseContent = saved.content;
      entry.value.version = saved.version;
      // 保存的字段若用户已继续修改 → 保持脏；否则清脏并写回规范化回显。
      const stillDirty = new Set<"title" | "content">();
      if (fields.has("title") && entry.value.title !== patch.title) stillDirty.add("title");
      if (fields.has("content") && entry.value.content !== patch.content) stillDirty.add("content");
      dirtyFields = stillDirty;
      if (stillDirty.size === 0) {
        entry.value.title = saved.title;
        entry.value.content = saved.content;
        saveState.value = "saved";
        emit("saved", saved);
      } else {
        saveState.value = "dirty";
        // 写回已保存字段的规范化值（未继续修改的部分）。
        if (fields.has("title") && !stillDirty.has("title")) entry.value.title = saved.title;
        if (fields.has("content") && !stillDirty.has("content")) entry.value.content = saved.content;
        emit("saved", { ...saved, title: entry.value.title, content: entry.value.content });
      }
    } else {
      // 已切换到其他条目：仅同步列表项。
      emit("saved", saved);
    }
  } catch (error) {
    // 删除进行中：条目已不存在，404 属预期，不打扰用户。
    if (removing) return;
    if (seq !== saveSeq) return;
    if (
      error instanceof ApiClientError &&
      error.code === 409 &&
      entry.value &&
      entry.value.id === id
    ) {
      const data = error.data as { entry?: Entry } | undefined;
      if (data?.entry) {
        const server = data.entry;
        // 服务器相对我们基线的变更字段。
        const serverChanged = {
          title: server.title !== baseTitle,
          content: server.content !== baseContent,
        };
        const titleConflict = dirtyFields.has("title") && serverChanged.title;
        const contentConflict = dirtyFields.has("content") && serverChanged.content;
        if (
          !titleConflict &&
          !contentConflict &&
          mergeRetries < MAX_MERGE_RETRIES
        ) {
          // 无真冲突：自动合并——服务器值做新基线，本地脏字段保留，重试保存。
          // 连续冲突超过上限则视为对方持续写入，停止重试（避免死循环）。
          mergeRetries++;
          entry.value = {
            ...server,
            title: dirtyFields.has("title") ? entry.value.title : server.title,
            content: dirtyFields.has("content") ? entry.value.content : server.content,
          };
          baseTitle = server.title;
          baseContent = server.content;
          saveState.value = "dirty";
          emit("saved", entry.value);
          void persist(); // 在途标志下会排队，finally 后自动重试（新 version）
          return;
        }
        // 真冲突（同一字段双方都改）：采用服务器最新内容，不覆盖对方写入；
        // 本地未保存修改随之丢弃（toast 明示）。
        entry.value = server;
        baseTitle = server.title;
        baseContent = server.content;
        dirtyFields = new Set();
        mergeRetries = 0;
        queuedSaves = queuedSaves.filter((q) => q.id !== id);
        saveState.value = "saved";
        emit("saved", server);
        showToast("条目已在其他设备被修改，已加载最新内容");
        return;
      }
    }
    if (entry.value && entry.value.id === id) {
      saveState.value = "dirty";
    }
    showToast(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    persistInFlight = false;
    const next = queuedSaves.shift();
    if (next) {
      // 续存排队期间的最新修改
      void saveSnapshot(next.id, next.patch, next.version, next.fields);
    }
  }
}

async function loadEntry(id: number): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  entry.value = null;
  saveState.value = "saved";
  dirtyFields = new Set();
  mergeRetries = 0;
  try {
    const data = await writerApi.getEntry(id);
    if (seq !== loadSeq) return; // 已切到其他条目，丢弃
    entry.value = data;
    baseTitle = data.title;
    baseContent = data.content;
  } catch (error) {
    if (seq !== loadSeq) return;
    showToast(error instanceof Error ? error.message : "加载条目失败", "error");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

/** Ctrl/Cmd+S：立即落盘（跳过防抖），与章节编辑器一致。 */
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void persist();
  }
}

onMounted(() => {
  void loadEntry(props.entryId);
  window.addEventListener("keydown", onKeydown);
});

// 条目切换（全屏点左侧不同条目/弹窗换条目）：先落盘旧条目挂起修改，再加载新条目。
watch(
  () => props.entryId,
  (id) => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void persist();
    }
    void loadEntry(id);
  }
);

/** 用户输入（@input 驱动）：标记脏字段并防抖落盘。IME 组合中不触发。 */
function onUserInput(e: Event, field: "title" | "content"): void {
  if (!entry.value) return;
  // 中文输入法组合中（未确认），不触发保存；compositionend 后会再发一次
  // input 事件（isComposing=false）补上。
  if ((e as InputEvent).isComposing) return;
  dirtyFields.add(field);
  saveState.value = "dirty";
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist();
  }, AUTOSAVE_IDLE_MS);
}

/** 完成：先落盘未保存修改，再通知关闭。 */
function onDone(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void persist();
  }
  emit("close");
}

async function onRemove(): Promise<void> {
  const ok = await confirm({
    title: "删除条目？",
    message: "删除后该条目的内容无法恢复。",
    confirmText: "删除",
  });
  if (!ok) return;
  // 取消挂起的自动保存：删除后卸载时的 persist 会对已删除条目报 404。
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 在途保存的 404 属预期（条目即将不存在），不弹错误。
  removing = true;
  await runDelete(async () => {
    await writerApi.deleteEntry(props.entryId);
    emit("deleted");
    emit("close");
  }).catch((error) => {
    // 删除失败：恢复 removing，之后的保存失败仍需正常提示。
    removing = false;
    showToast(error instanceof Error ? error.message : "删除失败", "error");
  });
}

const saveStateText = computed(() => {
  if (saveState.value === "saving") return "保存中…";
  if (saveState.value === "dirty") return "未保存";
  return "已保存";
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  // 卸载前立即保存未落盘的修改，避免最后一段输入丢失。
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void persist();
  }
});
</script>

<template>
  <div v-if="loading" class="entry-loading">
    <LoadingIndicator text="加载中" />
  </div>
  <template v-else-if="entry">
    <div class="entry-head">
      <span class="entry-type-badge" :class="entry.type">{{
        ENTRY_TYPE_LABELS[entry.type as EntryType]
      }}</span>
      <div class="entry-head-right">
        <span class="entry-save-state" :class="saveState">{{
          saveStateText
        }}</span>
        <button class="entry-delete" :disabled="deleting" @click="onRemove">
          {{ deleting ? "删除中…" : "删除" }}
        </button>
      </div>
    </div>
    <input
      :value="entry.title"
      class="entry-title-input"
      placeholder="未命名条目"
      aria-label="条目标题"
      spellcheck="false"
      @input="entry.title = ($event.target as HTMLInputElement).value; onUserInput($event, 'title')"
    />
    <textarea
      :value="entry.content"
      class="entry-content"
      placeholder="记录这个设定的一切……"
      spellcheck="false"
      @input="entry.content = ($event.target as HTMLTextAreaElement).value; onUserInput($event, 'content')"
    ></textarea>
    <div v-if="props.showDone" class="entry-actions">
      <button class="entry-close" @click="onDone">完成</button>
    </div>
  </template>
</template>

<style scoped>
.entry-loading {
  padding: 30px 0;
  text-align: center;
  font-size: 13px;
  color: #b6b0a1;
}

.entry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.entry-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.entry-type-badge {
  padding: 2px 10px;
  font-size: 11.5px;
  border-radius: 999px;
}

.entry-type-badge.character {
  color: #b0524a;
  background: rgba(196, 93, 85, 0.12);
}

.entry-type-badge.location {
  color: #3e6f9c;
  background: rgba(79, 110, 247, 0.1);
}

.entry-type-badge.concept {
  color: #6b7d3a;
  background: rgba(122, 148, 60, 0.12);
}

.entry-save-state {
  font-size: 12px;
  color: #b6b0a1;
}

.entry-save-state.dirty {
  color: #a48a56;
}

.entry-save-state.saving {
  color: #78849c;
}

.entry-title-input {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 2px;
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    serif;
  font-size: 20px;
  font-weight: 700;
  color: #2b2b2b;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  outline: none;
}

.entry-content {
  box-sizing: border-box;
  width: 100%;
  height: 260px;
  margin-top: 12px;
  padding: 14px 16px;
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    serif;
  font-size: 14.5px;
  line-height: 1.9;
  color: #333;
  background: #faf8f3;
  border: none;
  border-radius: 10px;
  outline: none;
  resize: vertical;
}

.entry-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 14px;
}

.entry-delete {
  padding: 6px 14px;
  font-size: 12.5px;
  color: #c45d55;
  background: transparent;
  border: 1px solid rgba(196, 93, 85, 0.35);
  border-radius: 8px;
  cursor: pointer;
}

.entry-delete:hover {
  background: rgba(196, 93, 85, 0.08);
}

.entry-close {
  padding: 6px 16px;
  font-size: 12.5px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.entry-close:hover {
  background: #3f5de0;
}
</style>
