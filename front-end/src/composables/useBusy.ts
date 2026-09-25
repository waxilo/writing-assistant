import { ref } from "vue";

/**
 * 通用操作等待态：`busy` 标识 + `run` 包装（进行中自动忽略重复调用，
 * try/finally 保证复位）。用于防重复提交与操作 loading 状态。
 *
 *   const { busy, run } = useBusy();
 *   <button :disabled="busy" @click="run(save)">保存</button>
 */
export function useBusy() {
  const busy = ref(false);

  /**
   * 执行异步操作。busy 时直接跳过（返回 undefined）——调用方可
   * 把 run 当"要么执行要么忽略"的入口，无需自行判断。
   */
  async function run<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
    if (busy.value) return undefined;
    busy.value = true;
    try {
      return await fn();
    } finally {
      busy.value = false;
    }
  }

  return { busy, run };
}
