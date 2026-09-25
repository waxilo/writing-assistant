// Unit tests for the JWT machinery (sign/verify, type separation, tampering).
// Run with: node --test (Node >= 22.6 with type stripping).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAccessToken,
  verifyAccess,
  createRefreshToken,
  verifyRefresh,
  sha256Hex,
} from "./token.ts";

const env = {
  TOKEN_SECRET: "test-access-secret-0123456789abcdef",
  REFRESH_SECRET: "test-refresh-secret-0123456789abcdef",
} as unknown as Env;

test("access token round-trip", async () => {
  const token = await createAccessToken(42, env);
  const check = await verifyAccess(token, env);
  assert.equal(check.success, true);
  assert.equal(check.userId, 42);
});

test("access token carries the session id (sid)", async () => {
  const token = await createAccessToken(7, env, "session-abc");
  const check = await verifyAccess(token, env);
  assert.equal(check.success, true);
  assert.equal(check.sid, "session-abc");
});

test("access token without sid verifies without one", async () => {
  const token = await createAccessToken(7, env);
  const check = await verifyAccess(token, env);
  assert.equal(check.success, true);
  assert.equal(check.sid, undefined);
});

test("refresh token round-trip carries a jti", async () => {
  const { token, jti } = await createRefreshToken(7, env);
  assert.ok(jti.length > 0);
  const check = await verifyRefresh(token, env);
  assert.equal(check.success, true);
  assert.equal(check.uid, 7);
  assert.equal(check.jti, jti);
});

test("an access token is never accepted as a refresh token", async () => {
  const access = await createAccessToken(1, env);
  const check = await verifyRefresh(access, env);
  assert.equal(check.success, false);
});

test("a refresh token is never accepted as an access token", async () => {
  const { token } = await createRefreshToken(1, env);
  const check = await verifyAccess(token, env);
  assert.equal(check.success, false);
});

test("tampered payload is rejected", async () => {
  const token = await createAccessToken(9, env);
  // Flip one character inside the payload segment.
  const [header, payload, signature] = token.split(".");
  const tampered =
    payload.length > 0
      ? payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A")
      : payload;
  const bad = `${header}.${tampered}.${signature}`;
  const check = await verifyAccess(bad, env);
  assert.equal(check.success, false);
});

test("a token signed with the other secret is rejected", async () => {
  // Sign with TOKEN_SECRET, verify as if it were a refresh token (REFRESH_SECRET).
  const access = await createAccessToken(1, env);
  // verifyRefresh uses REFRESH_SECRET, so the HS256 signature won't match.
  const check = await verifyRefresh(access, env);
  assert.equal(check.success, false);
});

test("sha256Hex matches the known SHA-256 vector for 'abc'", async () => {
  const hex = await sha256Hex("abc");
  assert.equal(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("garbage input is rejected without throwing", async () => {
  const check = await verifyAccess("not-a-jwt", env);
  assert.equal(check.success, false);
  const check2 = await verifyAccess("a.b", env);
  assert.equal(check2.success, false);
});
