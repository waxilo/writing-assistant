<script setup lang="ts">
import { toastState } from "../composables/useToast";
</script>

<template>
  <Transition name="toast">
    <div
      v-if="toastState.visible"
      class="toast"
      :class="`toast-${toastState.type}`"
      role="status"
      aria-live="polite"
    >
      {{ toastState.message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 200;
  max-width: min(88vw, 480px);
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  color: #fff;
  background: rgba(45, 43, 40, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  user-select: none;
}

.toast-error {
  background: rgba(196, 93, 85, 0.95);
}

.toast-success {
  background: rgba(88, 130, 88, 0.95);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
