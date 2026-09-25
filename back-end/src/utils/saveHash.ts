// 服务器权威保存基准 hash：sha256(title + "\x00" + content)。
// 前端 useChapters.computeHash 使用同一算法（crypto.subtle）。
// 用分隔符拼接而非 JSON.stringify：避免字段顺序/转义差异导致前后端漂移。
// 注意：任何可编辑字段的增删都必须同步更新本函数与前端 computeHash。

import { sha256Hex } from "./token.ts";

export function computeSaveHash(title: string, content: string): Promise<string> {
  return sha256Hex(`${title}\x00${content}`);
}
