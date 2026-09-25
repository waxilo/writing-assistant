<script setup lang="ts">
/**
 * 全局请求进度条：任一 API 请求在途时，顶部显示细进度条动画。
 * 由 App.vue 订阅 onPendingChange 驱动 active。
 */
defineProps<{ active: boolean }>();
</script>

<template>
  <Transition name="progress">
    <div v-if="active" class="top-progress" aria-hidden="true"></div>
  </Transition>
</template>

<style scoped>
.top-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 300;
  background: linear-gradient(90deg, #4f6ef7, #7f95d8, #4f6ef7);
  background-size: 200% 100%;
  animation: progress-slide 1.1s linear infinite;
}

@keyframes progress-slide {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.progress-enter-active,
.progress-leave-active {
  transition: opacity 0.18s ease;
}

.progress-enter-from,
.progress-leave-to {
  opacity: 0;
}
</style>
