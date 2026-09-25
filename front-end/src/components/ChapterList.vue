<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch, computed } from "vue";
import type { ChapterSummary } from "../types/chapter";
import type { Volume } from "../types/writer";
import { formatCount } from "../utils/textStats";
import LoadingIndicator from "./LoadingIndicator.vue";

const MOBILE_BREAKPOINT = "(max-width: 760px)";
const CONTEXT_MENU_WIDTH = 168;
const CONTEXT_MENU_HEIGHT = 236;
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 10;

const props = defineProps<{
  chapters: ChapterSummary[];
  volumes: Volume[];
  currentId: number | null;
  currentWordCount: number;
  loading: boolean;
  /** 章节级操作（打开/新建）进行中，显示等待覆盖层。 */
  busy?: boolean;
}>();
const emit = defineEmits<{
  (e: "select", id: number): void;
  (e: "create"): void;
  (e: "create-volume"): void;
  (e: "rename-volume", id: number, title: string): void;
  (e: "delete-volume", id: number): void;
  (e: "move-chapter", id: number, volumeId: number | null): void;
  (e: "remove", id: number): void;
  (e: "rename", id: number, title: string): void;
  (e: "duplicate", id: number): void;
  (e: "history", id: number): void;
  (e: "reorder", ids: number[]): void;
}>();

// Local, reorderable copy of the list. Kept in sync with the prop except while
// a drag is in progress (so the live reorder isn't clobbered by a re-render).
const items = ref<ChapterSummary[]>([...props.chapters]);
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);
const mobileQuery = window.matchMedia(MOBILE_BREAKPOINT);
const isCollapsed = ref(false);
const editingId = ref<number | null>(null);
const editingVolumeId = ref<number | null>(null);
const titleDraft = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
const volumeTitleInput = ref<HTMLInputElement | null>(null);
const contextMenu = ref({
  isOpen: false,
  chapterId: null as number | null,
  volumeId: null as number | null,
  /** "main" | "move-volume": 章节菜单的子菜单态 */
  mode: "main" as "main" | "move-volume",
  x: 0,
  y: 0,
});
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const suppressNextClick = ref(false);
let longPressStart: { x: number; y: number; chapterId: number } | null = null;

/**
 * Group the flat chapter list by volume for display. Ungrouped chapters form
 * the first group. Ordering within a group follows the global sort order.
 */
const groupedItems = computed(() => {
  const groups: {
    key: string;
    volume: Volume | null;
    /** 未分卷组的显示标签（有卷时才显示）。 */
    label: string | null;
    items: ChapterSummary[];
  }[] = [];
  const ungrouped: ChapterSummary[] = [];
  const byVolume = new Map<number, ChapterSummary[]>();
  for (const chapter of items.value) {
    if (chapter.volumeId === null || chapter.volumeId === undefined) {
      ungrouped.push(chapter);
    } else {
      const list = byVolume.get(chapter.volumeId) ?? [];
      list.push(chapter);
      byVolume.set(chapter.volumeId, list);
    }
  }
  if (ungrouped.length > 0) {
    groups.push({
      key: "ungrouped",
      volume: null,
      label: props.volumes.length > 0 ? "未分卷" : null,
      items: ungrouped,
    });
  }
  for (const volume of props.volumes) {
    // Empty volumes stay visible (otherwise a new volume is invisible until
    // a chapter is moved into it).
    groups.push({
      key: `v${volume.id}`,
      volume,
      label: null,
      items: byVolume.get(volume.id) ?? [],
    });
  }
  return groups;
});

/** 分组内 (groupIndex, index) → 扁平 items 索引（拖拽/高亮用）。 */
function flatIndex(groupIndex: number, index: number): number {
  let offset = 0;
  for (let g = 0; g < groupIndex; g++) {
    offset += groupedItems.value[g].items.length;
  }
  return offset + index;
}

watch(
  () => props.chapters,
  (next) => {
    if (dragIndex.value === null) items.value = [...next];
  },
  { deep: true }
);

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index;
  overIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    // Firefox requires data to be set for dragging to start.
    e.dataTransfer.setData("text/plain", String(index));
  }
}

function onDragOver(index: number, e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const from = dragIndex.value;
  if (from === null || from === index) {
    overIndex.value = index;
    return;
  }
  // Live-move the dragged item so the reorder is visible during the drag.
  const list = items.value;
  const [moved] = list.splice(from, 1);
  list.splice(index, 0, moved);
  dragIndex.value = index;
  overIndex.value = index;
}

function onDrop() {
  finishDrag();
}

function onDragEnd() {
  finishDrag();
}

function onSelect(id: number) {
  if (suppressNextClick.value) {
    suppressNextClick.value = false;
    return;
  }
  if (editingId.value === id) return;
  emit("select", id);
  if (mobileQuery.matches) isCollapsed.value = true;
}

function clearLongPressTimer(): void {
  if (longPressTimer.value !== null) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
  longPressStart = null;
}

function openMenuAt(
  chapter: ChapterSummary,
  clientX: number,
  clientY: number
): void {
  editingId.value = null;
  contextMenu.value = {
    isOpen: true,
    chapterId: chapter.id,
    volumeId: null,
    mode: "main",
    x: Math.max(
      8,
      Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8)
    ),
    y: Math.max(
      8,
      Math.min(clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8)
    ),
  };
}

/** 打开卷的右键菜单。 */
function openVolumeMenu(volume: Volume, event: MouseEvent): void {
  editingVolumeId.value = null;
  contextMenu.value = {
    isOpen: true,
    chapterId: null,
    volumeId: volume.id,
    mode: "main",
    x: Math.max(
      8,
      Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8)
    ),
    y: Math.max(
      8,
      Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8)
    ),
  };
}

function onItemTouchStart(chapter: ChapterSummary, event: TouchEvent): void {
  if (editingId.value === chapter.id) return;
  const touch = event.touches[0];
  if (!touch) return;

  clearLongPressTimer();
  longPressStart = {
    x: touch.clientX,
    y: touch.clientY,
    chapterId: chapter.id,
  };

  longPressTimer.value = setTimeout(() => {
    longPressTimer.value = null;
    const start = longPressStart;
    longPressStart = null;
    if (!start || start.chapterId !== chapter.id) return;

    suppressNextClick.value = true;
    openMenuAt(chapter, start.x, start.y);
  }, LONG_PRESS_MS);
}

function onItemTouchMove(event: TouchEvent): void {
  if (!longPressStart) return;
  const touch = event.touches[0];
  if (!touch) return;

  const movedX = Math.abs(touch.clientX - longPressStart.x);
  const movedY = Math.abs(touch.clientY - longPressStart.y);
  if (movedX > LONG_PRESS_MOVE_PX || movedY > LONG_PRESS_MOVE_PX) {
    clearLongPressTimer();
  }
}

function onItemTouchEnd(): void {
  clearLongPressTimer();
}

function getWordCount(chapter: ChapterSummary): number {
  return chapter.id === props.currentId
    ? props.currentWordCount
    : chapter.wordCount ?? 0;
}

function startRename(chapter: ChapterSummary): void {
  closeContextMenu();
  editingId.value = chapter.id;
  titleDraft.value = chapter.title;
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
}

function commitRename(): void {
  const id = editingId.value;
  if (id === null) return;
  const chapter = items.value.find((item) => item.id === id);
  const title = titleDraft.value.trim() || "未命名章节";
  editingId.value = null;
  if (chapter && chapter.title !== title) emit("rename", id, title);
}

function cancelRename(): void {
  editingId.value = null;
  titleDraft.value = "";
}

function openContextMenu(chapter: ChapterSummary, event: MouseEvent): void {
  openMenuAt(chapter, event.clientX, event.clientY);
}

function closeContextMenu(): void {
  contextMenu.value.isOpen = false;
  contextMenu.value.chapterId = null;
  contextMenu.value.volumeId = null;
}

// --- volume operations -------------------------------------------------------

function startRenameVolume(volume: Volume): void {
  closeContextMenu();
  editingVolumeId.value = volume.id;
  titleDraft.value = volume.title;
  void nextTick(() => {
    volumeTitleInput.value?.focus();
    volumeTitleInput.value?.select();
  });
}

function commitVolumeRename(): void {
  const id = editingVolumeId.value;
  if (id === null) return;
  const volume = props.volumes.find((v) => v.id === id);
  const title = titleDraft.value.trim() || "新卷";
  editingVolumeId.value = null;
  if (volume && volume.title !== title) emit("rename-volume", id, title);
}

function renameVolumeFromMenu(): void {
  const volume = props.volumes.find((v) => v.id === contextMenu.value.volumeId);
  if (volume) startRenameVolume(volume);
}

function deleteVolumeFromMenu(): void {
  const id = contextMenu.value.volumeId;
  closeContextMenu();
  if (id !== null) emit("delete-volume", id);
}

/** 章节菜单 → "移动到卷" 子菜单。 */
function openMoveVolumeMenu(): void {
  contextMenu.value.mode = "move-volume";
}

function moveChapterToVolume(volumeId: number | null): void {
  const id = contextMenu.value.chapterId;
  closeContextMenu();
  if (id !== null) emit("move-chapter", id, volumeId);
}

function historyFromMenu(): void {
  const id = contextMenu.value.chapterId;
  closeContextMenu();
  if (id !== null) emit("history", id);
}

function renameFromMenu(): void {
  const chapter = items.value.find(
    (item) => item.id === contextMenu.value.chapterId
  );
  if (chapter) startRename(chapter);
}

function duplicateFromMenu(): void {
  const id = contextMenu.value.chapterId;
  closeContextMenu();
  if (id !== null) emit("duplicate", id);
}

/** Index of the chapter the context menu is open for (-1 when closed). */
const contextChapterIndex = computed(() => {
  const id = contextMenu.value.chapterId;
  if (id === null) return -1;
  return items.value.findIndex((c) => c.id === id);
});

/** Volume of the chapter the menu is open for (marks the current volume). */
const chapterVolumeId = computed(() => {
  const id = contextMenu.value.chapterId;
  if (id === null) return null;
  return items.value.find((c) => c.id === id)?.volumeId ?? null;
});

/**
 * Move the context-menu chapter up/down one slot. Works on touch devices too
 * (the long-press menu), where HTML5 drag & drop is unavailable.
 */
function moveChapter(direction: -1 | 1): void {
  const index = contextChapterIndex.value;
  if (index < 0) return;
  const target = index + direction;
  if (target < 0 || target >= items.value.length) return;

  const list = items.value;
  const [moved] = list.splice(index, 1);
  list.splice(target, 0, moved);
  closeContextMenu();
  emit("reorder", list.map((c) => c.id));
}

function removeFromMenu(): void {
  const id = contextMenu.value.chapterId;
  closeContextMenu();
  if (id !== null) emit("remove", id);
}

function onViewportChange(): void {
  // Keep the user's open/closed preference across breakpoints.
  // Mobile should also start expanded when entering a book.
  closeContextMenu();
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (editingId.value !== null) cancelRename();
  closeContextMenu();
}

onMounted(() => {
  mobileQuery.addEventListener("change", onViewportChange);
  window.addEventListener("keydown", onEscape);
});

onUnmounted(() => {
  mobileQuery.removeEventListener("change", onViewportChange);
  window.removeEventListener("keydown", onEscape);
  clearLongPressTimer();
});

function finishDrag() {
  if (dragIndex.value === null) return;
  dragIndex.value = null;
  overIndex.value = null;
  const orderedIds = items.value.map((c) => c.id);
  const original = props.chapters.map((c) => c.id);
  // Only notify if the order actually changed.
  if (orderedIds.join(",") !== original.join(",")) {
    emit("reorder", orderedIds);
  }
}
</script>

<template>
  <button
    v-if="!isCollapsed"
    class="sidebar-backdrop"
    aria-label="关闭章节栏"
    @click="isCollapsed = true"
  ></button>

  <aside class="sidebar" :class="{ collapsed: isCollapsed }">
    <div class="head">
      <span v-if="!isCollapsed" class="label">章节</span>
      <div class="head-actions">
        <button
          v-if="!isCollapsed"
          class="add"
          title="新建卷"
          aria-label="新建卷"
          @click="emit('create-volume')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M4 7V5a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v2"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          v-if="!isCollapsed"
          class="add"
          title="新建章节"
          aria-label="新建章节"
          @click="emit('create')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          class="collapse"
          :title="isCollapsed ? '展开章节栏' : '收起章节栏'"
          :aria-label="isCollapsed ? '展开章节栏' : '收起章节栏'"
          :aria-expanded="!isCollapsed"
          @click="isCollapsed = !isCollapsed"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <p
      v-if="!isCollapsed && !loading && items.length === 0 && volumes.length === 0"
      class="empty"
    >
      还没有章节，点击右上角 + 新建
    </p>

    <nav v-if="!isCollapsed" class="items" role="list">
      <template v-for="(group, groupIndex) in groupedItems" :key="group.key">
        <!-- 卷头（含未分卷组标签） -->
        <div
          v-if="group.volume || group.label"
          class="volume-head"
          :class="{
            'editing-volume': group.volume && editingVolumeId === group.volume.id,
            ungrouped: !group.volume,
          }"
          @contextmenu.prevent="group.volume && openVolumeMenu(group.volume, $event)"
        >
          <span class="volume-icon" aria-hidden="true">▤</span>
          <input
            v-if="group.volume && editingVolumeId === group.volume.id"
            ref="volumeTitleInput"
            v-model="titleDraft"
            class="name-input"
            aria-label="卷名"
            @click.stop
            @keydown.enter.prevent="commitVolumeRename"
            @keydown.esc.prevent="editingVolumeId = null"
            @blur="commitVolumeRename"
          />
          <template v-else>
            <span
              v-if="group.volume"
              class="volume-title"
              @dblclick.stop="startRenameVolume(group.volume)"
              >{{ group.volume.title }}</span
            >
            <span v-else class="volume-title">{{ group.label }}</span>
            <span class="volume-count">{{ group.items.length }}</span>
          </template>
        </div>

        <div
          v-for="(ch, index) in group.items"
          :key="ch.id"
          class="item"
          :class="{
            active: ch.id === currentId,
            dragging: dragIndex === flatIndex(groupIndex, index),
            editing: editingId === ch.id,
          }"
          role="listitem"
          tabindex="0"
          :aria-current="ch.id === currentId ? 'true' : undefined"
          :aria-label="`章节：${ch.title || '未命名章节'}`"
          :draggable="editingId !== ch.id"
          @click="onSelect(ch.id)"
          @keydown.enter="onSelect(ch.id)"
          @keydown.space.prevent="onSelect(ch.id)"
          @contextmenu.prevent="openContextMenu(ch, $event)"
          @touchstart.passive="onItemTouchStart(ch, $event)"
          @touchmove.passive="onItemTouchMove($event)"
          @touchend="onItemTouchEnd"
          @touchcancel="onItemTouchEnd"
          @dragstart="onDragStart(flatIndex(groupIndex, index), $event)"
          @dragover="onDragOver(flatIndex(groupIndex, index), $event)"
          @drop="onDrop"
          @dragend="onDragEnd"
        >
          <span class="grip" title="拖动排序" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <circle cx="9" cy="6" r="1.4" fill="currentColor" />
              <circle cx="15" cy="6" r="1.4" fill="currentColor" />
              <circle cx="9" cy="12" r="1.4" fill="currentColor" />
              <circle cx="15" cy="12" r="1.4" fill="currentColor" />
              <circle cx="9" cy="18" r="1.4" fill="currentColor" />
              <circle cx="15" cy="18" r="1.4" fill="currentColor" />
            </svg>
          </span>
          <div class="item-copy" @dblclick.stop="startRename(ch)">
            <input
              v-if="editingId === ch.id"
              ref="titleInput"
              v-model="titleDraft"
              class="name-input"
              aria-label="章节名称"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename"
            />
            <template v-else>
              <span class="name">{{ ch.title || "未命名章节" }}</span>
              <span class="word-count">{{ formatCount(getWordCount(ch)) }} 字</span>
            </template>
          </div>
        </div>
      </template>
    </nav>

    <div v-if="!isCollapsed && (loading || busy)" class="loading">
      <LoadingIndicator />
    </div>
  </aside>

  <Teleport to="body">
    <button
      v-if="contextMenu.isOpen"
      class="context-backdrop"
      aria-label="关闭章节菜单"
      @click="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    ></button>
    <Transition name="context-menu">
      <div
        v-if="contextMenu.isOpen"
        class="context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        role="menu"
      >
        <!-- 卷菜单 -->
        <template v-if="contextMenu.volumeId !== null">
          <button class="context-item" role="menuitem" @click="renameVolumeFromMenu">
            重命名卷
          </button>
          <div class="context-separator"></div>
          <button
            class="context-item danger"
            role="menuitem"
            @click="deleteVolumeFromMenu"
          >
            删除卷
          </button>
        </template>

        <!-- 章节菜单：移动到卷子菜单 -->
        <template v-else-if="contextMenu.mode === 'move-volume'">
          <button
            class="context-item context-back"
            role="menuitem"
            @click="contextMenu.mode = 'main'"
          >
            ← 返回
          </button>
          <button class="context-item" role="menuitem" @click="moveChapterToVolume(null)">
            未分卷
          </button>
          <button
            v-for="volume in volumes"
            :key="volume.id"
            class="context-item"
            role="menuitem"
            :class="{ checked: chapterVolumeId === volume.id }"
            @click="moveChapterToVolume(volume.id)"
          >
            {{ volume.title }}
          </button>
        </template>

        <!-- 章节主菜单 -->
        <template v-else>
          <button class="context-item" role="menuitem" @click="renameFromMenu">
            重命名
          </button>
          <button class="context-item" role="menuitem" @click="duplicateFromMenu">
            复制章节
          </button>
          <button
            class="context-item"
            role="menuitem"
            :disabled="contextChapterIndex <= 0"
            @click="moveChapter(-1)"
          >
            上移
          </button>
          <button
            class="context-item"
            role="menuitem"
            :disabled="
              contextChapterIndex === -1 ||
              contextChapterIndex >= items.length - 1
            "
            @click="moveChapter(1)"
          >
            下移
          </button>
          <div class="context-separator"></div>
          <button class="context-item" role="menuitem" @click="historyFromMenu">
            版本历史
          </button>
          <button class="context-item" role="menuitem" @click="openMoveVolumeMenu">
            移动到卷 ▸
          </button>
          <div class="context-separator"></div>
          <button
            class="context-item danger"
            role="menuitem"
            @click="removeFromMenu"
          >
            删除章节
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sidebar {
  position: relative;
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #faf8f3;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  overflow-x: hidden;
  overflow-y: auto;
  transition: width 0.24s ease;
}

.sidebar.collapsed {
  width: 48px;
}

.sidebar-backdrop {
  display: none;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.15rem 1.15rem 0.7rem;
}

.collapsed .head {
  justify-content: center;
  padding: 1.15rem 0 0.7rem;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #8a8577;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.add:hover {
  background: #f0efea;
  color: #444;
}

.add:active {
  transform: scale(0.9);
}

.collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #8a8577;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.24s ease;
}

.collapse:hover {
  color: #444;
  background: #f0efea;
}

.collapsed .collapse {
  transform: rotate(180deg);
}

.empty {
  margin: 0.5rem 1.1rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: #b6b0a1;
}

/* ---- volume groups ---- */
.volume-head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 10px;
  padding: 5px 10px 4px;
  font-size: 12px;
  font-weight: 600;
  color: #8a8577;
  letter-spacing: 0.03em;
  user-select: none;
  cursor: context-menu;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.volume-head:hover {
  background: rgba(0, 0, 0, 0.04);
}

.volume-head.ungrouped {
  color: #b0aa9b;
  font-weight: 500;
}

.volume-icon {
  font-size: 11px;
  color: #c0baab;
}

.volume-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: context-menu;
}

.volume-count {
  font-size: 11px;
  font-weight: 500;
  color: #b6b0a1;
  font-variant-numeric: tabular-nums;
}

.volume-head .name-input {
  font-size: 12px;
  font-weight: 600;
  color: #8a8577;
}

.context-item.context-back {
  color: #8a8577;
}

.context-item.checked::after {
  content: "✓";
  margin-left: auto;
  color: #4f6ef7;
  font-size: 12px;
}

.items {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0.25rem 0.6rem 1rem;
}

.item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  height: 56px;
  padding: 0 0.6rem;
  text-align: left;
  color: #4a4a44;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease,
    box-shadow 0.2s ease, opacity 0.2s ease;
}

.item:hover {
  background: rgba(255, 255, 255, 0.62);
}

.item.active {
  background: #f0ede5;
  color: #333;
}

.item.dragging {
  opacity: 0.6;
  background: #fffdf8;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  cursor: grabbing;
}

.grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  color: #cfc9ba;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.18s ease, color 0.18s ease;
}

.item:hover .grip,
.item.dragging .grip {
  opacity: 1;
}

.grip:active {
  cursor: grabbing;
}

.item-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.18s ease, transform 0.2s ease;
}

.item:hover:not(.editing) .name {
  transform: translateX(2px);
}

.word-count {
  display: block;
  font-size: 12px;
  line-height: 1.1;
  color: #999;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.2s ease;
}

.name-input {
  box-sizing: border-box;
  width: 100%;
  padding: 2px 0;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  color: #333;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(51, 51, 51, 0.16);
  border-radius: 0;
  outline: none;
  -webkit-user-select: text;
  user-select: text;
  animation: rename-in 0.16s ease both;
}

@keyframes rename-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: #b6b0a1;
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.item:hover .del {
  opacity: 1;
}

.del:hover {
  background: rgba(224, 49, 49, 0.1);
  color: #e03131;
}

.context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  padding: 0;
  background: transparent;
  border: none;
}

.context-menu {
  position: fixed;
  z-index: 91;
  width: 168px;
  box-sizing: border-box;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
}

.context-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
  color: #444;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.context-item:hover {
  background: #f5f3ee;
}

.context-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.context-item:disabled:hover {
  background: transparent;
}

.context-item.danger {
  color: #c45d55;
}

.context-item.danger:hover {
  background: rgba(196, 93, 85, 0.08);
}

.context-separator {
  height: 1px;
  margin: 4px 6px;
  background: rgba(0, 0, 0, 0.06);
}

.context-menu-enter-active,
.context-menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
  transform-origin: top left;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* ---- loading overlay (no layout shift) ---- */
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(250, 248, 243, 0.55);
  backdrop-filter: blur(1px);
}

@media (max-width: 760px) {
  .sidebar {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(82vw, 300px);
    max-width: none;
    box-shadow: 10px 0 30px rgba(0, 0, 0, 0.12);
    transition: width 0.24s ease, box-shadow 0.24s ease;
  }

  .sidebar.collapsed {
    width: 0;
    overflow: visible;
    border-right: none;
    box-shadow: none;
  }

  .collapsed .head {
    position: absolute;
    top: 12px;
    left: 12px;
    width: 36px;
    padding: 0;
  }

  .collapse {
    width: 36px;
    height: 36px;
    background: rgba(250, 248, 243, 0.94);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08);
  }

  .sidebar:not(.collapsed) .collapse {
    width: 32px;
    height: 32px;
    background: transparent;
    box-shadow: none;
  }

  .sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: 35;
    display: block;
    padding: 0;
    background: rgba(32, 30, 26, 0.18);
    border: none;
  }

  .head {
    padding: 1rem 1rem 0.7rem;
  }

  .items {
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }

  .grip,
  .del {
    opacity: 1;
  }
}
</style>
