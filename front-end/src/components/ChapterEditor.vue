<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch, nextTick } from "vue";
import type { useChapters } from "../composables/useChapters";

const props = defineProps<{ chapters: ReturnType<typeof useChapters> }>();
const { current, save, scheduleAutoSave } = props.chapters;

const editorRef = ref<HTMLElement | null>(null);

/** Indent inserted by Tab while writing. */
const TAB_INDENT = "\t";

/**
 * Commit the title on Enter (blur triggers the same flow).
 * Escape also leaves the field; a later blur keeps the typed value.
 */
function onTitleKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== "Escape") return;
  e.preventDefault();
  (e.target as HTMLInputElement).blur();
}

/** Normalize the chapter title when the title input loses focus. */
function onTitleBlur(): void {
  if (!current.value) return;
  const normalized = current.value.title.trim() || "未命名章节";
  if (normalized !== current.value.title) {
    current.value.title = normalized;
    scheduleAutoSave();
  }
}

/** Placeholder shows only when the current chapter has no content. */
const isEmpty = computed(() => !current.value?.content);

/**
 * Load the chapter text into the contenteditable ONLY when the open chapter
 * changes. We never write the DOM back during typing, so the caret stays put.
 * (Setting innerText on every render is what makes the caret jump to the
 * start.)
 *
 * The key is deliberately just the chapter id — NOT content/contentHash:
 * a successful autosave updates contentHash to the server's SHA-256 of the
 * NEW content, and if the key included it, every save would re-set
 * innerText and snap the caret back to the first line. As a second line of
 * defence, we skip the write whenever the rendered text already matches the
 * model (a no-op innerText assignment is what kills the caret).
 */
watch(
  () => current.value?.id,
  async () => {
    await nextTick();
    if (!editorRef.value) return;
    const next = current.value?.content ?? "";
    if (editorRef.value.innerText !== next) {
      editorRef.value.innerText = next;
    }
    syncHeadings();
  },
  { immediate: true }
);

// --- text serialization -----------------------------------------------------
//
// `innerText` drops empty lines at the very end of a contenteditable (a
// trailing Enter press is silently lost on save). We serialize the DOM
// manually: block elements and <br> each contribute one "\n", which preserves
// trailing blank lines. Contenteditable=plaintext-only only ever produces
// div/br/text nodes, so this mapping is exact.

const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "BR",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "SECTION",
]);

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  if (el.tagName === "BR") return "\n";
  let out = "";
  for (const child of el.childNodes) out += serializeNode(child);
  if (BLOCK_TAGS.has(el.tagName) && !out.endsWith("\n")) out += "\n";
  return out;
}

function readEditorText(el: HTMLElement): string {
  return serializeNode(el);
}

// --- methods exposed to the parent (find/replace panel) ----------------------

// --- headings (outline support) ---------------------------------------------
//
// A heading is a line starting with `#` to `######` followed by a space
// (Markdown style). We mark heading lines with classes on their <div> so the
// outline panel can jump to them and the editor can render them bigger.
// Marking only adds/removes classes — the DOM structure never changes, so the
// caret stays exactly where it is while typing.

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

/** Re-tag every line's <div> as heading/normal (called on input & reload). */
function syncHeadings(): void {
  const el = editorRef.value;
  if (!el) return;
  for (const child of el.children) {
    const div = child as HTMLElement;
    // Fast path: lines that do not start with '#' are never headings.
    const text = div.textContent ?? "";
    if (text.charCodeAt(0) !== 35 /* # */) {
      if (div.classList.contains("heading")) {
        div.classList.remove("heading");
        delete div.dataset.heading;
      }
      continue;
    }
    const match = text.match(HEADING_PATTERN);
    if (match) {
      div.classList.add("heading");
      div.dataset.heading = String(match[1].length);
    } else {
      div.classList.remove("heading");
      delete div.dataset.heading;
    }
  }
}

/**
 * Scroll the editor to the n-th heading (outline panel jump). Returns false
 * when the index is out of range. The caret is not moved.
 */
function locateHeading(index: number): boolean {
  const el = editorRef.value;
  if (!el) return false;
  const targets = el.querySelectorAll<HTMLElement>("[data-heading]");
  const target = targets[index];
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  // Brief highlight so the jump is visible.
  target.classList.add("heading-flash");
  setTimeout(() => target.classList.remove("heading-flash"), 1200);
  return true;
}

/** The scrolling container of the paper (for outline scroll-tracking). */
function getScrollContainer(): HTMLElement | null {
  return editorRef.value?.closest(".paper-scroll") ?? null;
}

/**
 * Index of the heading currently near the top of the scrollport (-1 when
 * none). Used by the outline panel to highlight the active section.
 */
function getActiveHeadingIndex(): number {
  const el = editorRef.value;
  const scroll = getScrollContainer();
  if (!el || !scroll) return -1;
  const targets = el.querySelectorAll<HTMLElement>("[data-heading]");
  const scrollRect = scroll.getBoundingClientRect();
  const threshold = scrollRect.top + 64;
  let active = -1;
  targets.forEach((target, index) => {
    if (target.getBoundingClientRect().top <= threshold) active = index;
  });
  return active;
}

/** Re-populate the editor from the model (after an in-place content rewrite). */
function reloadFromModel(): void {
  if (editorRef.value) {
    editorRef.value.innerText = current.value?.content ?? "";
    syncHeadings();
  }
}

/**
 * Select the first literal occurrence of `keyword` in the editor DOM
 * (case-sensitive, matching the replace semantics). Returns false when not
 * found; scrolls the match into view.
 */
function locate(keyword: string): boolean {
  const el = editorRef.value;
  if (!el || !keyword) return false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const index = node.data.indexOf(keyword);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + keyword.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      // Ensure the match is visible in the scrollport.
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
      return true;
    }
  }
  return false;
}

defineExpose({ reloadFromModel, locate, locateHeading, getScrollContainer, getActiveHeadingIndex });

function onInput(e: Event) {
  if (!current.value) return;
  current.value.content = readEditorText(e.target as HTMLElement);
  syncHeadings();
  scheduleAutoSave();
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void save().catch(() => undefined);
  }
}

/** Insert indent at the caret instead of moving focus out of the editor. */
function onEditorKeydown(e: KeyboardEvent) {
  if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  if (!current.value || !editorRef.value) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editorRef.value.contains(range.startContainer)) return;

  // Selection API insert (document.execCommand is deprecated).
  range.deleteContents();
  const textNode = document.createTextNode(TAB_INDENT);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  current.value.content = readEditorText(editorRef.value);
  scheduleAutoSave();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <section class="desk">
    <template v-if="current">
      <!--
        The chapter title lives on the same `current` object as the sidebar
        (useChapters mirrors it into the list), so the two stay in sync.
      -->
      <div class="paper-frame">
        <input
          v-model="current.title"
          class="chapter-title"
          placeholder="未命名章节"
          aria-label="章节标题"
          spellcheck="false"
          @keydown="onTitleKeydown"
          @blur="onTitleBlur"
        />
        <!--
          Scroll on the outer frame so the paper can grow with content.
          Background rules live on .paper (not the scrollport), which avoids
          mobile Safari cutting off lines and drifting with attachment: local.
        -->
        <div class="paper-scroll">
          <article
            :key="current.id"
            class="paper"
            :class="{ 'is-empty': isEmpty }"
            data-placeholder="开始写作……"
            contenteditable="plaintext-only"
            spellcheck="false"
            ref="editorRef"
            @input="onInput"
            @keydown="onEditorKeydown"
          ></article>
        </div>
      </div>
    </template>

    <div v-else class="placeholder-state">
      <p>从左侧选择一个章节开始写作</p>
    </div>
  </section>
</template>

<style scoped>
.desk {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  justify-content: center;
  align-items: stretch;
  padding: 18px 32px 0;
  background: #f5f3ee;
  overflow: hidden;
}

.paper-frame {
  flex: 1;
  min-width: 0;
  min-height: 0;
  max-width: 780px;
  width: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.06);
  animation: paper-in 0.28s ease both;
}

/* Chapter title, same serif style as the manuscript below it. */
.chapter-title {
  box-sizing: border-box;
  width: 100%;
  flex-shrink: 0;
  padding: 30px 24px 16px;

  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    "思源宋体", serif;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
  color: #2b2b2b;
  caret-color: #4f6ef7;

  background: #fffdf8;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 12px 12px 0 0;
  outline: none;
}

.chapter-title::placeholder {
  color: #c5bfb2;
  font-weight: 500;
}

.paper-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  background: #fffdf8;
}

/*
 * Manuscript rules:
 *   1. left binding line
 *   2. ruled lines tiled exactly to --line (must match line-height)
 *   3. paper fill
 *
 * 对齐原理（改字号时只需要动 --font-size / --line-height）：
 *
 *   --line = --font-size × --line-height
 *
 * 同一个 --line 同时喂给 line-height 和 background-size，横线间距与行盒
 * 高度天然 1:1，不存在按设备/字体漂移的固定行高值。
 *
 * --line 必须取整到整数 CSS 像素。Android Chrome 会把 used line-height
 * 取整（39.6px → 39px），而背景 tile 仍按精确值平铺，两者不同源，横线就会
 * 相对文字逐行漂移：前十行还在字下方，二十行后已经穿过字身。桌面 Chromium
 * 不做这个取整，所以该问题只在手机上出现。取整后两边都是同一个整数值。
 *
 * --rule-offset 是横线相对行盒底部的抬升量，也由字号推导，不再手调：
 * 行盒内的 half-leading 上下对称，所以 CJK 字身框近似以行盒中心为中心，
 * 字身框底部 ≈ --line / 2 + --font-size / 2。横线默认画在行盒底部
 * (--line - 1px)，把它移到「字身框底部 + --rule-gap」即得
 *
 *   offset = (--font-size - --line) / 2 + --rule-gap + 1px
 *
 * 该式在任意字号下自洽，且与此前手调的 PC 值（36px 行距 → -6px）完全一致，
 * 所以桌面端观感不变。因为只依赖 half-leading 对称，换字体也不会失准。
 */
.paper {
  --font-size: 18px;
  --line-height: 2;
  /* 兜底值 = round(--font-size × --line-height)，见文件末尾的 @supports */
  --line: 36px;
  /* 文字视觉底部与横线之间留出的呼吸间隙 */
  --rule-gap: 2px;
  --rule-offset: calc(
    (var(--font-size) - var(--line)) / 2 + var(--rule-gap) + 1px
  );
  --bind: 48px;
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  padding: 72px 72px 96px;
  outline: none;
  border: none;

  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong",
    "思源宋体", serif;
  font-size: var(--font-size);
  /*
   * 用派生出的 px 值而不是无单位的 --line-height：无单位行高由浏览器各自
   * 做亚像素舍入，会和精确平铺的背景 tile 逐行拉开差距。
   */
  line-height: var(--line);
  color: #333;
  caret-color: #4f6ef7;
  text-align: justify;
  word-break: break-word;
  white-space: pre-wrap;
  tab-size: 2;

  background-color: #fffdf8;
  background-image:
    linear-gradient(
      to right,
      transparent 0 calc(var(--bind) - 1px),
      rgba(255, 120, 120, 0.18) calc(var(--bind) - 1px) var(--bind),
      transparent var(--bind)
    ),
    linear-gradient(
      to bottom,
      transparent calc(var(--line) - 1px),
      rgba(120, 120, 120, 0.12) 0
    ),
    linear-gradient(#fffdf8, #fffdf8);
  background-size: 100% 100%, 100% var(--line), 100% 100%;
  background-repeat: no-repeat, repeat-y, no-repeat;
  background-origin: border-box, content-box, border-box;
  background-clip: border-box, content-box, border-box;
  /*
   * Chinese glyphs sit above the bottom of their line box. Lift the rule so
   * it follows the visual baseline instead of leaving a large gap below text.
   */
  background-position: 0 0, 0 var(--rule-offset), 0 0;
}

.paper.is-empty::before {
  content: attr(data-placeholder);
  color: #bbb;
  pointer-events: none;
}

/* Heading lines (outline): `# 标题` … `###### 标题` */
.paper .heading {
  font-weight: 700;
  color: #2a2a2a;
}

/* Hide the leading '#' visually (it stays in the text model, so the
   outline/heading semantics and serialization are unaffected). */
.paper .heading::first-letter {
  visibility: hidden;
}

.paper .heading[data-heading="1"] {
  font-size: 1.5em;
  margin-top: 0.6em;
}

.paper .heading[data-heading="2"] {
  font-size: 1.25em;
  margin-top: 0.45em;
}

.paper .heading[data-heading="3"] {
  font-size: 1.1em;
  margin-top: 0.3em;
}

.paper .heading[data-heading="4"],
.paper .heading[data-heading="5"],
.paper .heading[data-heading="6"] {
  font-size: 1em;
}

.paper .heading-flash {
  background: rgba(79, 110, 247, 0.12);
  border-radius: 4px;
  transition: background 0.3s ease;
}

.paper ::selection {
  background: rgba(79, 110, 247, 0.15);
}

.paper-scroll::-webkit-scrollbar {
  width: 10px;
}

.paper-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border: 3px solid #fffdf8;
  border-radius: 999px;
}

.paper-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

@keyframes paper-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.placeholder-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: #b6b0a1;
  font-size: 0.95rem;
}

@media (max-width: 760px) {
  .desk {
    padding: 8px 8px 0;
  }

  .paper-frame {
    max-width: none;
    border-radius: 10px 10px 0 0;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.05);
  }

  .chapter-title {
    padding: 18px 14px 10px;
    font-size: 20px;
  }

  .paper {
    /*
     * 手机端只需声明字号和行高倍数，横线抬升量（--rule-offset）由 .paper
     * 里的公式自动推导。16px × 2.2 = 35.2px，取整后为 35px 行距。
     */
    --font-size: 16px;
    --line-height: 2.2;
    /* 兜底值 = round(16 × 2.2) = 35px */
    --line: 35px;
    --bind: 12px;
    padding: 28px 18px 56px;
    text-align: left;
  }

  .paper-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .paper-scroll::-webkit-scrollbar-thumb {
    border-width: 1px;
  }
}

/*
 * 支持 round() 的浏览器直接由字号推导整数行距，改字号时不用再手算兜底值。
 * 必须放在所有 @media 之后：这里的选择器特异性与断点内相同，靠源顺序覆盖。
 * 自定义属性不做值校验，所以 fallback 不能写成两条 --line 声明，只能用
 * @supports 包一层。
 */
@supports (line-height: round(1px, 1px)) {
  .paper {
    --line: round(var(--font-size) * var(--line-height), 1px);
  }
}
</style>
