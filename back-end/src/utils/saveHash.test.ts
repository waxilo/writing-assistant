// computeSaveHash 确定性断言：防止算法改动破坏与前端 computeHash 的一致性。
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSaveHash } from "./saveHash.ts";

test("computeSaveHash is stable (matches frontend crypto.subtle algorithm)", async () => {
  assert.equal(
    await computeSaveHash("第一章", "正文内容"),
    "aec8d8840967fb3ac7b5ba9c3da5f676b55a17e127fa2a3b10061d3813fdc671" // sha256("第一章\x00正文内容")
  );
  assert.equal(
    await computeSaveHash("标题", ""),
    "871a268f9a1aa8b80534db94d7b47581503ac2aa8541f72b930e6a19b9028c18" // sha256("标题\x00")
  );
});
