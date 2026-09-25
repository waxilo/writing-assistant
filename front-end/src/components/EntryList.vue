<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import type { Entry, EntryType } from "../types/writer";
import { ENTRY_TYPE_LABELS } from "../types/writer";
import LoadingIndicator from "./LoadingIndicator.vue";

/**
 * 设定条目列表（类型 tabs + 列表），普通窄面板与全屏铺开共用。
 * 多根节点（fragment），由父容器承担 flex 布局。
 *
 * 拖拽排序：鼠标按住条目拖动超过阈值后进入拖拽（防止与点击选择误触），
 * 松手时通过 reorder 事件通知父组件持久化。拖拽期间在 window 上监听
 * pointermove/pointerup（不依赖 pointer capture），指针移出列表也能收尾。
 */
const props = defineProps<{
  filter: EntryType;
  entries: Entry[];
  loading: boolean;
  editingId: number | null;
}>();

const emit = defineEmits<{
  (e: "update:filter", type: EntryType): void;
  (e: "select", id: number): void;
  (e: "reorder", ids: number[]): void;
}>();

/** 拖动最小距离（px）：超过才视为拖拽，防止点击误触。 */
const DRAG_THRESHOLD = 6;

/** 正在拖拽的条目 id（视觉高亮）。 */
const draggingId = ref<number | null>(null);
/** 目标插入位置（最终数组下标，0..len）。 */
const dropIndex = ref<number | null>(null);

let drag: {
  id: number;
  from: number;
  startX: number;
  startY: number;
  active: boolean;
  listEl: HTMLElement | null;
} | null = null;
/** 拖拽刚结束：抑制随后派发的 click，避免误选中条目。 */
let suppressClick = false;

function onPointerDown(e: PointerEvent, entry: Entry, index: number): void {
  // 仅鼠标/触控笔启用拖拽（触屏保留点击与滚动）。
  if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
  const el = e.currentTarget as HTMLElement;
  drag = {
    id: entry.id,
    from: index,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    listEl: el.closest(".settings-list") as HTMLElement | null,
  };
  // 尽力捕获（某些环境不支持时 window 监听兜底）。
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e: PointerEvent): void {
  if (!drag || !drag.listEl) return;

  // 达到阈值才进入拖拽。
  if (!drag.active) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.active = true;
    draggingId.value = drag.id;
  }

  const listEl = drag.listEl;
  // 边缘自动滚动。
  const rect = listEl.getBoundingClientRect();
  const EDGE = 36;
  if (e.clientY < rect.top + EDGE) listEl.scrollTop -= 8;
  else if (e.clientY > rect.bottom - EDGE) listEl.scrollTop += 8;

  // 目标位置：落在某条目前半 → 插到它前面；否则末尾。
  const items = [...listEl.querySelectorAll<HTMLElement>(".settings-item")];
  let target = items.length;
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      target = i;
      break;
    }
  }
  // 移除自身后的最终插入位置。
  let drop = target > drag.from ? target - 1 : target;
  if (drop > items.length - 1) drop = items.length - 1;
  dropIndex.value = drop;
}

function onPointerUp(): void {
  if (!drag) return;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  endDrag();
}

function endDrag(): void {
  if (!drag) return;
  const { active, from } = drag;
  const to = dropIndex.value;
  drag = null;
  draggingId.value = null;
  dropIndex.value = null;
  if (!active) return; // 未超过阈值：视为普通点击
  // 抑制本次拖拽后的 click；若指针在列表外松开 click 不派发，兜底自动恢复。
  suppressClick = true;
  setTimeout(() => {
    suppressClick = false;
  }, 100);
  if (to !== null && to !== from) {
    // 直接传 id 序列（而非索引），父组件按 id 定位，拖拽期间列表刷新也不易错位。
    const next = [...props.entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emit("reorder", next.map((e) => e.id));
  }
}

function onClickEntry(id: number): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  emit("select", id);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  drag = null;
});
</script>

<template>
  <div class="settings-tabs">
    <button
      v-for="tab in (['character', 'location', 'concept'] as const)"
      :key="tab"
      class="settings-tab"
      :class="{ active: filter === tab }"
      @click="emit('update:filter', tab)"
    >
      {{ ENTRY_TYPE_LABELS[tab] }}
    </button>
  </div>

  <div class="settings-list-head">
    <span class="settings-label">{{ ENTRY_TYPE_LABELS[filter] }}</span>
    <div v-if="$slots.headActions" class="settings-head-actions">
      <slot name="headActions" />
    </div>
  </div>

  <div v-if="loading" class="settings-loading">
    <LoadingIndicator text="加载中" />
  </div>
  <p v-else-if="entries.length === 0" class="settings-empty">
    还没有条目，点击右上角 + 新建
  </p>
  <nav v-else class="settings-list">
    <template v-for="(entry, i) in entries" :key="entry.id">
      <div v-if="draggingId !== null && dropIndex === i" class="drop-line"></div>
      <button
        class="settings-item"
        :class="{ active: editingId === entry.id, dragging: draggingId === entry.id }"
        @pointerdown="onPointerDown($event, entry, i)"
        @click="onClickEntry(entry.id)"
      >
        <span class="settings-type" :class="entry.type">{{
          ENTRY_TYPE_LABELS[entry.type]
        }}</span>
        <span class="settings-title">{{ entry.title || "未命名条目" }}</span>
      </button>
    </template>
    <div v-if="draggingId !== null && dropIndex === entries.length" class="drop-line"></div>
  </nav>
</template>

<style scoped>
.settings-tabs {
  display: flex;
  gap: 2px;
  padding: 12px 10px 6px;
}

.settings-tab {
  flex: 1;
  padding: 5px 0;
  font-size: 12px;
  color: #8a8577;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.settings-tab:hover {
  background: #f0eee7;
  color: #444;
}

.settings-tab.active {
  background: #fff;
  color: #444;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.settings-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
}

.settings-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.settings-label {
  font-size: 12.5px;
  font-weight: 600;
  color: #8a8577;
}

.settings-loading {
  padding: 18px 14px;
  display: flex;
  justify-content: center;
}

.settings-empty {
  margin: 10px 14px;
  font-size: 12px;
  color: #b6b0a1;
}

.settings-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px 12px;
}

.drop-line {
  flex-shrink: 0;
  height: 2px;
  margin: 1px 6px 3px;
  border-radius: 2px;
  background: #4f6ef7;
  pointer-events: none;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  text-align: left;
  color: #4a4a44;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.14s ease;
  user-select: none;
  -webkit-user-select: none;
}

.settings-item:hover {
  background: rgba(255, 255, 255, 0.62);
}

.settings-item.active {
  background: #f0ede5;
  color: #333;
}

.settings-item.dragging {
  opacity: 0.55;
  background: #e8e4f7;
  cursor: grabbing;
}

.settings-type {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10.5px;
  border-radius: 999px;
}

.settings-type.character {
  color: #b0524a;
  background: rgba(196, 93, 85, 0.12);
}

.settings-type.location {
  color: #3e6f9c;
  background: rgba(79, 110, 247, 0.1);
}

.settings-type.concept {
  color: #6b7d3a;
  background: rgba(122, 148, 60, 0.12);
}

.settings-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
