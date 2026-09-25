<script setup lang="ts">
import { computed } from "vue";
import type { Book } from "../types/book";

const props = defineProps<{ book: Book }>();
const emit = defineEmits<{
  (e: "open", id: number): void;
  (e: "remove", id: number): void;
}>();

// A small palette of muted "book cloth" tones. Picked deterministically by id
// so a given book always keeps the same cover.
const COVERS = [
  "#C9B79C", // warm sand
  "#B7C3CE", // cool gray-blue
  "#AEC3B4", // soft green
  "#C7B8CE", // muted lavender
  "#CBB0A4", // clay
  "#B9C0CC", // slate
];

const coverColor = computed(() => COVERS[props.book.id % COVERS.length]);
const initial = computed(() => props.book.title?.trim().charAt(0) || "书");

const chapterCount = computed(() => props.book.chapterCount ?? 0);
const wordCount = computed(() => props.book.wordCount ?? 0);

/** Friendly "last edited" label from the stored UTC timestamp. */
const editedLabel = computed(() => {
  const raw = props.book.updateTime;
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
});
function onCardKeydown(e: KeyboardEvent): void {
  // Keyboard activation for the card (which is a clickable <article>).
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("open", props.book.id);
  }
}
</script>

<template>
  <article
    class="card"
    role="button"
    tabindex="0"
    :aria-label="`打开《${props.book.title}》`"
    @click="emit('open', book.id)"
    @keydown="onCardKeydown"
  >
    <button class="delete" title="删除作品" @click.stop="emit('remove', book.id)">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <div class="cover" :style="{ backgroundColor: coverColor }">
      <span class="spine"></span>
      <span class="initial">{{ initial }}</span>
    </div>

    <div class="info">
      <h3 class="title">{{ book.title || "未命名作品" }}</h3>
      <dl class="meta">
        <div class="row">
          <dt>最近编辑</dt>
          <dd>{{ editedLabel }}</dd>
        </div>
        <div class="row">
          <dt>章节</dt>
          <dd>{{ chapterCount }} 章</dd>
        </div>
        <div class="row">
          <dt>字数</dt>
          <dd>{{ wordCount }} 字</dd>
        </div>
      </dl>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 260px;
  height: 320px;
  background: #fffdf8;
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
}

/* cover */
.cover {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* a subtle spine strip near the left edge for the "physical book" feel */
.spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 16px;
  width: 1px;
  background: rgba(255, 255, 255, 0.35);
}

.initial {
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", serif;
  font-size: 48px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  user-select: none;
}

/* info */
.info {
  flex-shrink: 0;
  padding: 0.85rem 1rem 1rem;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.title {
  margin: 0 0 0.5rem;
  font-size: 0.98rem;
  font-weight: 600;
  color: #2a2a2a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
}

.row dt {
  color: #aaa;
}

.row dd {
  margin: 0;
  color: #888;
}

/* delete affordance */
.delete {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  color: #888;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease,
    color 0.2s ease;
  z-index: 2;
}

.card:hover .delete {
  opacity: 1;
  transform: scale(1);
}

.delete:hover {
  background: #fff;
  color: #e03131;
}
</style>
