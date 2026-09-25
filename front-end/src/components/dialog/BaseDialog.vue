<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from "vue";

/**
 * 所有弹窗的基础组件：统一遮罩、毛玻璃、居中、开合动画、ESC / 点击遮罩关闭。
 * 打开时把焦点移入弹窗并做焦点圈定（focus trap），关闭后还原焦点。
 */
const props = withDefaults(
  defineProps<{
    /** 是否可见 */
    visible: boolean;
    /** 点击遮罩是否关闭，默认 true */
    closeOnMask?: boolean;
    /** 按 ESC 是否关闭，默认 true */
    closeOnEsc?: boolean;
    /** 面板宽度（px），默认 420；小屏自动收缩。 */
    panelWidth?: number;
  }>(),
  {
    closeOnMask: true,
    closeOnEsc: true,
  }
);

const emit = defineEmits<{ (e: "close"): void }>();

const panelRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === "Escape" && props.closeOnEsc) {
    e.stopPropagation();
    emit("close");
    return;
  }
  // Focus trap: Tab cycles inside the panel, never escapes to the page.
  if (e.key === "Tab" && panelRef.value) {
    const focusables = focusableElements(panelRef.value);
    if (focusables.length === 0) {
      e.preventDefault();
      panelRef.value.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === panelRef.value)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function onMaskClick() {
  if (props.closeOnMask) emit("close");
}

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      const first = panelRef.value
        ? focusableElements(panelRef.value)[0]
        : undefined;
      (first ?? panelRef.value)?.focus();
    } else if (previouslyFocused) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  }
);

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-mask" @click.self="onMaskClick">
        <div
          ref="panelRef"
          class="dialog-panel"
          :style="panelWidth ? { '--panel-width': `${panelWidth}px` } : undefined"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.dialog-panel {
  width: var(--panel-width, 420px);
  max-width: min(var(--panel-width, 480px), calc(100vw - 40px));
  padding: 28px;
  background: #fffdf8;
  border-radius: 16px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.12);
}

/* ---- 开合动画：遮罩淡入，面板 scale(.96)->scale(1)，180ms ---- */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 180ms ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-active .dialog-panel,
.dialog-leave-active .dialog-panel {
  transition: transform 180ms ease;
}

.dialog-enter-from .dialog-panel,
.dialog-leave-to .dialog-panel {
  transform: scale(0.96);
}
</style>
