<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import {
  sessionRef,
  clearSession,
  getRefreshToken,
} from "./api/tokenStore";
import {
  cancelProactiveRefresh,
  scheduleProactiveRefresh,
  onPendingChange,
} from "./api/http";
import { getMe, logout as logoutApi } from "./api/auth";
import { useBooks } from "./composables/useBooks";
import { useChapters } from "./composables/useChapters";
import { showToast } from "./composables/useToast";
import type { UserInfo } from "./types/auth";
import LoginView from "./views/LoginView.vue";
import BookshelfView from "./views/BookshelfView.vue";
import EditorView from "./views/EditorView.vue";
import ConfirmDialog from "./components/dialog/ConfirmDialog.vue";
import ToastHost from "./components/ToastHost.vue";
import TopProgress from "./components/TopProgress.vue";

const loggedIn = sessionRef();
const books = useBooks();
const chapters = useChapters();
const user = ref<UserInfo | null>(null);
/** 任一 API 请求在途（驱动全局进度条）。 */
const requestActive = ref(false);
// 订阅提前到 setup：immediate watch 触发的早期请求（getMe/token 恢复）
// 也纳入进度条显示。
onPendingChange((active) => {
  requestActive.value = active;
});

// login -> bookshelf -> editor
const view = computed<"login" | "shelf" | "editor">(() => {
  if (!loggedIn.value) return "login";
  return books.currentId.value === null ? "shelf" : "editor";
});

const displayName = computed(
  () => user.value?.nickname || user.value?.username || ""
);

// Resume background token refresh if a session survived a reload.
onMounted(() => {
  if (getRefreshToken()) scheduleProactiveRefresh();
  // Last-resort flush on window/app close so edits inside the autosave window
  // are not lost (synchronous best-effort; safe to ignore failures).
  window.addEventListener("beforeunload", flushOnUnload);
});

function flushOnUnload(): void {
  chapters.flushSync();
}

// Load the current user whenever we become logged in; clear it on logout.
watch(
  loggedIn,
  async (value) => {
    if (!value) {
      user.value = null;
      return;
    }
    try {
      user.value = await getMe();
    } catch {
      user.value = null;
    }
  },
  { immediate: true }
);

async function onLogout() {
  // Persist any unsaved chapter edits first (best effort), then drop all
  // chapter/book state so the next account starts clean.
  try {
    await chapters.flush();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "保存失败", "error");
  }
  chapters.reset();
  books.backToShelf();
  const rt = getRefreshToken();
  if (rt) {
    try {
      await logoutApi(rt);
    } catch {
      // ignore
    }
  }
  cancelProactiveRefresh();
  clearSession();
}
</script>

<template>
  <LoginView v-if="view === 'login'" />
  <BookshelfView
    v-else-if="view === 'shelf'"
    :books="books"
    :username="displayName"
    @logout="onLogout"
  />
  <EditorView
    v-else
    :books="books"
    :chapters="chapters"
    :username="displayName"
    @logout="onLogout"
  />

  <!-- 全局统一确认弹窗：整个项目共用此实例 -->
  <ConfirmDialog />
  <!-- 全局轻量提示 -->
  <ToastHost />
  <!-- 全局请求进度条 -->
  <TopProgress :active="requestActive" />
</template>

<style>
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 400;
  color: #1a1a1a;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
</style>
