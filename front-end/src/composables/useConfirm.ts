import { reactive } from "vue";

/**
 * 统一确认弹窗的调用参数。
 * 整个项目所有需要用户二次确认的操作都通过这里发起。
 */
export interface ConfirmOptions {
  /** 标题，例如「删除书籍？」 */
  title?: string;
  /** 描述文案，支持 \n 换行 */
  message?: string;
  /** 确认按钮文字，默认「确认」 */
  confirmText?: string;
  /** 取消按钮文字，默认「取消」 */
  cancelText?: string;
  /**
   * 语气：
   * - danger  柔和红色确认按钮（删除类操作，默认）
   * - default 中性确认按钮（一般确认）
   */
  tone?: "danger" | "default";
  /** 圆形图标内容，默认删除图标 🗑 */
  icon?: string;
}

interface ConfirmState extends Required<ConfirmOptions> {
  visible: boolean;
}

/** 单例状态：由挂载在根组件的 <ConfirmDialog /> 读取并渲染。 */
const state = reactive<ConfirmState>({
  visible: false,
  title: "确认操作",
  message: "",
  confirmText: "确认",
  cancelText: "取消",
  tone: "danger",
  icon: "🗑",
});

let resolver: ((result: boolean) => void) | null = null;

/**
 * 发起一次确认。返回 Promise<boolean>：
 *   const ok = await confirm({ title, message });
 *   if (ok) { ... }
 * 没有回调地狱。
 */
function confirm(options: ConfirmOptions = {}): Promise<boolean> {
  // 若已有未决弹窗，先按取消处理，保证同一时刻只有一个 Promise 在等待。
  if (resolver) {
    resolver(false);
    resolver = null;
  }

  state.title = options.title ?? "确认操作";
  state.message = options.message ?? "";
  state.confirmText = options.confirmText ?? "确认";
  state.cancelText = options.cancelText ?? "取消";
  state.tone = options.tone ?? "danger";
  state.icon = options.icon ?? "🗑";
  state.visible = true;

  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

/** 关闭弹窗并结算 Promise。由 ConfirmDialog 组件在点击 / ESC / 遮罩时调用。 */
function settle(result: boolean): void {
  if (!state.visible && !resolver) return;
  state.visible = false;
  if (resolver) {
    resolver(result);
    resolver = null;
  }
}

/**
 * 统一入口：
 *   const confirm = useConfirm();
 *   await confirm({ title, message, confirmText, cancelText });
 */
export function useConfirm() {
  return confirm;
}

/** 供 ConfirmDialog 宿主组件消费的内部状态与结算函数。 */
export const confirmState = state;
export function settleConfirm(result: boolean): void {
  settle(result);
}
