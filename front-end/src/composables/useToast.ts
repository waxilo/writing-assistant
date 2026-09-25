import { reactive } from "vue";

/**
 * 全局轻量提示（toast）：整个项目共用一个实例，挂在根组件的 <ToastHost />。
 * 用法：
 *   const toast = useToast();
 *   toast.show("保存失败", "error");
 */
export type ToastType = "error" | "success" | "info";

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

const state = reactive<ToastState>({
  visible: false,
  message: "",
  type: "error",
});

let timer: ReturnType<typeof setTimeout> | null = null;

/** 显示一条提示，自动消失。 */
export function showToast(
  message: string,
  type: ToastType = "error",
  duration = 3200
): void {
  state.message = message;
  state.type = type;
  state.visible = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    state.visible = false;
  }, duration);
}

export function useToast() {
  return { show: showToast, state };
}

/** 供 ToastHost 宿主组件消费的内部状态。 */
export const toastState = state;
