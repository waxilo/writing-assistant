<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, nextTick, watch } from "vue";
import type { useBooks } from "../composables/useBooks";
import type { useChapters } from "../composables/useChapters";
import ChapterList from "../components/ChapterList.vue";
import ChapterEditor from "../components/ChapterEditor.vue";
import FindReplacePanel from "../components/FindReplacePanel.vue";
import OutlinePanel from "../components/OutlinePanel.vue";
import HistoryDialog from "../components/HistoryDialog.vue";
import SettingsPanel from "../components/SettingsPanel.vue";

import { useConfirm } from "../composables/useConfirm";
import { showToast } from "../composables/useToast";
import * as writerApi from "../api/writer";
import * as chapterApi from "../api/chapter";
import type { Volume } from "../types/writer";
import { formatCount, getTextStats } from "../utils/textStats";

const confirm = useConfirm();

const props = defineProps<{
  books: ReturnType<typeof useBooks>;
  chapters: ReturnType<typeof useChapters>;
  username: string;
}>();
const emit = defineEmits<{ (e: "logout"): void }>();

// Avatar initial for the user menu (falls back to a neutral glyph).
const avatarText = computed(() => props.username?.trim().charAt(0).toUpperCase() || "○");

const bookId = computed(() => props.books.currentId.value);
const bookTitle = computed(() => props.books.current.value?.title ?? "");

const {
  list,
  current,
  loading,
  saving,
  dirty,
  saveError,
  selecting,
  select,
  create,
  remove,
  rename,
  duplicate,
  reorder,
  flush,
} = props.chapters;

/** Save-state indicator shown in the top bar (only when a chapter is open). */
const saveStatus = computed(() => {
  if (!current.value) return null;
  if (saving.value) return { text: "保存中", cls: "saving" };
  if (saveError.value) return { text: "保存失败", cls: "error" };
  if (dirty.value) return { text: "未保存", cls: "dirty" };
  return { text: "已保存", cls: "saved" };
});

// Surface save failures (e.g. a 409 conflict from another window) as a toast.
// Only toast when the message CHANGES — autosave retries after a failure and
// would otherwise re-toast the same message every few seconds.
watch(saveError, (message, previous) => {
  if (message && message !== previous) showToast(message, "error");
});

// --- word/char stats, debounced so typing never pays full-text cost ---------
const currentStats = ref(getTextStats(current.value?.content ?? ""));
let statsTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => current.value?.content,
  () => {
    if (statsTimer !== null) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      currentStats.value = getTextStats(current.value?.content ?? "");
    }, 120);
  }
);

watch(
  () => current.value?.id,
  () => {
    // Chapter switch recomputes immediately (no need to wait for debounce).
    if (statsTimer !== null) clearTimeout(statsTimer);
    currentStats.value = getTextStats(current.value?.content ?? "");
  },
  { immediate: true }
);

const currentChapterNumber = computed(() => {
  if (!current.value) return null;
  const index = list.value.findIndex((chapter) => chapter.id === current.value?.id);
  return index < 0 ? null : index + 1;
});

const currentChapterLabel = computed(() =>
  currentChapterNumber.value === null ? "" : `第${currentChapterNumber.value}章`
);

const now = ref(Date.now());
let relativeTimeTimer: ReturnType<typeof setInterval> | null = null;

const lastSavedText = computed(() => {
  const updateTime = current.value?.updateTime;
  if (!updateTime) return "尚未保存";
  const normalized = updateTime.includes("T")
    ? updateTime
    : `${updateTime.replace(" ", "T")}Z`;
  const savedAt = new Date(normalized).getTime();
  if (Number.isNaN(savedAt)) return "已保存";

  const elapsedSeconds = Math.max(0, Math.floor((now.value - savedAt) / 1000));
  if (elapsedSeconds < 60) return "刚刚";
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(savedAt);
});

// --- book title inline rename (double-click) ---------------------------------
const editingTitle = ref(false);
const titleDraft = ref("");
const titleInput = ref<HTMLInputElement | null>(null);

function startEditTitle() {
  titleDraft.value = bookTitle.value;
  editingTitle.value = true;
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
}

async function saveTitle() {
  if (!editingTitle.value) return;
  editingTitle.value = false;
  const next = titleDraft.value.trim();
  if (bookId.value === null || !next || next === bookTitle.value) return;
  try {
    await props.books.rename(bookId.value, next);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "重命名失败", "error");
  }
}

function cancelEditTitle() {
  editingTitle.value = false;
}

// --- user menu ---------------------------------------------------------------
const menuOpen = ref(false);
const pwdOpen = ref(false);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onChangePassword() {
  closeMenu();
  pwdOpen.value = true;
}

function onLogout() {
  closeMenu();
  emit("logout");
}

// --- find & replace ----------------------------------------------------------
const findOpen = ref(false);
const editorRef = ref<InstanceType<typeof ChapterEditor> | null>(null);
const findPanelRef = ref<InstanceType<typeof FindReplacePanel> | null>(null);

function openFindPanel() {
  findOpen.value = true;
  findPanelRef.value?.focusQuery();
}

/** 面板替换本章后：编辑器 DOM 与模型已不同步，强制重载。 */
function onReloadEditor() {
  editorRef.value?.reloadFromModel();
}

/** 面板在编辑器内定位关键字。 */
function onLocate(keyword: string) {
  editorRef.value?.locate(keyword);
}

/** 面板点击全书结果：切换章节并在内容加载后定位。 */
async function onOpenAndLocate(chapterId: number, keyword: string) {
  try {
    await props.chapters.select(chapterId);
    await nextTick();
    // 章节内容写入 DOM 在 Vue 更新链之后，用宏任务确保 innerText 已就绪。
    setTimeout(() => {
      editorRef.value?.locate(keyword);
    }, 0);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "切换章节失败", "error");
  }
}

// --- left pane tabs: chapter list | in-chapter outline ----------------------
const leftTab = ref<"chapters" | "outline">("chapters");

// --- version history ----------------------------------------------------------
const historyChapterId = ref<number | null>(null);

function onChapterHistory(id: number) {
  historyChapterId.value = id;
}

/** 恢复历史版本后，重新加载当前章节内容。 */
async function onHistoryRestored(): Promise<void> {
  if (current.value === null) return;
  try {
    const fresh = await chapterApi.getChapter(current.value.id);
    props.chapters.applyServerChapter(fresh);
    editorRef.value?.reloadFromModel();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "刷新章节失败", "error");
  }
}

// --- outline (left tab) + settings (right column) ---------------------------
const SETTINGS_KEY = "writer_settings_collapsed";
const settingsCollapsed = ref(localStorage.getItem(SETTINGS_KEY) === "1");
/** 右侧设定面板实例（头部全屏按钮调用其 expand()）。 */
const settingsPanelRef = ref<InstanceType<typeof SettingsPanel> | null>(null);
const outlineActiveIndex = ref(-1);
let outlineScrollTimer: ReturnType<typeof setTimeout> | null = null;
let outlineScrollEl: HTMLElement | null = null;

function toggleSettings() {
  settingsCollapsed.value = !settingsCollapsed.value;
  localStorage.setItem(SETTINGS_KEY, settingsCollapsed.value ? "1" : "0");
}

function onOutlineScroll(): void {
  if (outlineScrollTimer !== null) clearTimeout(outlineScrollTimer);
  outlineScrollTimer = setTimeout(() => {
    outlineActiveIndex.value =
      editorRef.value?.getActiveHeadingIndex() ?? -1;
  }, 80);
}

function attachOutlineScroll(): void {
  detachOutlineScroll();
  const scrollEl = editorRef.value?.getScrollContainer() ?? null;
  if (scrollEl) {
    outlineScrollEl = scrollEl;
    scrollEl.addEventListener("scroll", onOutlineScroll, { passive: true });
  }
}

function detachOutlineScroll(): void {
  if (outlineScrollEl) {
    outlineScrollEl.removeEventListener("scroll", onOutlineScroll);
    outlineScrollEl = null;
  }
  if (outlineScrollTimer !== null) {
    clearTimeout(outlineScrollTimer);
    outlineScrollTimer = null;
  }
}

// 章节切换后重新绑定滚动监听。
watch(
  () => current.value?.id,
  () => {
    void nextTick(() => {
      attachOutlineScroll();
      outlineActiveIndex.value = editorRef.value?.getActiveHeadingIndex() ?? -1;
    });
  },
  { immediate: true }
);

function onOutlineJump(index: number) {
  editorRef.value?.locateHeading(index);
}

// --- navigation --------------------------------------------------------------
onMounted(() => {
  if (bookId.value !== null) void props.chapters.loadList(bookId.value);
  void loadVolumes();
  window.addEventListener("keydown", onGlobalKeydown);
  relativeTimeTimer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  if (relativeTimeTimer !== null) clearInterval(relativeTimeTimer);
  detachOutlineScroll();
});

function onGlobalKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd+F: open the find panel instead of the webview's native find.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openFindPanel();
    return;
  }
  if (e.key === "Escape") {
    if (findOpen.value) findOpen.value = false;
    else closeMenu();
  }
}

async function onBack() {
  try {
    await flush();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "保存失败", "error");
  }
  props.books.backToShelf();
}

function onSelect(id: number) {
  select(id).catch((error: unknown) => {
    showToast(error instanceof Error ? error.message : "加载失败", "error");
  });
}

async function onCreate() {
  try {
    if (bookId.value !== null) await create(bookId.value);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "创建失败", "error");
  }
}

// --- volumes -----------------------------------------------------------------
const volumes = ref<Volume[]>([]);

async function loadVolumes() {
  if (bookId.value === null) return;
  try {
    volumes.value = await writerApi.listVolumes(bookId.value);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "加载卷失败", "error");
  }
}

async function onCreateVolume() {
  if (bookId.value === null) return;
  try {
    await writerApi.createVolume(bookId.value);
    await loadVolumes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "新建卷失败", "error");
  }
}

async function onRenameVolume(id: number, title: string) {
  try {
    await writerApi.renameVolume(id, title);
    await loadVolumes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "重命名卷失败", "error");
  }
}

async function onDeleteVolume(id: number) {
  const ok = await confirm({
    title: "删除卷？",
    message: "卷内章节将保留（变为未分卷），卷本身删除。",
    confirmText: "删除",
  });
  if (!ok) return;
  try {
    await writerApi.deleteVolume(id);
    await loadVolumes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "删除卷失败", "error");
  }
}

async function onMoveChapter(id: number, volumeId: number | null) {
  try {
    await writerApi.moveChapterToVolume(id, volumeId);
    // 同步本地列表的 volumeId，并刷新卷计数。
    const item = list.value.find((c) => c.id === id);
    if (item) item.volumeId = volumeId;
    if (current.value?.id === id) current.value.volumeId = volumeId;
    await loadVolumes();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "移动章节失败", "error");
  }
}

async function onRemove(id: number) {
  const ok = await confirm({
    title: "删除章节？",
    message: "删除后该章节内容无法恢复。",
    confirmText: "删除",
    cancelText: "取消",
  });
  if (ok) {
    try {
      await remove(id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败", "error");
    }
  }
}

async function onRename(id: number, title: string) {
  try {
    await rename(id, title);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "重命名失败", "error");
  }
}

async function onDuplicate(id: number) {
  try {
    await duplicate(id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "复制失败", "error");
  }
}

function onReorder(ids: number[]) {
  if (bookId.value !== null) {
    reorder(bookId.value, ids).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "排序失败", "error");
    });
  }
}
</script>

<template>
  <div class="workspace">
    <header class="topbar">
      <div class="bar-left">
        <button class="back" @click="onBack">
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
          <span>书架</span>
        </button>
      </div>

      <div class="bar-center">
        <div class="title-line">
          <input
            v-if="editingTitle"
            ref="titleInput"
            v-model="titleDraft"
            class="book-title-input"
            @keyup.enter="saveTitle"
            @keyup.esc="cancelEditTitle"
            @blur="saveTitle"
          />
          <span
            v-else
            class="book-title"
            title="双击修改书名"
            @dblclick="startEditTitle"
            >{{ bookTitle }}</span
          >
        </div>
        <div v-if="current" class="writing-meta">
          <span>{{ currentChapterLabel }}</span>
          <span class="meta-separator">·</span>
          <Transition name="count" mode="out-in">
            <span :key="currentStats.wordCount" class="numeric">
              {{ formatCount(currentStats.wordCount) }} 字
            </span>
          </Transition>
          <span class="meta-separator">·</span>
          <span class="save-meta" :class="saveStatus?.cls">
            {{ saveStatus?.text }}
          </span>
        </div>
      </div>

      <div class="bar-right">
        <div class="user">
          <button
            class="user-trigger"
            :class="{ open: menuOpen }"
            @click.stop="toggleMenu"
          >
            <span class="avatar">{{ avatarText }}</span>
            <span class="uname">{{ username || "用户" }}</span>
            <svg class="chevron" viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <Transition name="menu">
            <div v-if="menuOpen" class="menu" @click.stop>
              <button class="menu-item" @click="onChangePassword">修改密码</button>
              <div class="menu-sep"></div>
              <button class="menu-item danger" @click="onLogout">
                退出登录
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <!-- click-away layer for the user menu -->
    <div v-if="menuOpen" class="menu-backdrop" @click="closeMenu"></div>

    <div class="panes">
      <aside class="left-column">
        <div class="left-tabs">
          <button
            class="left-tab"
            :class="{ active: leftTab === 'chapters' }"
            @click="leftTab = 'chapters'"
          >
            章节
          </button>
          <button
            class="left-tab"
            :class="{ active: leftTab === 'outline' }"
            @click="leftTab = 'outline'"
          >
            索引
          </button>
        </div>
        <ChapterList
          v-if="leftTab === 'chapters'"
          :chapters="list"
          :volumes="volumes"
          :current-id="current?.id ?? null"
          :current-word-count="currentStats.wordCount"
          :loading="loading"
          :busy="selecting"
          @select="onSelect"
          @create="onCreate"
          @create-volume="onCreateVolume"
          @rename-volume="onRenameVolume"
          @delete-volume="onDeleteVolume"
          @move-chapter="onMoveChapter"
          @remove="onRemove"
          @rename="onRename"
          @duplicate="onDuplicate"
          @history="onChapterHistory"
          @reorder="onReorder"
        />
        <div v-else class="left-outline">
          <OutlinePanel
            v-if="current"
            :chapters="chapters"
            :active-index="outlineActiveIndex"
            @jump="onOutlineJump"
          />
        </div>
      </aside>

      <div class="editor-column">
        <FindReplacePanel
          v-if="findOpen && bookId !== null"
          ref="findPanelRef"
          :book-id="bookId"
          :chapters="chapters"
          @reload-editor="onReloadEditor"
          @locate="onLocate"
          @open-and-locate="onOpenAndLocate"
        />
        <ChapterEditor ref="editorRef" :chapters="chapters" />
        <footer class="writing-status">
          <div v-if="current" class="status-current">
            <span>{{ currentChapterLabel }}</span>            <span>
              字数
              <Transition name="count" mode="out-in">
                <b :key="currentStats.wordCount">
                  {{ formatCount(currentStats.wordCount) }}
                </b>
              </Transition>
            </span>
            <span>
              字符
              <Transition name="count" mode="out-in">
                <b :key="currentStats.charCount">
                  {{ formatCount(currentStats.charCount) }}
                </b>
              </Transition>
            </span>
            <span>最后保存：{{ lastSavedText }}</span>
          </div>
          <div v-else class="status-current">选择章节后开始写作</div>
        </footer>
      </div>

      <aside
        class="settings-column"
        :class="{ collapsed: settingsCollapsed }"
      >
        <div class="settings-column-head">
          <span v-if="!settingsCollapsed" class="settings-column-title"
            >设定</span
          >
          <div class="settings-column-actions">
            <button
              v-if="!settingsCollapsed"
              class="settings-toggle"
              title="全屏展开设定资料库"
              aria-label="全屏展开设定资料库"
              @click="settingsPanelRef?.expand()"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button
              class="settings-toggle"
              :title="settingsCollapsed ? '展开设定资料库' : '收起设定资料库'"
              :aria-label="settingsCollapsed ? '展开设定资料库' : '收起设定资料库'"
              @click="toggleSettings"
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
        <SettingsPanel
          ref="settingsPanelRef"
          v-if="!settingsCollapsed && bookId !== null"
          :book-id="bookId"
        />
      </aside>
    </div>

    <ChangePasswordDialog v-if="pwdOpen" @close="pwdOpen = false" />
    <HistoryDialog
      v-if="historyChapterId !== null"
      :chapter-id="historyChapterId"
      @close="historyChapterId = null"
      @restored="onHistoryRestored"
    />
  </div>
</template>

<style scoped>
.workspace {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f5f3ee;
  overflow: hidden;
}

/* ---- top bar ---- */
.topbar {
  height: 64px;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  z-index: 20;
}

.bar-left {
  justify-self: start;
  min-width: 0;
}

.bar-center {
  justify-self: center;
  min-width: 0;
  max-width: 60vw;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.bar-right {
  justify-self: end;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45em 0.85em;
  font-size: 0.9rem;
  color: #555;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.back:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #222;
}

.back:active {
  transform: scale(0.97);
}

.book-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
  color: #2a2a2a;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0.25em 0.55em;
  border-radius: 8px;
  cursor: default;
  transition: background 0.2s ease;
}

.title-line {
  width: 100%;
  min-width: 0;
}

.writing-meta {
  min-height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 12px;
  line-height: 1.2;
  color: #888;
  white-space: nowrap;
}

.meta-separator {
  color: #bbb5aa;
}

.numeric,
.writing-status b {
  display: inline-block;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.save-meta.saving {
  color: #78849c;
}

.save-meta.dirty {
  color: #a48a56;
}

.save-meta.error {
  color: #c45d55;
  font-weight: 600;
}

.book-title:hover {
  background: rgba(0, 0, 0, 0.04);
}

.book-title-input {
  box-sizing: border-box;
  width: 100%;
  font-size: 18px;
  font-weight: 600;
  color: #2a2a2a;
  text-align: center;
  padding: 0.25em 0.6em;
  border: 1px solid #dcd7cb;
  border-radius: 8px;
  outline: none;
  background: #fffdf8;
  min-width: 220px;
}

/* ---- user menu ---- */
.user {
  position: relative;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.3em 0.5em 0.3em 0.35em;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  color: #555;
  transition: background 0.2s ease;
}

.user-trigger:hover,
.user-trigger.open {
  background: rgba(0, 0, 0, 0.05);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #eef1f7, #e3e8f2);
  color: #6b7a9c;
  font-size: 0.8rem;
  font-weight: 700;
}

.uname {
  font-size: 0.88rem;
  font-weight: 500;
  color: #444;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: #aaa;
  transition: transform 0.2s ease;
}

.user-trigger.open .chevron {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 168px;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 0.55em 0.7em;
  font-size: 0.88rem;
  text-align: left;
  color: #444;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.menu-item:hover {
  background: #f5f4f0;
}

.menu-item.danger {
  color: #d9645a;
}

.menu-item.danger:hover {
  background: rgba(217, 100, 90, 0.09);
}

.menu-sep {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.06);
}

.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

/* ---- transitions ---- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---- body ---- */
.panes {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.editor-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ---- left column (chapters | outline tabs) ---- */
.left-column {
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #faf8f3;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
}

.left-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 12px 0;
}

.left-tab {
  flex: 1;
  padding: 6px 0;
  font-size: 12.5px;
  color: #8a8577;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.left-tab:hover {
  background: #f0eee7;
  color: #444;
}

.left-tab.active {
  background: #fff;
  color: #444;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.left-column > :deep(.sidebar) {
  flex: 1;
  min-height: 0;
  border-right: none;
}

.left-outline {
  flex: 1;
  min-height: 0;
  display: flex;
}

.left-outline > :deep(.outline) {
  flex: 1;
  min-height: 0;
}

/* ---- right-side settings library ---- */
.settings-column {
  position: relative;
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #faf8f3;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
  transition: width 0.24s ease;
}

.settings-column.collapsed {
  width: 40px;
}

.settings-column-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 10px 0 14px;
}

.settings-column.collapsed .settings-column-head {
  justify-content: center;
  padding: 0;
}

.settings-column-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.settings-column-title {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #8a8577;
}

.settings-toggle {
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
  transition: background 0.18s ease, color 0.18s ease, transform 0.24s ease;
}

.settings-toggle:hover {
  color: #444;
  background: #f0efea;
}

.settings-column.collapsed .settings-toggle {
  transform: rotate(180deg);
}

.writing-status b {
  display: inline-block;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.save-meta.saving {
  color: #78849c;
}

.save-meta.dirty {
  color: #a48a56;
}

.save-meta.error {
  color: #c45d55;
  font-weight: 600;
}

.book-title:hover {
  background: rgba(0, 0, 0, 0.04);
}

.book-title-input {
  box-sizing: border-box;
  width: 100%;
  font-size: 18px;
  font-weight: 600;
  color: #2a2a2a;
  text-align: center;
  padding: 0.25em 0.6em;
  border: 1px solid #dcd7cb;
  border-radius: 8px;
  outline: none;
  background: #fffdf8;
  min-width: 220px;
}

/* ---- user menu ---- */
.user {
  position: relative;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.3em 0.5em 0.3em 0.35em;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  color: #555;
  transition: background 0.2s ease;
}

.user-trigger:hover,
.user-trigger.open {
  background: rgba(0, 0, 0, 0.05);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #eef1f7, #e3e8f2);
  color: #6b7a9c;
  font-size: 0.8rem;
  font-weight: 700;
}

.uname {
  font-size: 0.88rem;
  font-weight: 500;
  color: #444;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: #aaa;
  transition: transform 0.2s ease;
}

.user-trigger.open .chevron {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 168px;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 0.55em 0.7em;
  font-size: 0.88rem;
  text-align: left;
  color: #444;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.menu-item:hover {
  background: #f5f4f0;
}

.menu-item.danger {
  color: #d9645a;
}

.menu-item.danger:hover {
  background: rgba(217, 100, 90, 0.09);
}

.menu-sep {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.06);
}

.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

/* ---- transitions ---- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---- body ---- */
.panes {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.editor-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ---- right-side chapter outline ---- */
.outline-column {
  position: relative;
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #faf8f3;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
  transition: width 0.24s ease;
}

.outline-column.collapsed {
  width: 40px;
}

.outline-toggle {
  position: absolute;
  top: 10px;
  left: 8px;
  z-index: 5;
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
  transition: background 0.18s ease, color 0.18s ease, transform 0.24s ease;
}

.outline-toggle:hover {
  color: #444;
  background: #f0efea;
}

.outline-column.collapsed .outline-toggle {
  transform: rotate(180deg);
}

.writing-status b {
  display: inline-block;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.save-meta.saving {
  color: #78849c;
}

.save-meta.dirty {
  color: #a48a56;
}

.save-meta.error {
  color: #c45d55;
  font-weight: 600;
}

.book-title:hover {
  background: rgba(0, 0, 0, 0.04);
}

.book-title-input {
  box-sizing: border-box;
  width: 100%;
  font-size: 18px;
  font-weight: 600;
  color: #2a2a2a;
  text-align: center;
  padding: 0.25em 0.6em;
  border: 1px solid #dcd7cb;
  border-radius: 8px;
  outline: none;
  background: #fffdf8;
  min-width: 220px;
}

/* ---- user menu ---- */
.user {
  position: relative;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.3em 0.5em 0.3em 0.35em;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  color: #555;
  transition: background 0.2s ease;
}

.user-trigger:hover,
.user-trigger.open {
  background: rgba(0, 0, 0, 0.05);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #eef1f7, #e3e8f2);
  color: #6b7a9c;
  font-size: 0.8rem;
  font-weight: 700;
}

.uname {
  font-size: 0.88rem;
  font-weight: 500;
  color: #444;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: #aaa;
  transition: transform 0.2s ease;
}

.user-trigger.open .chevron {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 168px;
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 0.55em 0.7em;
  font-size: 0.88rem;
  text-align: left;
  color: #444;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.menu-item:hover {
  background: #f5f4f0;
}

.menu-item.danger {
  color: #d9645a;
}

.menu-item.danger:hover {
  background: rgba(217, 100, 90, 0.09);
}

.menu-sep {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.06);
}

.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

/* ---- transitions ---- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---- body ---- */
.panes {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.editor-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.writing-status {
  box-sizing: border-box;
  min-height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 22px;
  color: #999;
  background: rgba(245, 243, 238, 0.92);
  border-top: 1px solid rgba(0, 0, 0, 0.035);
  font-size: 12px;
  line-height: 1;
}

.status-current {
  display: flex;
  align-items: center;
  gap: 18px;
  white-space: nowrap;
}

.count-enter-active,
.count-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.count-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.count-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (max-width: 760px) {
  .topbar {
    height: 56px;
    grid-template-columns: 44px minmax(0, 1fr) 52px;
    padding: 0 8px;
  }

  .bar-center {
    width: 100%;
    max-width: none;
  }

  .bar-right {
    gap: 0;
  }

  .back {
    width: 40px;
    height: 40px;
    justify-content: center;
    padding: 0;
  }

  .back span,
  .uname,
  .chevron {
    display: none;
  }

  .book-title {
    max-width: 100%;
    padding-inline: 0.35em;
    font-size: 16px;
    text-align: center;
  }

  .writing-meta {
    gap: 3px;
    font-size: 11px;
  }

  .book-title-input {
    min-width: 0;
    font-size: 16px;
  }

  .status {
    margin-right: 6px;
  }

  .status .dot {
    width: 7px;
    height: 7px;
  }

  .user-trigger {
    padding: 4px;
  }

  .avatar {
    width: 32px;
    height: 32px;
  }

  .menu {
    position: fixed;
    top: 62px;
    right: 8px;
  }

  .writing-status {
    min-height: calc(36px + env(safe-area-inset-bottom));
    padding: 0 10px env(safe-area-inset-bottom);
    font-size: 11px;
  }

  .status-current {
    width: 100%;
    justify-content: space-between;
    gap: 6px;
  }

  .settings-column {
    display: none;
  }

  .left-column {
    width: 0;
    overflow: visible;
  }

  .left-tabs {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 41;
    display: flex;
    gap: 2px;
    padding: 2px;
    background: rgba(250, 248, 243, 0.94);
    border-radius: 8px;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08);
  }

  .left-outline {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 40;
    width: min(82vw, 300px);
    background: #faf8f3;
    box-shadow: 10px 0 30px rgba(0, 0, 0, 0.12);
  }
}

@media (max-width: 390px) {
  .status-current span:last-child {
    display: none;
  }
}
</style>
