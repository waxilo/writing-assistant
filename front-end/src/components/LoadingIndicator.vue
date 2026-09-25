<script setup lang="ts">
/**
 * 统一加载指示：spinner + 可选文字。用于列表/详情加载、操作等待等。
 * 覆盖层定位由使用处（absolute 容器）负责。
 */
withDefaults(defineProps<{ text?: string }>(), { text: "" });
</script>

<template>
  <div class="loading-indicator" role="status" aria-label="加载中">
    <span class="spinner" aria-hidden="true"></span>
    <span v-if="text" class="loading-text">{{ text }}</span>
  </div>
</template>

<style scoped>
.loading-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(79, 110, 247, 0.25);
  border-top-color: #4f6ef7;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.loading-text {
  font-size: 12.5px;
  color: #b6b0a1;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
