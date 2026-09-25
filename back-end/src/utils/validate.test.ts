// Unit tests for request validation helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertId, assertIdList, assertString } from "./validate.ts";

test("assertString accepts valid input and rejects bad types/lengths", () => {
  assert.equal(assertString("你好", "标题", 10), "你好");
  assert.throws(() => assertString(42, "标题"), { status: 400 });
  assert.throws(() => assertString("太长太长太长", "标题", 4), { status: 400 });
});

test("assertId accepts only positive integers", () => {
  assert.equal(assertId("12"), 12);
  assert.throws(() => assertId("abc"), { status: 400 });
  assert.throws(() => assertId("0"), { status: 400 });
  assert.throws(() => assertId("-3"), { status: 400 });
  assert.throws(() => assertId("1.5"), { status: 400 });
  assert.throws(() => assertId(undefined), { status: 400 });
});

test("assertIdList requires unique positive ids", () => {
  assert.deepEqual(assertIdList(["1", "2", "3"]), [1, 2, 3]);
  assert.deepEqual(assertIdList([1, 2, 3]), [1, 2, 3]);
  assert.throws(() => assertIdList([]), { status: 400 });
  assert.throws(() => assertIdList([1, 1]), { status: 400 });
  assert.throws(() => assertIdList([-1]), { status: 400 });
  assert.throws(() => assertIdList("nope"), { status: 400 });
});

test("assertIdList rejects loose numeric formats", () => {
  // `Number("1e2")` would coerce these to 100 — they must be rejected.
  assert.throws(() => assertIdList(["1e2"]), { status: 400 });
  assert.throws(() => assertIdList(["0x10"]), { status: 400 });
  assert.throws(() => assertIdList([1.5]), { status: 400 });
  assert.throws(() => assertIdList([true]), { status: 400 });
});
