# 令牌短时过期 + 异步续签 实现设计

## 1. 背景与目标

### 现状

当前认证是**单枚无状态签名令牌**：

- `back-end/src/utils/token.ts`：HS256 JWT，载荷 `{ uid, iat, exp }`，`EXPIRE_SECONDS = 7 天`，用 `TOKEN_SECRET` 签名，验签不查库。
- `back-end/src/middleware/auth.ts`：`checkAuth` 从 `Authorization: Bearer <token>` 取令牌，`checkToken` 验签 + 校验 `exp`，返回 `uid`。
- `back-end/src/service/AuthService.ts`：`login` / `register` 校验后直接 `createToken` 返回**令牌字符串**。
- 前端 `front-end/src/api/tokenStore.ts`：令牌存 `localStorage`（key `writer_token`），暴露响应式 ref。
- 前端 `front-end/src/api/http.ts`：注入 `Bearer`；响应 `code === 401` 时 `clearToken()` 并抛错，回到登录页。

### 问题（“太死板”）

- **有效期固定 7 天**：短了用户频繁掉线，长了无状态令牌无法即时吊销，安全窗口大。
- **无续签**：令牌一到期，用户当前操作直接失败并被踢回登录页，体验割裂。
- **无法主动失效**：登出只清前端，服务端在到期前仍认可该令牌。

### 目标

- **短时访问令牌（Access Token, AT）**：TTL 很短（建议 15 分钟），降低泄露/无法吊销的风险窗口。
- **长时刷新令牌（Refresh Token, RT）**：TTL 较长（建议 30 天），仅用于换取新的 AT，服务端可存储/轮换/吊销。
- **异步续签（静默刷新）**：AT 临近过期时在后台自动换新，用户无感；请求遇到 401 时自动补救重试一次。
- **可吊销**：登出或异常可让 RT 立即失效。
- 尽量复用现有结构（`token.ts`、`t_login_log` 表、`http.ts` 拦截逻辑），改动可控。

---

## 2. 方案总览

采用 **Access Token + Refresh Token 双令牌 + 前端单飞（single-flight）静默续签**。

```
┌─────────────────────────── 前端 (Tauri + Vue) ───────────────────────────┐
│  tokenStore: { accessToken, refreshToken, accessExp }  (localStorage)     │
│                                                                            │
│  http.request()                                                            │
│    ├─ 发请求前：AT 已过期或临近过期(<60s) → 先 await ensureFreshToken()     │
│    ├─ 注入 Authorization: Bearer <AT>                                       │
│    └─ 响应 code===401 → await ensureFreshToken() → 用新 AT 重试一次         │
│                                                                            │
│  ensureFreshToken(): 单飞——并发请求共享同一个 refresh Promise              │
│    └─ POST /refresh { refreshToken } → 得到新 { AT, RT, expiresIn }         │
│                                                                            │
│  预续签定时器：在 accessExp - 60s 触发后台刷新（tab 活跃时）               │
└────────────────────────────────────────────────────────────────────────┘
                     │ HTTPS  { code, message, data }
┌────────────────────▼─────────────────────────────────────────────────────┐
│                          后端 (Cloudflare Workers)                         │
│  POST /login | /register → 返回 { accessToken, refreshToken, expiresIn }    │
│  POST /refresh (公开)     → 校验 RT(查 t_login_log) → 轮换 → 返回新令牌对    │
│  POST /logout            → 吊销当前 RT                                       │
│  其余接口: checkAuth 只验 AT（无状态，不查库）                              │
│  t_login_log: 存 RT 哈希 + 过期 + 吊销标记，用于校验/轮换/吊销              │
└────────────────────────────────────────────────────────────────────────┘
```

关键点：

- **AT 保持无状态**：`checkAuth` 依旧只验签 + 校验 exp，不查库，业务接口零额外开销。
- **RT 有状态**：存 `t_login_log`，支持一次性轮换（rotation）、吊销、重放检测。
- **静默续签在前端 `http.ts` 收口**：业务代码无需感知续签。

---

## 3. 令牌设计

### 3.1 Access Token（短时，无状态）

沿用现有 JWT 结构，新增 `typ` 区分类型，缩短有效期：

```
payload = { uid, iat, exp, typ: "access" }
TTL = ACCESS_TTL = 15 * 60           // 15 分钟
```

- 验签复用现有 `checkToken`，额外校验 `typ === "access"`（防止 RT 被当 AT 使用）。
- `checkAuth` 逻辑基本不变。

### 3.2 Refresh Token（长时，有状态）

两种实现，推荐 **B：JWT + 服务端登记**。

- **A. 不透明随机串**：`crypto.getRandomValues` 生成 32 字节随机串，服务端存哈希。简单，但无自解释信息。
- **B. 签名 JWT（推荐）**：`payload = { uid, iat, exp, typ:"refresh", jti }`，`jti` 为随机唯一 id。
  - `TTL = REFRESH_TTL = 30 * 24 * 60 * 60`（30 天）。
  - 服务端只登记 `jti`（及其状态），验签仍无需查库即可拿到 uid，再用 `jti` 查库判断是否被吊销/轮换。

> 存库时**只存 `jti` 或 RT 的哈希**（如 SHA-256），不存明文，降低库泄露风险。

### 3.3 密钥

- 复用 `TOKEN_SECRET`；建议为 RT 增加独立 `REFRESH_SECRET`（`.dev.vars` 与 `wrangler secret`），避免 AT/RT 用同一把密钥。
- `Env`（`worker-configuration.d.ts`）新增 `REFRESH_SECRET: string`。

---

## 4. 数据模型（复用 `t_login_log`）

现有表（`migrations/0001_init.sql`）：

```sql
CREATE TABLE t_login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  token_expire_ms INTEGER NOT NULL
);
```

把它复用为**刷新令牌会话表**。新增迁移 `migrations/0003_refresh_token.sql`：

```sql
-- 用于刷新令牌的轮换与吊销
ALTER TABLE t_login_log ADD COLUMN jti TEXT;              -- 刷新令牌唯一 id（或 RT 哈希）
ALTER TABLE t_login_log ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE t_login_log ADD COLUMN rotated_to TEXT;       -- 轮换后指向的新 jti（重放检测用）
ALTER TABLE t_login_log ADD COLUMN last_used DATETIME;

CREATE INDEX IF NOT EXISTS idx_login_log_jti ON t_login_log (jti);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON t_login_log (user_id);
```

字段语义：

| 字段 | 含义 |
| --- | --- |
| `token` | 存 RT 的哈希（`jti` 已单列，可只存哈希做双重校验，或直接用 `jti` 唯一约束） |
| `jti` | 刷新令牌唯一标识；`/refresh` 时据此定位会话 |
| `token_expire_ms` | RT 有效时长（毫秒）；绝对过期时间 = `login_time + token_expire_ms`，查询时计算 |
| `revoked` | 是否已吊销（登出 / 被轮换 / 重放触发） |
| `rotated_to` | 轮换后新令牌的 `jti`；旧 RT 被再次使用即判定重放 |
| `last_used` | 最近一次刷新时间，便于审计 |

> 说明：`token` 列有 `NOT NULL UNIQUE` 约束。迁移时若沿用该列存 RT 哈希即可满足；若改以 `jti` 为主键唯一，可给 `token` 存同值或哈希。实施时二选一，保持一致。

---

## 5. 后端改造

### 5.1 `utils/token.ts`

- 抽出通用签发/验签，支持 `typ` 与不同 TTL、不同密钥：

```ts
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;

export async function createAccessToken(uid: number, env: Env): Promise<string> {
  return signJwt({ uid, typ: "access" }, ACCESS_TTL, env.TOKEN_SECRET);
}

export async function createRefreshToken(
  uid: number,
  env: Env
): Promise<{ token: string; jti: string; expMs: number }> {
  const jti = crypto.randomUUID();
  const expMs = Date.now() + REFRESH_TTL * 1000;
  const token = await signJwt({ uid, typ: "refresh", jti }, REFRESH_TTL, env.REFRESH_SECRET);
  return { token, jti, expMs };
}

export async function verifyAccess(token: string, env: Env): Promise<TokenCheck>;   // typ==="access"
export async function verifyRefresh(token: string, env: Env): Promise<{ success: boolean; uid?: number; jti?: string }>;
```

- `signJwt` / base64url / timingSafeEqual 复用现有实现。

### 5.2 会话存取（新增 `service/SessionService.ts`）

```ts
// 登记新的刷新令牌
export async function createSession(env, userId, jti, tokenHash, expMs): Promise<void>;

// 校验 RT 会话是否有效（存在、未吊销、未过期）；返回该会话行
export async function getActiveSession(env, jti): Promise<SessionRow | null>;

// 轮换：吊销旧会话、指向新 jti，并登记新会话（建议放进一个 batch 事务）
export async function rotateSession(env, oldJti, newJti, newHash, newExpMs): Promise<void>;

// 吊销（登出）
export async function revokeSession(env, jti): Promise<void>;

// 重放检测：旧 RT 已被轮换仍被再次使用 → 吊销该用户全部会话
export async function revokeAllForUser(env, userId): Promise<void>;
```

哈希用 `crypto.subtle.digest("SHA-256", ...)`。

### 5.3 `service/AuthService.ts`

`login` / `register` 校验成功后签发**令牌对**并登记会话：

```ts
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // AT 秒数，供前端排预续签
}

async function issueTokens(userId: number, env: Env): Promise<AuthTokens> {
  const accessToken = await createAccessToken(userId, env);
  const { token, jti, expMs } = await createRefreshToken(userId, env);
  await createSession(env, userId, jti, await sha256(token), expMs);
  return { accessToken, refreshToken: token, expiresIn: ACCESS_TTL };
}
```

`login` / `register` 返回 `AuthTokens`（而非当前的裸字符串）。

### 5.4 `/refresh` 接口（公开，核心）

`controller/auth.ts`（或复用 `controller/login.ts`）新增：

```ts
export async function refresh(ctx: Ctx): Promise<Response> {
  const { refreshToken } = await ctx.json<{ refreshToken: string }>();
  const v = await verifyRefresh(refreshToken, ctx.env);     // 验签 + typ + exp
  if (!v.success || !v.jti || v.uid === undefined) {
    return jsonResponse(null, 401, "请重新登录");
  }

  const session = await getActiveSession(ctx.env, v.jti);
  if (!session) {
    // 该 jti 已被轮换/吊销/不存在 → 可能重放，吊销该用户全部会话
    await revokeAllForUser(ctx.env, v.uid);
    return jsonResponse(null, 401, "登录状态已失效");
  }

  // 轮换：作废旧 RT，签发新令牌对
  const accessToken = await createAccessToken(v.uid, ctx.env);
  const { token: newRt, jti: newJti, expMs } = await createRefreshToken(v.uid, ctx.env);
  await rotateSession(ctx.env, v.jti, newJti, await sha256(newRt), expMs);

  return jsonResponse({ accessToken, refreshToken: newRt, expiresIn: ACCESS_TTL });
}
```

### 5.5 `/logout` 接口（可选但推荐）

```ts
export async function logout(ctx: Ctx): Promise<Response> {
  const { refreshToken } = await ctx.json<{ refreshToken: string }>().catch(() => ({}));
  const v = refreshToken ? await verifyRefresh(refreshToken, ctx.env) : { success: false };
  if (v.success && v.jti) await revokeSession(ctx.env, v.jti);
  return jsonResponse({ ok: true });
}
```

### 5.6 路由（`route.ts`）

在公开路由区新增（`checkAuth` 之前）：

```ts
if (method === "POST" && seg1 === "refresh") return authController.refresh(ctx);
if (method === "POST" && seg1 === "logout")  return authController.logout(ctx);
```

`checkAuth` 改用 `verifyAccess`（额外校验 `typ === "access"`）。

### 5.7 错误码约定

- AT 失效 → `code = 401`，`message` 例如 `"访问令牌已过期"`（前端据此触发续签重试）。
- RT 失效/吊销/重放 → `/refresh` 返回 `code = 401`，前端据此**强制登出**。

---

## 6. 前端改造

### 6.1 `tokenStore.ts`

从存单一 `writer_token` 改为存令牌对与 AT 过期时刻：

```ts
interface Session {
  accessToken: string;
  refreshToken: string;
  accessExp: number;   // 毫秒时间戳，由 expiresIn 或解析 AT 的 exp 得到
}
// localStorage keys: writer_access / writer_refresh / writer_access_exp
export function getAccess(): string;
export function getRefresh(): string;
export function getAccessExp(): number;
export function setSession(s: Session): void;
export function clearSession(): void;
export function sessionRef(); // 响应式，驱动登录/主界面切换
```

保持“无循环依赖”原则（`tokenStore` 不依赖 `http`）。

### 6.2 `http.ts`：单飞静默续签 + 401 补救

```ts
let refreshPromise: Promise<boolean> | null = null;
const SKEW_MS = 60_000; // 提前 60s 视为需要续签

async function ensureFreshToken(): Promise<boolean> {
  if (Date.now() < getAccessExp() - SKEW_MS) return true;       // 仍新鲜
  if (!refreshPromise) refreshPromise = doRefresh().finally(() => (refreshPromise = null));
  return refreshPromise;                                        // 并发请求共享同一次刷新
}

async function doRefresh(): Promise<boolean> {
  const rt = getRefresh();
  if (!rt) return false;
  try {
    const res = await fetch(resolveUrl("/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    const json = await res.json();
    if (json.code !== 200) { clearSession(); return false; }
    setSession(toSession(json.data));
    scheduleProactiveRefresh();
    return true;
  } catch {
    return false; // 网络错误：本次不强制登出，下次请求再试
  }
}

export async function request<T>(path, options): Promise<T> {
  await ensureFreshToken();                    // 发前预检
  let res = await doFetch(path, options, getAccess());
  let json = await res.json();

  if (json.code === 401) {                     // AT 仍被判失效 → 补救一次
    const ok = await ensureFreshToken();
    if (ok) { res = await doFetch(path, options, getAccess()); json = await res.json(); }
  }
  if (json.code === 401) { clearSession(); throw new Error(json.message || "登录已失效"); }
  if (json.code !== 200) throw new Error(json.message);
  return json.data;
}
```

要点：

- **单飞**：`refreshPromise` 保证并发请求只触发一次 `/refresh`，避免 RT 被并发轮换成竞态。
- **发前预检 + 401 补救**双保险：覆盖“本地判断 AT 未过期但服务端已拒”的时钟偏移场景。
- **只重试一次**，避免死循环。

### 6.3 主动预续签定时器

```ts
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleProactiveRefresh() {
  if (timer) clearTimeout(timer);
  const delay = Math.max(getAccessExp() - Date.now() - SKEW_MS, 0);
  timer = setTimeout(() => void ensureFreshToken(), delay);
}
```

- 登录成功、每次刷新成功后重排。
- tab 长时间不活跃时定时器可能被节流，`ensureFreshToken` 的“发前预检”作为兜底。

### 6.4 `useAuth.ts`

- `login` / `register` 改为接收 `{ accessToken, refreshToken, expiresIn }`，调用 `setSession` 并 `scheduleProactiveRefresh`。
- `logout` 调 `POST /logout`（带 RT）后 `clearSession`。
- 应用启动读取 `writer_refresh`：若存在则 `scheduleProactiveRefresh`（并可立即预检一次）。

### 6.5 多标签同步（可选）

监听 `window.addEventListener("storage", ...)`：一个标签刷新/登出后，其它标签同步最新令牌或跟随登出，避免各标签用旧 RT 触发重放吊销。

---

## 7. 关键流程时序

### 7.1 登录

1. `POST /login` → 校验 → `issueTokens` 登记 RT 会话 → 返回 `{ AT, RT, expiresIn }`。
2. 前端 `setSession` + `scheduleProactiveRefresh`。

### 7.2 静默续签（无感）

1. 定时器在 `accessExp - 60s` 触发，或某请求发前预检发现 AT 临近过期。
2. `ensureFreshToken` 单飞调用 `/refresh`：验 RT → 命中会话 → 轮换（旧作废、发新对）→ 返回新令牌。
3. 前端更新 `tokenStore`，用户全程无感。

### 7.3 请求撞上过期（补救）

1. 请求带旧 AT → 服务端 `401 访问令牌已过期`。
2. 前端 `ensureFreshToken` 刷新成功 → 用新 AT **重试该请求一次** → 正常返回。

### 7.4 登出

1. `POST /logout { refreshToken }` → `revokeSession(jti)`。
2. 前端 `clearSession` → 回登录页。

### 7.5 RT 失效 / 重放

- RT 过期或被吊销 → `/refresh` 返回 401 → 前端强制登出。
- 旧 RT（已被轮换）被再次使用 → `getActiveSession` 未命中 → `revokeAllForUser` 吊销该用户所有会话（防令牌被盗后长期滥用）→ 强制登出。

---

## 8. 安全考量

- **一次性轮换**：每次刷新作废旧 RT，缩短单个 RT 的可用窗口。
- **重放检测**：旧 RT 复用即吊销全部会话，限制被盗令牌影响面。
- **只存哈希**：库中不存 RT/AT 明文。
- **AT 短时**：把“无状态无法即时吊销”的窗口从 7 天压到 15 分钟。
- **密钥分离**：AT/RT 用不同密钥，单边泄露不互相牵连。
- **存储风险**：`localStorage` 仍有 XSS 暴露面（现状即如此）。Tauri 环境可后续改用系统安全存储（如 `tauri-plugin-stronghold` 或 OS keychain）存 RT；Web 部署可考虑 RT 放 `HttpOnly` Cookie（但会引入 CORS/CSRF 与跨端差异，需另评估）。
- **时钟偏移**：前端预检 + 服务端 401 补救双重兜底，不依赖单侧时间准确。
- **并发**：单飞刷新避免并发轮换竞态。

---

## 9. 兼容与回滚

- **破坏性变更**：`/login`、`/register` 返回体由“字符串”变为“对象”。前端 `types/auth.ts`、`useAuth`、`http` 需同步；旧 `localStorage` 的 `writer_token` 失效，用户需重新登录一次（一次性）。
- **迁移**：`0003_refresh_token.sql` 先本地后远程（`wrangler d1 migrations apply`）。
- **回滚**：`/refresh`、`/logout` 为新增接口，回滚只需前端停用续签逻辑并恢复单令牌读取；数据库新增列可保留不影响旧逻辑。
- **灰度**：可先上线后端（保持 `/login` 同时返回 `accessToken` 与兼容旧 `token` 字段），前端切换后再移除兼容字段。

---

## 10. 实施步骤清单

后端：

1. `Env` 增加 `REFRESH_SECRET`；`.dev.vars` 与 `wrangler secret put` 配置。
2. 迁移 `0003_refresh_token.sql`（jti / revoked / rotated_to / last_used + 索引），本地应用。
3. `utils/token.ts`：抽 `signJwt`，新增 `createAccessToken` / `createRefreshToken` / `verifyAccess` / `verifyRefresh`；`ACCESS_TTL=15m`、`REFRESH_TTL=30d`。
4. 新增 `service/SessionService.ts`（create / getActive / rotate / revoke / revokeAllForUser，含 SHA-256 哈希）。
5. `AuthService.login/register` 改为 `issueTokens` 返回 `AuthTokens`。
6. `controller`：新增 `refresh` / `logout`；`login`/`register` 返回对象。
7. `route.ts`：注册公开 `POST /refresh`、`POST /logout`；`checkAuth` 改用 `verifyAccess`。
8. 远程迁移 + `wrangler deploy`。

前端：

9. `types/auth.ts`：`LoginResult` 改为 `{ accessToken, refreshToken, expiresIn }`。
10. `tokenStore.ts`：改存令牌对 + `accessExp`。
11. `http.ts`：`ensureFreshToken` 单飞、发前预检、401 补救重试、`scheduleProactiveRefresh`。
12. `api/auth.ts`：新增 `refresh`、`logout`。
13. `useAuth.ts`：登录/注册写入会话并排定预续签；登出调用 `/logout`；启动恢复会话。
14. （可选）多标签 `storage` 事件同步。
15. `npm run build` 验证。

---

## 11. 测试要点

- AT 过期后发请求：应自动续签并重试成功，用户无感。
- 并发多请求同时撞 AT 过期：只发生一次 `/refresh`（单飞）。
- RT 过期 / 被吊销：`/refresh` 401 → 强制登出。
- 旧 RT 重放：触发 `revokeAllForUser`，后续所有请求登出。
- 登出后旧 RT 不可再换 AT。
- 预续签定时器在 `accessExp - 60s` 触发。
- 断网时刷新失败不误登出，恢复后可继续。
- Tauri 与 Web 两端行为一致（均走 Bearer，无 Cookie 依赖）。

---

## 12. 建议参数

| 参数 | 建议值 | 位置 |
| --- | --- | --- |
| `ACCESS_TTL` | 15 分钟 | `back-end/src/utils/token.ts` |
| `REFRESH_TTL` | 30 天 | `back-end/src/utils/token.ts` |
| 预续签提前量 `SKEW_MS` | 60 秒 | `front-end/src/api/http.ts` |
| 401 补救重试次数 | 1 次 | `front-end/src/api/http.ts` |

> 以上时长可按产品需要调整；AT 越短越安全但刷新越频繁，15 分钟是常见折衷。

---

## 13. 实现偏差说明（2026-08 修订）

本文档 §8/§10 描述的"旧 RT 重放一律 `revokeAllForUser`"在实际实现中做了修正，以兼容多标签页/多设备并发刷新：

- **并发刷新不再误伤**：两个标签页同时用同一个 RT 刷新时，只有一个会轮换成功；失败方若发现该 jti 的会话已存在但被轮换（`findSession` 命中 `revoked=1`），仅返回 401 而不吊销全账号，客户端会用本地存储中最新的 RT 自动重试（前端另有 `navigator.locks` 跨标签页单飞降低该概率）。
- **真重放仍全吊销**：签名有效但 jti 在会话表中完全不存在（从未创建或已被清理）时，仍触发 `revokeAllForUser`。
- **客户端错误区分**：`http.ts` 会区分"RT 被拒（强制登出）"与"网络错误（保留会话重试）"，HTTP 状态码与业务 code 对齐后 401 路径依赖 envelope 而非 `res.ok`。
- 密码存储同步加固为 PBKDF2-SHA256（见 `back-end/src/utils/password.ts`），存量明文在首次登录时自动升级。
