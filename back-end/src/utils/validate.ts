// Request validation helpers. Every controller goes through these so bad
// input is rejected with a 400 instead of surfacing as an internal 500.

import { ApiError } from "../errors.ts";

/** Require a string within [minLen, maxLen]. */
export function assertString(
  value: unknown,
  name: string,
  maxLen = 10_000,
  minLen = 0
): string {
  if (typeof value !== "string") throw new ApiError(400, `${name} 不合法`);
  if (value.length < minLen || value.length > maxLen) {
    throw new ApiError(400, `${name} 长度需为 ${minLen}-${maxLen} 个字符`);
  }
  return value;
}

/** Accept a string or undefined/null (treats null as absent). */
export function assertOptionalString(
  value: unknown,
  name: string,
  maxLen = 10_000
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return assertString(value, name, maxLen);
}

/** Accept a non-negative integer or undefined/null (e.g. version numbers). */
export function assertOptionalInt(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, `${name} 不合法`);
  }
  return value;
}

/** Require a positive integer id from a route segment. */
export function assertId(value: string | undefined, name = "id"): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ApiError(400, `${name} 不合法`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, `${name} 不合法`);
  return n;
}

/** Require an array of unique positive integer ids (e.g. reorder payload).
 *  Accepts JSON numbers or strict digit strings — never `1e2`, `0x10`, etc. */
export function assertIdList(value: unknown, name = "ids"): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw new ApiError(400, `${name} 不合法`);
  }
  const ids = value.map((v) => {
    if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return NaN;
  });
  if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    new Set(ids).size !== ids.length) {
    throw new ApiError(400, `${name} 不合法`);
  }
  return ids;
}
