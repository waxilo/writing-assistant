<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import type { useBooks } from "../composables/useBooks";
import BookCard from "../components/BookCard.vue";
import LoadingIndicator from "../components/LoadingIndicator.vue";
import MCPGuideDialog from "../components/MCPGuideDialog.vue";
import ChangePasswordDialog from "../components/ChangePasswordDialog.vue";
import { useConfirm } from "../composables/useConfirm";
import { showToast } from "../composables/useToast";

const confirm = useConfirm();

const props = defineProps<{
  books: ReturnType<typeof useBooks>;
  username: string;
}>();
const emit = defineEmits<{ (e: "logout"): void }>();

const { list, loading, error, creating, loadList, open, create, remove } = props.books;

const avatarText = computed(
  () => props.username?.trim().charAt(0).toUpperCase() || "○"
);

onMounted(() => {
  void loadList();
  window.addEventListener("keydown", onEsc);
});

onUnmounted(() => window.removeEventListener("keydown", onEsc));

async function onCreate() {
  try {
    await create();
  } catch (e) {
    showToast(e instanceof Error ? e.message : "创建失败", "error");
  }
}

async function onRemove(id: number) {
  const ok = await confirm({
    title: "删除书籍？",
    message: "删除后将删除所有章节，\n该操作不可恢复。",
    confirmText: "删除",
  });
  if (ok) {
    try {
      await remove(id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败", "error");
    }
  }
}

// --- user menu ---------------------------------------------------------------
const menuOpen = ref(false);
const guideOpen = ref(false);
const pwdOpen = ref(false);

function onChangePassword() {
  closeMenu();
  pwdOpen.value = true;
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onLogout() {
  closeMenu();
  emit("logout");
}

function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu();
}
</script>

<template>
  <div class="shelf">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">✒</span>
        <span class="brand-name">写作助手</span>
      </div>

      <div class="bar-actions">
        <button class="mcp-entry" title="AI 接入教程" @click="guideOpen = true">
          <span class="mcp-icon">🤖</span>
          <span class="mcp-label">AI 接入</span>
        </button>

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
              <button class="menu-item danger" @click="onLogout">退出登录</button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <div v-if="menuOpen" class="menu-backdrop" @click="closeMenu"></div>

    <main class="content">
      <div class="page-head">
        <h1>我的书架</h1>
        <p class="subtitle">记录你的每一个故事</p>
      </div>

      <MCPGuideDialog v-if="guideOpen" @close="guideOpen = false" />
      <ChangePasswordDialog v-if="pwdOpen" @close="pwdOpen = false" />

      <p v-if="error" class="error">{{ error }}</p>

      <div class="grid-wrap">
        <div class="grid">
          <BookCard
            v-for="book in list"
            :key="book.id"
            :book="book"
            @open="open"
            @remove="onRemove"
          />

          <button class="add" :disabled="creating" @click="onCreate">
            <span class="plus">+</span>
            <span class="add-label">{{ creating ? "创建中…" : "新建作品" }}</span>
          </button>
        </div>

        <Transition name="fade">
          <div v-if="loading" class="loading-overlay">
            <LoadingIndicator />
          </div>
        </Transition>
      </div>

    </main>
  </div>
</template>

<style scoped>
.shelf {
  min-height: 100vh;
  background: #f5f3ee;
}

/* ---- top bar ---- */
.topbar {
  position: sticky;
  top: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  z-index: 20;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #3a3a3a;
}

.brand-mark {
  font-size: 1rem;
  color: #8a8577;
}

.brand-name {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.02em;
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
  max-width: 140px;
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
  min-width: 160px;
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

/* ---- content ---- */
.content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 3rem 2rem 4rem;
}

.page-head {
  margin-bottom: 2rem;
}

.bar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mcp-entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  font-size: 12.5px;
  font-weight: 500;
  color: #5b6a8c;
  background: rgba(79, 110, 247, 0.07);
  border: 1px solid rgba(79, 110, 247, 0.18);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.mcp-entry:hover {
  background: rgba(79, 110, 247, 0.13);
  color: #3f5de0;
}

.mcp-entry:active {
  transform: scale(0.97);
}

.mcp-icon {
  font-size: 14px;
}

h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  color: #222;
  letter-spacing: 0.01em;
}

.subtitle {
  margin: 0.4rem 0 0;
  font-size: 14px;
  color: #999;
}

.error {
  color: #e03131;
  margin: 0 0 1rem;
}

.grid-wrap {
  position: relative;
  min-height: 320px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 260px);
  gap: 24px;
  justify-content: start;
}

/* ---- new work card ---- */
.add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  width: 260px;
  height: 320px;
  background: transparent;
  border: 1px dashed #ddd;
  border-radius: 16px;
  color: #a8a293;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease,
    transform 0.2s ease;
}

.add:hover {
  background: #fffdf8;
  border-color: #ccc;
  color: #8a8577;
  transform: translateY(-4px);
}

.plus {
  font-size: 2.2rem;
  font-weight: 300;
  line-height: 1;
}

.add-label {
  font-size: 0.9rem;
}

/* ---- loading ---- */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 243, 238, 0.5);
  backdrop-filter: blur(1px);
  z-index: 2;
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

@media (max-width: 760px) {
  .mcp-label {
    display: none;
  }

  .mcp-entry {
    padding: 6px 9px;
  }

  .bar-actions {
    gap: 6px;
  }
}
</style>