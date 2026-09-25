<script setup lang="ts">
import { ref, computed } from "vue";
import { useAuth } from "../composables/useAuth";

const {
  mode,
  username,
  password,
  confirmPassword,
  loading,
  error,
  switchMode,
  submit,
} = useAuth();
const showPassword = ref(false);
const showConfirm = ref(false);

const isRegister = computed(() => mode.value === "register");
const submitLabel = computed(() => {
  if (loading.value) return isRegister.value ? "注册中..." : "登录中...";
  return isRegister.value ? "注册" : "登录";
});
</script>

<template>
  <main class="page">
    <div class="layout">
      <!-- 左侧品牌区 -->
      <section class="brand">
        <div class="brand-inner">
          <div class="brand-head">
            <span class="brand-mark">✒</span>
            <span class="brand-tag">写作助手</span>
          </div>

          <h1 class="brand-title">写下你的故事</h1>
          <p class="brand-sub">记录灵感，<br />创作属于你的故事。</p>

          <!-- 纯 CSS 轻量插画：一本摊开的书 -->
          <div class="illustration" aria-hidden="true">
            <div class="book">
              <div class="book-page left">
                <span class="line w70"></span>
                <span class="line w90"></span>
                <span class="line w60"></span>
                <span class="line w80"></span>
              </div>
              <div class="book-spine"></div>
              <div class="book-page right">
                <span class="line w80"></span>
                <span class="line w60"></span>
                <span class="line w90"></span>
                <span class="line w50"></span>
              </div>
              <span class="book-emoji">📖</span>
            </div>
            <div class="tags">
              <span class="tag">灵感</span>
              <span class="tag">故事</span>
              <span class="tag">章节</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 右侧登录区 -->
      <section class="auth">
        <div class="login-card">
          <header class="card-head">
            <h2>{{ isRegister ? "创建空间" : "欢迎回来" }}</h2>
            <p class="subtitle">
              {{ isRegister ? "开始你的创作之旅" : "继续你的创作" }}
            </p>
          </header>

          <form class="form" @submit.prevent="submit">
            <label class="field">
              <span class="field-label">账号</span>
              <input
                v-model="username"
                type="text"
                autocomplete="username"
                placeholder="请输入账号"
                :disabled="loading"
              />
            </label>

            <label class="field">
              <span class="field-label">密码</span>
              <div class="password-wrap">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  :autocomplete="
                    isRegister ? 'new-password' : 'current-password'
                  "
                  placeholder="请输入密码"
                  :disabled="loading"
                />
                <button
                  type="button"
                  class="toggle"
                  :disabled="loading"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <svg
                    v-if="showPassword"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
                    />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
                    />
                    <path
                      d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
                    />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                </button>
              </div>
            </label>

            <label v-if="isRegister" class="field">
              <span class="field-label">确认密码</span>
              <div class="password-wrap">
                <input
                  v-model="confirmPassword"
                  :type="showConfirm ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="请再次输入密码"
                  :disabled="loading"
                />
                <button
                  type="button"
                  class="toggle"
                  :disabled="loading"
                  :aria-label="showConfirm ? '隐藏密码' : '显示密码'"
                  @click="showConfirm = !showConfirm"
                >
                  <svg
                    v-if="showConfirm"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
                    />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
                    />
                    <path
                      d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
                    />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                </button>
              </div>
            </label>

            <p v-if="error" class="error">{{ error }}</p>

            <button type="submit" class="submit" :disabled="loading">
              {{ submitLabel }}
            </button>
          </form>

          <p class="switch">
            <template v-if="isRegister">
              已有账号？
              <button type="button" class="link" @click="switchMode('login')">
                回到登录
              </button>
            </template>
            <template v-else>
              还没有账号？
              <button
                type="button"
                class="link"
                @click="switchMode('register')"
              >
                开始创建你的空间
              </button>
            </template>
          </p>
        </div>

        <p class="copyright">© 2026 写作助手</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  background-color: var(--bg-color);
  /* 轻微纸张纹理：低调的斜向噪点 */
  background-image: radial-gradient(
      rgba(0, 0, 0, 0.015) 1px,
      transparent 1px
    ),
    radial-gradient(rgba(0, 0, 0, 0.015) 1px, transparent 1px);
  background-size: 18px 18px, 18px 18px;
  background-position: 0 0, 9px 9px;
}

.layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  align-items: center;
  gap: 4rem;
  width: 100%;
  max-width: 960px;
  animation: rise 300ms ease both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 左侧品牌 ---------- */
.brand-inner {
  max-width: 380px;
}

.brand-head {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--secondary-color);
  margin-bottom: 2.5rem;
}

.brand-mark {
  font-size: 1.05rem;
  color: #8a8577;
}

.brand-tag {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #6b6659;
}

.brand-title {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-color);
  letter-spacing: 0.01em;
}

.brand-sub {
  margin: 1rem 0 0;
  font-size: 18px;
  line-height: 1.7;
  color: var(--secondary-color);
}

/* ---------- CSS 插画 ---------- */
.illustration {
  margin-top: 3rem;
}

.book {
  position: relative;
  display: flex;
  width: 240px;
  height: 150px;
  filter: drop-shadow(0 14px 26px rgba(120, 100, 70, 0.14));
}

.book-page {
  flex: 1;
  padding: 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  background: var(--paper-color);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.book-page.left {
  border-radius: 8px 0 0 8px;
  transform: perspective(600px) rotateY(6deg);
  transform-origin: right center;
  background: linear-gradient(90deg, #fbf8f0, var(--paper-color));
}

.book-page.right {
  border-radius: 0 8px 8px 0;
  transform: perspective(600px) rotateY(-6deg);
  transform-origin: left center;
  background: linear-gradient(-90deg, #fbf8f0, var(--paper-color));
}

.book-spine {
  width: 2px;
  background: rgba(0, 0, 0, 0.06);
}

.line {
  height: 6px;
  border-radius: 3px;
  background: #ece7db;
}

.line.w50 {
  width: 50%;
}
.line.w60 {
  width: 60%;
}
.line.w70 {
  width: 70%;
}
.line.w80 {
  width: 80%;
}
.line.w90 {
  width: 90%;
}

.book-emoji {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 26px;
  filter: saturate(0.85);
}

.tags {
  display: flex;
  gap: 0.6rem;
  margin-top: 1.75rem;
}

.tag {
  padding: 0.3em 0.85em;
  font-size: 0.8rem;
  color: #9a8f78;
  background: rgba(138, 133, 119, 0.09);
  border-radius: 999px;
}

/* ---------- 右侧登录区 ---------- */
.auth {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 40px;
  background: var(--paper-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.card-head {
  margin-bottom: 1.75rem;
}

.card-head h2 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  color: var(--text-color);
  letter-spacing: 0.01em;
}

.subtitle {
  margin: 0.4rem 0 0;
  font-size: 0.95rem;
  color: var(--secondary-color);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.85rem;
  color: var(--secondary-color);
}

.field input {
  height: 44px;
  padding: 0 0.1em;
  font-size: 0.98rem;
  border: none;
  border-bottom: 1px solid var(--border-color);
  border-radius: 0;
  background-color: transparent;
  color: var(--text-color);
  transition: border-color 0.25s ease;
}

.field input:focus {
  outline: none;
  border-bottom-color: var(--border-strong);
}

.field input::placeholder {
  color: #c4beb2;
}

/* 隐藏 WebView2/Edge 原生的密码显示 / 清除控件，只保留自定义眼睛 */
.field input::-ms-reveal,
.field input::-ms-clear {
  display: none;
}

.password-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.password-wrap input {
  flex: 1;
  width: 100%;
  padding-right: 2.5rem;
}

.toggle {
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.3em 0.4em;
  color: #999;
  background-color: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.toggle:hover:not(:disabled) {
  color: #666;
}

.toggle:disabled {
  color: #ccc;
  cursor: default;
}

.submit {
  height: 44px;
  margin-top: 0.75rem;
  font-size: 0.98rem;
  font-weight: 600;
  color: #fff;
  background-color: var(--accent-color);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.15s ease,
    box-shadow 0.2s ease;
}

.submit:hover:not(:disabled) {
  background-color: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}

.submit:active:not(:disabled) {
  transform: translateY(0);
}

.submit:disabled {
  opacity: 0.55;
  cursor: default;
}

.error {
  margin: 0;
  color: #d9645a;
  font-size: 0.88rem;
}

.switch {
  margin: 1.5rem 0 0;
  text-align: center;
  font-size: 0.88rem;
  color: var(--secondary-color);
}

.link {
  padding: 0;
  font-size: 0.88rem;
  font-weight: 500;
  color: #666;
  background: transparent;
  border: none;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}

.copyright {
  margin: 1.5rem 0 0;
  font-size: 12px;
  color: var(--muted-color);
}

/* ---------- 响应式：移动端上下堆叠 ---------- */
@media (max-width: 760px) {
  .layout {
    grid-template-columns: 1fr;
    gap: 2.5rem;
    max-width: 420px;
  }

  .brand-inner {
    max-width: none;
    text-align: center;
  }

  .brand-head {
    margin-bottom: 1.25rem;
  }

  .brand-title {
    font-size: 30px;
  }

  .illustration {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 2rem;
  }

  .tags {
    justify-content: center;
  }

  .login-card {
    padding: 32px 24px;
  }
}
</style>
