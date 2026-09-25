// Password hashing for Cloudflare Workers (WebCrypto only, no dependencies).
//
// PBKDF2-SHA256 with a per-user random salt. Iterations are a deliberate
// trade-off: OWASP recommends 600k for PBKDF2-SHA256, but Cloudflare Workers
// free tier caps CPU at ~10ms per request and WebCrypto operations DO count
// against it — 210k iterations reliably tripped the limit (login/register
// returned 500). 10k iterations are far weaker than OWASP's guidance but a
// massive upgrade over the legacy plaintext storage, and stay comfortably
// inside the CPU budget. Bump the constant if the account is on a paid plan.
// The iteration count is embedded in every stored hash, so existing hashes
// (e.g. 210k from an earlier deploy) keep verifying regardless of this value.

import { ApiError } from "../errors.ts";

const ITERATIONS = 10_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "pbkdf2";

/** True if the stored value was produced by hashPassword (not legacy plaintext). */
export function isHashed(stored: string): boolean {
  return stored.startsWith(`${PREFIX}$`);
}

/** Derive a PBKDF2-SHA256 key from a password and salt; returns raw bytes. */
async function derive(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Hash a plaintext password into the stored `pbkdf2$iter$salt$hash` format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Verify a plaintext password against a stored hash (constant-time compare). */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;

  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;

  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = fromBase64(parts[3]);
    salt = fromBase64(parts[2]);
  } catch {
    return false;
  }
  if (expected.byteLength !== KEY_BITS / 8) return false;

  const actual = await derive(password, salt);
  return constantTimeEqual(actual, expected);
}

/** Constant-time byte comparison (portable; `crypto.subtle.timingSafeEqual`
 *  is a Workers-only extension and does not exist on Node). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Validate a password candidate for registration:
 * 6-128 characters, any content (no composition rules to keep UX simple).
 */
export function assertPasswordPolicy(password: unknown): string {
  if (typeof password !== "string") throw new ApiError(400, "密码不合法");
  if (password.length < 6 || password.length > 128) {
    throw new ApiError(400, "密码长度需为 6-128 个字符");
  }
  return password;
}
