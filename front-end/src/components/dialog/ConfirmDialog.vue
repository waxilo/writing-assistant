<script setup lang="ts">
import BaseDialog from "./BaseDialog.vue";
import { confirmState, settleConfirm } from "../../composables/useConfirm";

/**
 * 全局唯一的确认弹窗宿主。
 * 在 App.vue 中挂载一次，配合 useConfirm() 使用，整个项目共用这一个实例。
 */
function onCancel() {
  settleConfirm(false);
}

function onConfirm() {
  settleConfirm(true);
}
</script>

<template>
  <BaseDialog :visible="confirmState.visible" @close="onCancel">
    <div class="confirm">
      <div class="confirm-icon" :class="confirmState.tone">
        {{ confirmState.icon }}
      </div>

      <h3 class="confirm-title">{{ confirmState.title }}</h3>

      <p v-if="confirmState.message" class="confirm-message">
        {{ confirmState.message }}
      </p>

      <div class="confirm-actions">
        <button class="btn btn-cancel" @click="onCancel">
          {{ confirmState.cancelText }}
        </button>
        <button
          class="btn btn-confirm"
          :class="confirmState.tone"
          @click="onConfirm"
        >
          {{ confirmState.confirmText }}
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* ---- 圆形图标 ---- */
.confirm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
}

.confirm-icon.danger {
  background: #fff3f1;
  color: #d85b52;
}

.confirm-icon.default {
  background: #f0efe9;
  color: #8a8577;
}

/* ---- 标题 ---- */
.confirm-title {
  margin: 16px 0 0;
  font-size: 18px;
  font-weight: 600;
  color: #222;
}

/* ---- 描述 ---- */
.confirm-message {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: #888;
  white-space: pre-line;
}

/* ---- 按钮 ---- */
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
  margin-top: 24px;
}

.btn {
  height: 40px;
  padding: 0 18px;
  min-width: 84px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.btn-cancel {
  color: #666;
  background: transparent;
  border: 1px solid #ddd;
}

.btn-cancel:hover {
  background: #f7f7f7;
}

.btn-confirm {
  color: #fff;
  border: 1px solid transparent;
}

.btn-confirm.danger {
  background: #d96a63;
}

.btn-confirm.danger:hover {
  background: #c95a54;
}

.btn-confirm.default {
  background: #8a8577;
}

.btn-confirm.default:hover {
  background: #736f62;
}
</style>
