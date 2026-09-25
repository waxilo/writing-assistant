<script setup lang="ts">
import { ref, watch } from "vue";
import type { useChapters } from "../composables/useChapters";
import type { OutlineHeading } from "../types/chapter";

/**
 * 章内大纲（左侧「索引」tab）：解析当前章节内容中行首 `#` 标记的标题，
 * 按层级缩进展示，点击定位到编辑器对应位置；滚动时高亮当前所在标题。
 */
const props = defineProps<{
  chapters: ReturnType<typeof useChapters>;
  /** 当前处于视口顶部的标题序号（-1 无），由父组件滚动监听驱动。 */
  activeIndex?: number;
}>();

const emit = defineEmits<{ (e: "jump", index: number): void }>();

const headings = ref<OutlineHeading[]>([]);
let parseTimer: ReturnType<typeof setTimeout> | null = null;

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

function parseHeadings(content: string): OutlineHeading[] {
  const result: OutlineHeading[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(HEADING_PATTERN);
    if (match) {
      result.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return result;
}

// 防抖解析：打字时不阻塞，停顿后更新大纲。
watch(
  () => props.chapters.current.value?.content,
  () => {
    if (parseTimer !== null) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      headings.value = parseHeadings(
        props.chapters.current.value?.content ?? ""
      );
    }, 150);
  }
);

// 章节切换时立即解析。
watch(
  () => props.chapters.current.value?.id,
  () => {
    if (parseTimer !== null) clearTimeout(parseTimer);
    headings.value = parseHeadings(
      props.chapters.current.value?.content ?? ""
    );
  },
  { immediate: true }
);

function onJump(index: number): void {
  emit("jump", index);
}

const outlineBodyRef = ref<HTMLElement | null>(null);

// 当前激活标题变化时，让大纲列表滚动到该项可见。
watch(
  () => props.activeIndex,
  (index) => {
    if (typeof index !== "number" || index < 0) return;
    const body = outlineBodyRef.value;
    if (!body) return;
    const item = body.querySelector<HTMLElement>(
      `.outline-item[data-idx="${index}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }
);
</script>

<template>
  <div class="outline">
    <div class="outline-head">
      <span>章内导航</span>
      <span v-if="headings.length > 0" class="outline-count">{{
        headings.length
      }}</span>
    </div>

    <div ref="outlineBodyRef" v-if="headings.length > 0" class="outline-body">
      <button
        v-for="(heading, index) in headings"
        :key="index"
        class="outline-item"
        :class="[
          `lv-${Math.min(heading.level, 6)}`,
          { active: index === activeIndex },
        ]"
        :data-idx="index"
        :title="heading.text"
        @click="onJump(index)"
      >
        <span class="outline-marker">{{ "#".repeat(heading.level) }}</span>
        <span class="outline-text">{{ heading.text }}</span>
      </button>
    </div>

    <div v-else class="outline-empty">
      <p>本段还没有标题</p>
      <p class="outline-hint">
        在行首输入 <code># 空格</code> 创建一级标题，<code>##</code>
        二级、<code>###</code> 三级…
      </p>
    </div>
  </div>
</template>

<style scoped>
.outline {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
}

.outline-head {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #8a8577;
}

.outline-count {
  font-size: 11px;
  font-weight: 500;
  color: #b6b0a1;
  font-variant-numeric: tabular-nums;
}

.outline-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.outline-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  font-size: 12.5px;
  line-height: 1.45;
  text-align: left;
  color: #555;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.outline-item:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #222;
}

.outline-item.active {
  background: #e8edfb;
  color: #2b4bcf;
  font-weight: 600;
}

.outline-item.lv-1 {
  font-weight: 600;
  color: #3a3a3a;
}

.outline-item.lv-2 {
  padding-left: 18px;
}

.outline-item.lv-3 {
  padding-left: 30px;
  font-size: 12px;
}

.outline-item.lv-4 {
  padding-left: 42px;
  font-size: 12px;
  color: #777;
}

.outline-item.lv-5,
.outline-item.lv-6 {
  padding-left: 54px;
  font-size: 11.5px;
  color: #888;
}

.outline-marker {
  flex-shrink: 0;
  font-size: 10px;
  color: #c9c2b2;
  font-variant-numeric: tabular-nums;
}

.outline-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-empty {
  padding: 16px 14px;
  text-align: center;
}

.outline-empty p {
  margin: 0 0 6px;
  font-size: 12px;
  color: #b6b0a1;
}

.outline-hint {
  line-height: 1.7;
  color: #c5bfb0 !important;
}

.outline-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
}
</style>
