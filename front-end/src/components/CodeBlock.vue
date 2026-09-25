<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";

/**
 * 代码块：等宽深色展示 + 一键复制。命令/配置自动换行完整可见，
 * 复制按钮复制原始文本（不受显示换行影响）。
 */
const props = withDefaults(
  defineProps<{
    code: string;
    /** 单行命令样式（蓝色加粗），默认 false */
    single?: boolean;
  }>(),
  { single: false }
);

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

onBeforeUnmount(() => {
  if (resetTimer !== null) clearTimeout(resetTimer);
});

async function copy(): Promise<void> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(props.code);
    ok = true;
  } catch {
    // 降级：隐藏 textarea 选中复制（兼容非安全上下文/旧 webview）。
    const textarea = document.createElement("textarea");
    textarea.value = props.code;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
  }
  if (ok) {
    copied.value = true;
    if (resetTimer !== null) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  }
}
</script>

<template>
  <div class="code-block">
    <button class="copy-btn" :class="{ copied }" type="button" @click="copy">
      {{ copied ? "✓ 已复制" : "复制" }}
    </button>
    <pre class="code" :class="{ single }">{{ code }}</pre>
  </div>
</template>

<style scoped>
.code-block {
  position: relative;
  margin: 6px 0;
  border-radius: 10px;
  background: #23262e;
}

.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  padding: 3px 10px;
  font-size: 11px;
  line-height: 1.6;
  color: #9aa3b2;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.code-block:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}

.copy-btn.copied {
  color: #9ee6a8;
  border-color: rgba(120, 200, 130, 0.4);
}

.code {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: #dbe2ee;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

.code.single {
  color: #b9c8f5;
  font-weight: 600;
}
</style>
