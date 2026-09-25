import {
  createAccessToken,
  createRefreshToken,
  ACCESS_TTL,
} from "../utils/token";
import {
  createSession,
  revokeAllForUser,
} from "./SessionService";
import { ApiError } from "../errors";
import {
  hashPassword,
  verifyPassword,
  isHashed,
  assertPasswordPolicy,
} from "../utils/password";
import type { BookRow } from "../types";

/** Access + refresh token pair returned on login/register/refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, so the client can schedule renewal. */
  expiresIn: number;
}

// --- brute-force protection ------------------------------------------------

const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_FAILURES = 5;

/** True when the username+ip pair has exceeded the failure threshold. */
async function isRateLimited(
  env: Env,
  username: string,
  ip: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    `select count(*) as cnt from t_login_attempt
     where username = ? and ip = ? and created_at > ?`
  )
    .bind(username, ip, Date.now() - RATE_WINDOW_MS)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) >= RATE_MAX_FAILURES;
}

/**
 * IP-wide throttle used for registration (an attacker can trivially pick a
 * fresh username, so username scoping would be useless there). Shares the
 * same failure table, so login failures also cool down registration.
 */
async function isIpRateLimited(env: Env, ip: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `select count(*) as cnt from t_login_attempt
     where ip = ? and created_at > ?`
  )
    .bind(ip, Date.now() - RATE_WINDOW_MS)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) >= RATE_MAX_FAILURES;
}

/** Record a failed attempt, pruning rows older than the window in the same batch. */
async function recordFailure(
  env: Env,
  username: string,
  ip: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`delete from t_login_attempt where created_at < ?`).bind(
      Date.now() - RATE_WINDOW_MS
    ),
    env.DB.prepare(
      `insert into t_login_attempt (username, ip, created_at) values (?, ?, ?)`
    ).bind(username, ip, Date.now()),
  ]);
}

/** Clear failure history after a successful login. */
async function clearFailures(
  env: Env,
  username: string,
  ip: string
): Promise<void> {
  await env.DB.prepare(
    `delete from t_login_attempt where username = ? and ip = ?`
  )
    .bind(username, ip)
    .run();
}

/** Normalize a login/register username: trim + case-fold so `Admin` and
 *  `admin` are the same account and rate-limit rows cannot be diluted by
 *  case variants. (SQLite compares TEXT with BINARY collation.) */
function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "账号不合法");
  const name = value.trim().toLowerCase();
  if (name.length < 3 || name.length > 32) {
    throw new ApiError(400, "账号长度需为 3-32 个字符");
  }
  return name;
}

/**
 * Precomputed PBKDF2 hash of a throwaway password, used when the username
 * does not exist: running the same expensive derivation as the real path
 * removes the response-time side channel that would let attackers enumerate
 * usernames. It never matches anything. Must be re-generated whenever
 * ITERATIONS in password.ts changes (kept in sync: 10k).
 */
const DECOY_HASH =
  "pbkdf2$10000$JmcFzlgBdIsb437MZspt2g==$JW856TX44hjGpnz84jcyFEFbr9F3DpV9t4IkwMwc+2c=";

/** Issue an access + refresh token pair and register the refresh session. */
export async function issueTokens(
  userId: number,
  env: Env,
  isMcp = false
): Promise<AuthTokens> {
  const { token, jti, ttlMs } = await createRefreshToken(userId, env);
  // The access token is tied to the refresh session so write operations can
  // revoke every OTHER session of this account while keeping this one.
  const accessToken = await createAccessToken(userId, env, jti);
  await createSession(env, userId, jti, token, ttlMs, isMcp);
  return { accessToken, refreshToken: token, expiresIn: ACCESS_TTL };
}

interface UserPasswordRow {
  id: number;
  password: string;
}

/**
 * Validate credentials and, on success, issue a token pair.
 * Passwords are stored as PBKDF2 hashes; legacy plaintext rows are upgraded
 * in place on first successful login (lazy migration). Failed attempts are
 * rate-limited per username+IP.
 */
/** client = "mcp" 标记 AI 工具会话（多会话并存，无需抢占）。 */
export async function login(
  username: string,
  password: string,
  env: Env,
  ip: string,
  client?: string
): Promise<AuthTokens> {
  const name = normalizeUsername(username);
  // Lenient at login: only type/upper bound, so legacy accounts with shorter
  // passwords can still sign in (registration enforces the full policy).
  const pass = typeof password === "string" ? password : "";
  if (pass.length > 128) throw new ApiError(400, "密码不合法");
  if (await isRateLimited(env, name, ip)) {
    throw new ApiError(429, "尝试过于频繁，请稍后再试");
  }

  // lower(username) matches legacy rows that were registered with uppercase
  // letters before case-folding was introduced (new rows are stored folded).
  const user = await env.DB.prepare(
    `select id, password from t_user where lower(username) = ?`
  )
    .bind(name)
    .first<UserPasswordRow>();

  // Single message for "no such user" and "wrong password" (no enumeration).
  const reject = () => {
    // Failure recording is best-effort; never block the login response on it.
    void recordFailure(env, name, ip).catch(() => undefined);
    throw new ApiError(400, "账号密码错误");
  };

  if (!user) {
    // Burn the same CPU as a real password check so response timing cannot
    // reveal whether the username exists.
    await verifyPassword(pass, DECOY_HASH);
    return reject();
  }

  if (isHashed(user.password)) {
    if (!(await verifyPassword(pass, user.password))) return reject();
  } else {
    // Legacy plaintext row: compare directly, then upgrade to a hash.
    if (user.password !== pass) return reject();
    const upgraded = await hashPassword(pass);
    await env.DB.prepare(`update t_user set password = ? where id = ?`)
      .bind(upgraded, user.id)
      .run();
  }

  await clearFailures(env, name, ip);
  return issueTokens(user.id, env, client === "mcp");
}

/**
 * Register a new user and, on success, issue a token pair (auto login).
 * The UNIQUE constraint on username is the source of truth; a pre-check only
 * gives a friendlier error, and constraint violations are mapped to 400.
 */
export async function register(
  username: string,
  password: string,
  env: Env,
  ip: string
): Promise<AuthTokens> {
  const name = normalizeUsername(username);
  const pass = assertPasswordPolicy(password);

  if (await isIpRateLimited(env, ip)) {
    throw new ApiError(429, "尝试过于频繁，请稍后再试");
  }

  // Case-insensitive check so a new "admin" cannot shadow a legacy "Admin".
  const existing = await env.DB.prepare(
    `select id from t_user where lower(username) = ?`
  )
    .bind(name)
    .first<Pick<BookRow, "id">>();
  if (existing) throw new ApiError(400, "该账号已存在");

  const hashed = await hashPassword(pass);
  let result;
  try {
    result = await env.DB.prepare(
      `insert into t_user (username, password, nickname) values (?, ?, ?)`
    )
      .bind(name, hashed, name)
      .run();
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed/i.test(error.message)
    ) {
      throw new ApiError(400, "该账号已存在");
    }
    throw error;
  }

  const userId = Number(result.meta.last_row_id);
  return issueTokens(userId, env);
}

/**
 * Change the account password: verify the current one (supports legacy
 * plaintext rows, upgrading to a hash), store the new hash, and revoke every
 * OTHER session of the account (the calling session is kept).
 */
export async function changePassword(
  env: Env,
  userId: number,
  sid: string | undefined,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const next = assertPasswordPolicy(newPassword);
  if (
    typeof oldPassword !== "string" ||
    oldPassword.length === 0 ||
    oldPassword.length > 128
  ) {
    throw new ApiError(400, "当前密码不合法");
  }

  const user = await env.DB.prepare(
    `select password from t_user where id = ?`
  )
    .bind(userId)
    .first<{ password: string }>();
  if (!user) throw new ApiError(404, "用户不存在");

  if (isHashed(user.password)) {
    if (!(await verifyPassword(oldPassword, user.password))) {
      throw new ApiError(400, "当前密码错误");
    }
  } else {
    // Legacy plaintext row: compare directly (upgrade happens on save).
    if (user.password !== oldPassword) {
      throw new ApiError(400, "当前密码错误");
    }
  }

  const hashed = await hashPassword(next);
  await env.DB.prepare(`update t_user set password = ? where id = ?`)
    .bind(hashed, userId)
    .run();

  // Password change is a security event: kick EVERY session (incl. MCP).
  await revokeAllForUser(env, userId);
}
