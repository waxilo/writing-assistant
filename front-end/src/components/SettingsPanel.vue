<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import * as writerApi from "../api/writer";
import type { Entry, EntryType } from "../types/writer";
import { showToast } from "../composables/useToast";
import { useBusy } from "../composables/useBusy";
import EntryList from "./EntryList.vue";
import EntryEditDialog from "./EntryEditDialog.vue";
import EntryEditor from "./EntryEditor.vue";

/**
 * 设定资料库（右侧面板）：人物 / 地点 / 设定 条目列表。
 * 窄面板点击条目弹层编辑；「全屏」按钮铺开覆盖整个屏幕（左列表 + 右内联编辑）。
 * 列表本体抽到 EntryList 供两种形态共用，保证交互一致。
 */
const props = defineProps<{ bookId: number }>();

type Filter = EntryType;
const filter = ref<Filter>("character");
const entries = ref<Entry[]>([]);
const loading = ref(false);
/** 加载序号：丢弃过期响应（快速切 tab 时旧响应不得覆盖新列表）。 */
let listSeq = 0;
const editingId = ref<number | null>(null);
/** 全屏铺开模式（覆盖整个屏幕）。 */
const expanded = ref(false);
/** 新建条目进行中（禁用新建按钮防重复提交）。 */
const { busy: creating, run: runCreate } = useBusy();

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && expanded.value) closeExpanded();
}

onMounted(() => {
  void loadList();
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

async function loadList(): Promise<void> {
  const seq = ++listSeq;
  loading.value = true;
  try {
    const res = await writerApi.listEntries(props.bookId, filter.value);
    if (seq !== listSeq) return; // 已有更新的加载：丢弃过期响应
    entries.value = res;
  } catch (error) {
    if (seq !== listSeq) return;
    showToast(error instanceof Error ? error.message : "加载设定失败", "error");
  } finally {
    if (seq === listSeq) loading.value = false;
  }
}

function onFilterChange(type: Filter): void {
  if (type === filter.value) return;
  filter.value = type;
  // 切换类型时清空编辑器选中，避免右侧仍显示上一类型的条目造成"未切换"错觉。
  editingId.value = null;
  void loadList();
}

async function onCreate(): Promise<void> {
  const type: EntryType = filter.value;
  await runCreate(async () => {
    const entry = await writerApi.createEntry(props.bookId, type);
    entries.value.push(entry);
    editingId.value = entry.id;
  }).catch((error) => {
    showToast(error instanceof Error ? error.message : "新建条目失败", "error");
  });
}

/** 保存成功：仅同步列表项，不关闭弹窗。 */
function onSaved(saved: Entry): void {
  const index = entries.value.findIndex((e) => e.id === saved.id);
  if (index !== -1) {
    entries.value[index] = saved;
  } else if (saved.type === filter.value) {
    // 仅当类型匹配当前列表才插入：切换类型时卸载 flush 的保存响应
    // 属于上一类型，插入会污染当前列表。
    entries.value.push(saved);
  }
}

/** 关闭/删除：关闭弹窗；删除时同步移除列表项。 */
function onEditedClose(deleted: boolean): void {
  const id = editingId.value;
  editingId.value = null;
  if (deleted && id !== null) {
    entries.value = entries.value.filter((e) => e.id !== id);
  }
}

/** 拖拽排序：按 id 序列重排（乐观），再持久化；失败回滚为服务器顺序。 */
async function onReorder(ids: number[]): Promise<void> {
  const byId = new Map(entries.value.map((e) => [e.id, e]));
  const next = ids
    .map((id) => byId.get(id))
    .filter((e): e is Entry => e !== undefined);
  // 列表在拖拽期间已被刷新（长度不匹配）→ 放弃本次重排。
  if (next.length !== entries.value.length) return;
  entries.value = next;
  try {
    await writerApi.reorderEntries(
      props.bookId,
      filter.value,
      next.map((e) => e.id)
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : "排序保存失败", "error");
    void loadList();
  }
}

/** 退出全屏：同时清空编辑选中，避免退出后弹层从背后弹出。 */
function closeExpanded(): void {
  expanded.value = false;
  editingId.value = null;
}

/** 供父级（EditorView 头部的全屏按钮）调用。 */
function expand(): void {
  expanded.value = true;
}
defineExpose({ expand });
</script>

<template>
  <div class="settings">
    <!-- 窄面板形态 -->
    <template v-if="!expanded">
      <EntryList
        :filter="filter"
        :entries="entries"
        :loading="loading"
        :editing-id="editingId"
        @update:filter="onFilterChange"
        @select="editingId = $event"
        @reorder="onReorder"
      >
        <template #headActions>
          <button
            class="settings-add"
            title="新建条目"
            aria-label="新建条目"
            :disabled="creating"
            @click="onCreate"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </template>
      </EntryList>

      <EntryEditDialog
        v-if="editingId !== null"
        :entry-id="editingId"
        @close="onEditedClose(false)"
        @saved="onSaved"
        @deleted="onEditedClose(true)"
      />
    </template>

    <!-- 全屏铺开：左列表 + 右内联编辑器，覆盖整个屏幕 -->
    <Teleport to="body">
      <div v-if="expanded" class="settings-expanded">
        <div class="expanded-head">
          <span class="expanded-title">📚 设定资料库</span>
          <div class="expanded-actions">
            <button class="expanded-new" :disabled="creating" @click="onCreate">
              {{ creating ? "创建中…" : "＋ 新建条目" }}
            </button>
            <button class="expanded-close" @click="closeExpanded">
              关闭（Esc）
            </button>
          </div>
        </div>

        <div class="expanded-body">
          <aside class="expanded-sidebar">
            <EntryList
              :filter="filter"
              :entries="entries"
              :loading="loading"
              :editing-id="editingId"
              @update:filter="onFilterChange"
              @select="editingId = $event"
              @reorder="onReorder"
            />
          </aside>

          <section class="expanded-editor">
            <EntryEditor
              v-if="editingId !== null"
              :entry-id="editingId"
              :show-done="false"
              @saved="onSaved"
              @deleted="onEditedClose(true)"
              @close="editingId = null"
            />
            <div v-else class="expanded-placeholder">
              <p>从左侧选择一个条目，或点击「＋ 新建条目」</p>
            </div>
          </section>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 窄面板头部动作按钮（slot 内容由本组件渲染，样式须在此声明） */
.settings-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: #8a8577;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
}

.settings-add:hover {
  background: #f0eee7;
  color: #444;
}

.settings-add:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ---- 全屏铺开模式 ---- */
.settings-expanded {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  flex-direction: column;
  background: #f5f3ee;
}

.expanded-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 56px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.expanded-title {
  font-size: 15px;
  font-weight: 600;
  color: #3a3a3a;
}

.expanded-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.expanded-new {
  padding: 7px 14px;
  font-size: 12.5px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.expanded-new:hover {
  background: #3f5de0;
}

.expanded-close {
  padding: 7px 14px;
  font-size: 12.5px;
  color: #666;
  background: transparent;
  border: 1px solid #ddd6c8;
  border-radius: 8px;
  cursor: pointer;
}

.expanded-close:hover {
  background: rgba(0, 0, 0, 0.05);
}

.expanded-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.expanded-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #faf8f3;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  overflow-y: auto;
}

.expanded-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 40px;
  overflow-y: auto;
}

.expanded-editor > :deep(.entry-loading) {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expanded-editor > :deep(textarea.entry-content) {
  height: auto;
  flex: 1;
  min-height: 320px;
  max-width: 780px;
  align-self: center;
  width: 100%;
  font-size: 15.5px;
  line-height: 2;
  background: #fffdf8;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.06);
}

.expanded-editor > :deep(.entry-title-input) {
  max-width: 780px;
  align-self: center;
  font-size: 24px;
}

.expanded-editor > :deep(.entry-head),
.expanded-editor > :deep(.entry-actions) {
  max-width: 780px;
  width: 100%;
  align-self: center;
}

.expanded-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #b6b0a1;
}

@media (max-width: 760px) {
  .expanded-sidebar {
    width: 42vw;
  }

  .expanded-editor {
    padding: 12px;
  }
}
</style>
