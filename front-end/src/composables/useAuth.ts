import { ref } from "vue";
import {
  login as loginApi,
  register as registerApi,
} from "../api/auth";
import { setSession } from "../api/tokenStore";
import { scheduleProactiveRefresh } from "../api/http";

export type AuthMode = "login" | "register";

/**
 * Auth form state and submit logic for both login and registration. The token
 * is persisted via tokenStore (localStorage), so the session survives reloads
 * and a 401 can force logout. Registration auto-logs the user in on success.
 */
export function useAuth() {
  const mode = ref<AuthMode>("login");
  const username = ref("");
  const password = ref("");
  const confirmPassword = ref("");
  const loading = ref(false);
  const error = ref("");

  /** Switch between login and register, clearing transient state. */
  function switchMode(next: AuthMode) {
    mode.value = next;
    error.value = "";
    password.value = "";
    confirmPassword.value = "";
  }

  async function login() {
    if (!username.value || !password.value) {
      error.value = "请输入账号和密码";
      return;
    }

    loading.value = true;
    error.value = "";
    try {
      const tokens = await loginApi({
        username: username.value,
        password: password.value,
      });
      setSession(tokens);
      scheduleProactiveRefresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function register() {
    if (!username.value || !password.value) {
      error.value = "请输入账号和密码";
      return;
    }
    if (password.value !== confirmPassword.value) {
      error.value = "两次输入的密码不一致";
      return;
    }

    loading.value = true;
    error.value = "";
    try {
      const tokens = await registerApi({
        username: username.value,
        password: password.value,
      });
      setSession(tokens);
      scheduleProactiveRefresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Submit the form according to the current mode. */
  function submit() {
    return mode.value === "login" ? login() : register();
  }

  return {
    mode,
    username,
    password,
    confirmPassword,
    loading,
    error,
    switchMode,
    submit,
    login,
    register,
  };
}
