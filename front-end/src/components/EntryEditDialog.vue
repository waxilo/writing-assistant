<script setup lang="ts">
import BaseDialog from "./dialog/BaseDialog.vue";
import EntryEditor from "./EntryEditor.vue";
import type { Entry } from "../types/writer";

/**
 * 设定条目编辑弹层：薄壳封装 EntryEditor（标题/内容/自动保存/删除）。
 */
defineProps<{ entryId: number }>();

const emit = defineEmits<{
  (e: "close", entry: Entry | null): void;
  (e: "saved", entry: Entry): void;
  (e: "deleted"): void;
}>();

function onSaved(entry: Entry): void {
  emit("saved", entry);
}
</script>

<template>
  <BaseDialog :visible="true" :close-on-mask="false" @close="emit('close', null)">
    <EntryEditor
      :entry-id="entryId"
      @saved="onSaved"
      @deleted="emit('deleted')"
      @close="emit('close', null)"
    />
  </BaseDialog>
</template>
