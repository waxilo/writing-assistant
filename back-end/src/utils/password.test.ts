// Unit tests for PBKDF2 password hashing and legacy-plaintext detection.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  isHashed,
  assertPasswordPolicy,
} from "./password.ts";

test("hash/verify round-trip", async () => {
  const stored = await hashPassword("s3cret-密码");
  assert.ok(isHashed(stored));
  assert.match(stored, /^pbkdf2\$\d+\$.+\$.+$/);
  assert.equal(await verifyPassword("s3cret-密码", stored), true);
});

test("wrong password fails", async () => {
  const stored = await hashPassword("correct horse");
  assert.equal(await verifyPassword("wrong horse", stored), false);
});

test("two hashes of the same password differ (random salt)", async () => {
  const a = await hashPassword("same");
  const b = await hashPassword("same");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same", a), true);
  assert.equal(await verifyPassword("same", b), true);
});

test("legacy plaintext is detected as unhashed", () => {
  assert.equal(isHashed("123456"), false);
  assert.equal(isHashed("pbkdf2$210000$salt$hash"), true);
});

test("a hash written with another iteration count still verifies", async () => {
  // Guards the raise-ITERATIONS path: the count lives in the stored string, so
  // existing accounts must not start failing after the constant moves on.
  const iterations = 500;
  const salt = new Uint8Array(Array.from({ length: 16 }, (_, i) => i));
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("old-password"),
      "PBKDF2",
      false,
      ["deriveBits"]
    ),
    256
  );
  const b64 = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b));
  const stored = `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;

  assert.equal(await verifyPassword("old-password", stored), true);
  assert.equal(await verifyPassword("not-it", stored), false);
});

test("malformed stored hashes never verify", async () => {
  assert.equal(await verifyPassword("x", "pbkdf2$210000$salt"), false);
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "pbkdf2$abc$salt$hash"), false);
});

test("password policy: 6-128 chars", () => {
  assert.throws(() => assertPasswordPolicy("12345"), { status: 400 });
  assert.throws(() => assertPasswordPolicy(123456), { status: 400 });
  assert.throws(() => assertPasswordPolicy("x".repeat(129)), { status: 400 });
  assert.equal(assertPasswordPolicy("123456"), "123456");
});
