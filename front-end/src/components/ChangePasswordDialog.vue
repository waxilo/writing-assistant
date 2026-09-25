<script setup lang="ts">
import { ref } from "vue";
import BaseDialog from "./dialog/BaseDialog.vue";
import * as authApi from "../api/auth";
import { showToast } from "../composables/useToast";

/**
 * 修改密码弹层：验证当前密码 → 设置新密码（6-128 字符）。
 * 成功后其他设备的会话会被吊销（本端保留）。
 */
const emit = defineEmits<{ (e: "close"): void }>();

const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const loading = ref(false);

async function onSubmit(): Promise<void> {
  error.value = "";
  if (!oldPassword.value || !newPassword.value) {
    error.value = "请输入当前密码和新密码";
    return;
  }
  if (newPassword.value.length < 6 || newPassword.value.length > 128) {
    error.value = "新密码长度需为 6-128 个字符";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = "两次输入的新密码不一致";
    return;
  }

  loading.value = true;
  try {
    await authApi.changePassword(oldPassword.value, newPassword.value);
    showToast("密码已修改，其他设备已下线", "success");
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "修改失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <BaseDialog :visible="true" :close-on-mask="false" @close="emit('close')">
    <form class="pwd" @submit.prevent="onSubmit">
      <h3 class="pwd-title">修改密码</h3>
      <p class="pwd-sub">修改后其他设备的登录会被下线（本端保留）</p>

      <label class="pwd-field">
        <span class="pwd-label">当前密码</span>
        <input
          v-model="oldPassword"
          type="password"
          autocomplete="current-password"
          :disabled="loading"
        />
      </label>

      <label class="pwd-field">
        <span class="pwd-label">新密码（6-128 字符）</span>
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :disabled="loading"
        />
      </label>

      <label class="pwd-field">
        <span class="pwd-label">确认新密码</span>
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          :disabled="loading"
        />
      </label>

      <p v-if="error" class="pwd-error">{{ error }}</p>

      <div class="pwd-actions">
        <button type="button" class="pwd-cancel" @click="emit('close')">
          取消
        </button>
        <button type="submit" class="pwd-submit" :disabled="loading">
          {{ loading ? "提交中…" : "确认修改" }}
        </button>
      </div>
    </form>
  </BaseDialog>
</template>

<style scoped>
.pwd {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pwd-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #2a2a2a;
}

.pwd-sub {
  margin: -6px 0 2px;
  font-size: 12px;
  color: #999;
}

.pwd-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pwd-label {
  font-size: 12.5px;
  color: #666;
}

.pwd-field input {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 12px;
  font-size: 14px;
  color: #333;
  background: #fff;
  border: 1px solid #e2ddd2;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s ease;
}

.pwd-field input:focus {
  border-color: #4f6ef7;
}

.pwd-error {
  margin: 0;
  font-size: 12.5px;
  color: #c45d55;
}

.pwd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.pwd-cancel {
  padding: 8px 16px;
  font-size: 13px;
  color: #666;
  background: transparent;
  border: 1px solid #ddd6c8;
  border-radius: 8px;
  cursor: pointer;
}

.pwd-submit {
  padding: 8px 18px;
  font-size: 13px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.pwd-submit:hover {
  background: #3f5de0;
}

.pwd-submit:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
