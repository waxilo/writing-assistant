# WriterDemo

一个全栈写作助手示例项目，由 **Tauri + Vue 3** 桌面客户端和 **Cloudflare Workers + D1** 后端 API 组成。登录后进入书架，点击书籍进入两段式编辑页（左侧章节列表、右侧标题与正文编辑），支持手动保存与空闲自动保存。

## 功能

- 账号密码登录，**PBKDF2-SHA256 加盐哈希**存储密码（存量明文密码在首次登录时自动升级）；用户名 **3-32 字符、统一小写**（历史大写账号仍可通过小写登录）
- 双令牌认证：15 分钟 Access Token + 30 天 Refresh Token，刷新时轮换并检测重放；登录失败按账号 + IP 限速（15 分钟内 5 次锁定）
- 书架：展示当前用户的书籍，支持新建、删除、进入；进入书籍后可**双击书名**直接重命名
- 编辑页：左侧章节列表（新建、切换、删除、拖拽排序），右侧标题与正文编辑，两侧标题实时同步
- 保存机制：`Ctrl+S` 手动保存 + 停止输入后空闲自动保存；保存带 `version` 乐观锁
- **多会话并存**：网页端 / MCP / 多浏览器可同时在线，互不踢下线；并发写由章节与条目的乐观锁（version + 409）保证一致，冲突时字段级合并或明确提示
- 数据按用户隔离，越权访问返回 403；关窗/登出前自动 flush 未保存内容

## 技术栈

**前端 (`front-end/`)**
- [Tauri 2](https://tauri.app/) — 跨平台桌面应用外壳（Rust）
- [Vue 3](https://vuejs.org/) + [Vite 6](https://vitejs.dev/) + TypeScript
- HTTP 请求走 webview 原生 `fetch`（无需 Rust 插件），`spark-md5` 仅用于前端保存判重
- 测试：后端核心逻辑（token / 密码 / 校验）用 Node 内置 `node:test` 单测，`npm test`

**后端 (`back-end/`)**
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) — 边缘运行时（无 Web 框架，手写路由）
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — 基于 SQLite 的分布式数据库
- [Wrangler 4](https://developers.cloudflare.com/workers/wrangler/) — 开发与部署工具
- TypeScript

## 目录结构

```
WriterDemo/
├── back-end/                 # Cloudflare Workers API
│   ├── migrations/           # D1 数据库迁移脚本（0001-0005）
│   ├── src/
│   │   ├── controller/       # 请求处理与输入校验（login、book、chapter、user）
│   │   ├── service/          # 业务逻辑（Auth、Session、Book、Chapter、User）
│   │   ├── middleware/       # 认证中间件（Bearer 验签）
│   │   ├── utils/            # token、密码哈希（PBKDF2）、请求校验
│   │   ├── errors.ts         # ApiError（业务异常，携带 HTTP 状态）
│   │   ├── context.ts        # 每请求上下文 Ctx
│   │   ├── route.ts          # 路由分发（先校验路径形状再鉴权）
│   │   ├── response.ts       # 统一响应与 CORS
│   │   └── index.ts          # Worker 入口（密钥守卫、错误收口、请求日志）
│   └── wrangler.jsonc        # Worker / D1 配置
└── front-end/                # Tauri + Vue 桌面客户端
    ├── src/
    │   ├── api/              # HTTP 封装（静默续签/超时）、tokenStore 与接口定义
    │   ├── composables/      # useAuth / useBooks / useChapters / useConfirm / useToast
    │   ├── views/            # LoginView / BookshelfView / EditorView
    │   ├── components/       # BookCard / ChapterList / ChapterEditor / ToastHost
    │   ├── config/           # API 地址等常量
    │   └── types/            # TypeScript 类型
    └── src-tauri/            # Tauri (Rust) 工程
```

## 环境要求

- [Node.js](https://nodejs.org/) 20.19+（前端构建）；后端测试需要 **22.6+**（`node:test` 直接跑 TS）
- [Rust](https://www.rust-lang.org/tools/install)（构建 Tauri 客户端所需）
- [Cloudflare 账号](https://dash.cloudflare.com/) 与 Wrangler 登录（部署后端所需）

## 后端

```bash
cd back-end
npm install

# 类型检查（自动重新生成 worker-configuration.d.ts）
npm run typecheck

# 单元测试（token 验签 / 密码哈希 / 请求校验）
npm test

# 本地执行数据库迁移
npm run db:migrate:local

# 启动本地开发服务器（wrangler dev）
npm run dev

# 部署到 Cloudflare（先迁移再部署，见 deploy.ps1）
npm run db:migrate:remote
npm run deploy
```

### 环境变量（必须配置，否则所有接口返回 500）

签名 token 需要两把**独立**密钥（长度 ≥ 32 字符，`openssl rand -base64 48` 生成）：

| 变量 | 用途 |
| --- | --- |
| `TOKEN_SECRET` | Access Token 签名密钥 |
| `REFRESH_SECRET` | Refresh Token 签名密钥（与上者必须不同） |

- 本地开发：在 `back-end/.dev.vars` 写入两把密钥（该文件不入库）
- 线上：`wrangler secret put TOKEN_SECRET` / `wrangler secret put REFRESH_SECRET`

### 数据库

表结构见 `back-end/migrations/`：

- `0001_init.sql` — 用户表 `t_user` 与登录日志表 `t_login_log`（含示例账号）
- `0002_book_chapter.sql` — 书籍表 `t_book` 与章节表 `t_chapter`
- `0003_refresh_token.sql` — 刷新令牌会话（jti / 吊销 / 轮换）
- `0004_login_attempt.sql` — 登录失败计数（限流）
- `0005_chapter_stats.sql` — 章节字数冗余列（列表查询不再读正文）

> ⚠️ 初始示例账号 `admin/123456`、`zhangsan/123456` 是**公开的演示弱口令**，仅用于本地体验；上线前请删除或修改（`DELETE FROM t_user WHERE username IN ('admin','zhangsan')`）。密码在首次登录时会自动从明文升级为 PBKDF2 哈希。

### 接口约定

统一信封结构，**HTTP 状态码与业务 `code` 一致**（200/400/401/403/404/409/429/500）：

```json
{ "code": 200, "message": "ok", "data": {} }
```

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `POST` | `/login` | 用户名密码登录，返回 token 对 | 否 |
| `POST` | `/register` | 注册（密码 6-128 字符，自动登录） | 否 |
| `POST` | `/refresh` | 用 Refresh Token 换新 token 对（轮换） | 否 |
| `POST` | `/logout` | 吊销当前 Refresh Token 会话 | 否 |
| `GET` | `/me` | 当前用户信息 | 是 |
| `GET` | `/books` | 当前用户的书列表 | 是 |
| `POST` | `/books` | 新建书 | 是 |
| `PUT` | `/books/:id` | 重命名书 | 是 |
| `DELETE` | `/books/:id` | 删除书（级联删除章节） | 是 |
| `GET` | `/books/:bookId/chapters` | 某书的章节列表 | 是 |
| `POST` | `/books/:bookId/chapters` | 在书下新建章节 | 是 |
| `PUT` | `/books/:bookId/chapters` | 重排章节（body: `{ ids }`） | 是 |
| `GET` | `/chapters/:id` | 章节详情（含正文） | 是 |
| `PUT` | `/chapters/:id` | 保存章节（body 含 `baseVersion` 乐观锁） | 是 |
| `DELETE` | `/chapters/:id` | 删除章节 | 是 |

`userId` 由中间件从 token 解析，不接受前端传入。除公开接口（login/register/refresh/logout）外，所有路径先校验形状（非法路径返回 404）再鉴权（返回 401）。

## 前端

前端默认请求的 API 地址配置在 `front-end/src/config/index.ts`，请按需修改（本地开发通常指向 `wrangler dev` 输出的地址）。

> ⚠️ 换 API 域名时需**同步**修改三处，漏改任何一处都会导致桌面端请求被静默拦截：`front-end/src/config/index.ts` 的 `API_BASE_URL`、`front-end/src-tauri/tauri.conf.json` 的 CSP `connect-src`、`front-end/src-tauri/capabilities/default.json`（如后续恢复 http 插件权限）。

```bash
cd front-end
npm install

# 浏览器中运行 Vite 开发服务器
npm run dev

# 以桌面应用形式运行（Tauri 开发模式）
npm run tauri dev

# 构建桌面安装包
npm run tauri build
```

## 安全设计（已加固项）

- 密码：PBKDF2-SHA256（21 万次迭代）+ 每用户随机盐，登录恒时比对；防用户名枚举（账号不存在与密码错误返回同一消息）
- 令牌：AT/RT 双密钥、`typ` 声明隔离（AT 不能当 RT 用）、RT 库内只存 SHA-256 哈希、刷新轮换 + jti 条件更新防并发重放、密钥长度守卫
- 接口：全参数化 SQL、逐资源归属校验（403）、请求体/路径参数校验（400）、未知异常不向客户端泄露内部信息、结构化请求日志
- 前端：请求超时（20s）、401 自动续签重试、登出/关窗前同步 flush、Tauri CSP 与最小权限（仅 `core:default`）
- 多会话共存：登录/刷新各自独立会话（`t_login_log` 按 jti 隔离，互不吊销）；改密吊销该账号全部会话；写操作前置校验会话有效（401 防已注销会话继续写）

## 说明

本项目为演示用途，登录限流、密码哈希等已做基础加固，但仍**请勿直接用于生产环境**（生产还需：正式限流策略、审计日志、HTTPS 证书管理等）。
