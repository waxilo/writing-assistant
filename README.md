# writing-assistant（写作助手）

一个全栈写作助手项目，由 **Tauri + Vue 3** 客户端和 **Node + MySQL** 后端 API 组成。登录后进入书架，点击书籍进入两段式编辑页（左侧章节列表、右侧标题与正文编辑），支持手动保存与空闲自动保存。

前后端打包进**同一个 Docker 容器**：Node 进程同时提供 API（`/api/*`）和构建后的静态页面，同源同端口；数据库复用本机通用的 `mysql-server` 容器，在其中为本项目单独建库。

## 功能

- 账号密码登录，**PBKDF2-SHA256 加盐哈希**存储密码（存量明文密码在首次登录时自动升级）；用户名 **3-32 字符、统一小写**（历史大写账号仍可通过小写登录）
- 双令牌认证：15 分钟 Access Token + 30 天 Refresh Token，刷新时轮换并检测重放；登录失败按账号 + IP 限速（15 分钟内 5 次锁定）
- 书架：展示当前用户的书籍，支持新建、删除、进入；进入书籍后可**双击书名**直接重命名
- 编辑页：左侧章节列表（新建、切换、删除、拖拽排序），右侧标题与正文编辑，两侧标题实时同步
- 写作辅助：分卷（卷内章节可移动）、设定库（人物 / 地点 / 概念条目）、全书搜索与批量替换、全书大纲、章节历史版本（每章保留最近 5 次保存前快照）
- 保存机制：`Ctrl+S` 手动保存 + 停止输入后空闲自动保存；保存带 `version` 乐观锁
- **多会话并存**：网页端 / MCP / 多浏览器可同时在线，互不踢下线；并发写由章节与条目的乐观锁（version + 409）保证一致，冲突时字段级合并或明确提示
- 数据按用户隔离，越权访问返回 403；关窗/登出前自动 flush 未保存内容

## 技术栈

**前端 (`front-end/`)**
- [Tauri 2](https://tauri.app/) — 跨平台桌面应用外壳（Rust）
- [Vue 3](https://vuejs.org/) + [Vite 6](https://vitejs.dev/) + TypeScript
- HTTP 请求走 webview 原生 `fetch`（无需 Rust 插件），`spark-md5` 仅用于前端保存判重

**后端 (`back-end/`)**
- [Node.js](https://nodejs.org/) 24 — `node:http` 收到请求后适配成 Web `Request`/`Response`，业务代码沿用无框架的手写路由，不含任何云厂商 API
- [MySQL 8](https://dev.mysql.com/) — 通用关系库，通过兼容 D1 语句接口（`prepare().bind().all/first/run()`）的驱动层访问
- [esbuild](https://esbuild.github.io/) — 把服务端打成单文件 `dist/server.js`
- TypeScript
- 测试：核心逻辑（token / 密码 / 校验）用 Node 内置 `node:test` 单测，`npm test`

**部署**
- [Docker](https://www.docker.com/) + Docker Compose — 多阶段构建出一个含前端静态文件与 API 的镜像
- GitHub Actions 只做门禁（类型检查 / 单测 / 前端构建 / 镜像构建），不推送、不部署

## 目录结构

```
writing-assistant/
├── Dockerfile                # web 构建 + api 构建 → 单一运行镜像
├── docker-compose.yml        # 挂进 mysql-server 与 gw_default 两个共享网络，端口默认只绑 127.0.0.1
├── .env                      # 运行时配置（不入库；由 db-init.sh 生成）
├── scripts/
│   ├── db-init.sh            # 一次性：建库 + 专用账号 + 建表 + 生成 .env
│   ├── deploy.sh             # 日常部署：本地门禁 → 构建镜像 → 起容器 → 健康检查
│   ├── gw-join.sh            # 可选：把本项目接入共享公网入口 ../gw
│   └── d1-to-mysql.mjs       # 历史归档：把旧 D1 数据导入 MySQL（含逐行回读校验）
├── back-end/                 # Node API
│   ├── db/schema.mysql.sql   # 全部建表语句（合并自原 D1 迁移）
│   ├── src/
│   │   ├── controller/       # 请求处理与输入校验（login、book、chapter、writer、entry、user）
│   │   ├── service/          # 业务逻辑（Auth、Session、Book、Chapter、Volume、Entry、WriteLog、User）
│   │   ├── db/mysql.ts       # mysql2 连接池 + D1 风格语句适配
│   │   ├── middleware/       # 认证中间件（Bearer 验签）
│   │   ├── utils/            # token、密码哈希（PBKDF2）、请求校验
│   │   ├── errors.ts         # ApiError（业务异常，携带 HTTP 状态）
│   │   ├── context.ts        # 每请求上下文 Ctx
│   │   ├── route.ts          # 路由分发（先校验路径形状再鉴权）
│   │   ├── response.ts       # 统一响应与 CORS
│   │   ├── index.ts          # 请求处理入口（密钥守卫、错误收口、请求日志）
│   │   └── server.ts         # Node 监听：/api 反代到 handler、/health、静态文件与 SPA 回退
├── front-end/                # Tauri + Vue 客户端
│   ├── src/
│   │   ├── api/              # HTTP 封装（静默续签/超时）、tokenStore 与接口定义
│   │   ├── composables/      # useAuth / useBooks / useChapters / useConfirm / useToast
│   │   ├── views/            # LoginView / BookshelfView / EditorView
│   │   ├── components/       # BookCard / ChapterList / ChapterEditor / ToastHost
│   │   ├── config/           # API 地址等常量
│   │   └── types/            # TypeScript 类型
│   └── src-tauri/            # Tauri (Rust) 工程
└── mcp/                      # 供 AI 客户端调用的 MCP server（同一套自托管 API）
```

## 环境要求

- [Docker](https://www.docker.com/)（含 Compose 插件）— 部署与本地联调
- [Node.js](https://nodejs.org/) 24（后端开发/测试）；前端构建需 20.19+
- [Rust](https://www.rust-lang.org/tools/install)（仅构建 Tauri 桌面安装包时需要）
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)（可选，只有 ../gw 的一次性初始化要在宿主机上跑；网关容器内已自带）
- 一个可用的 MySQL 8 服务：本项目默认复用同级的 `mysql-server` 容器（`../mysql-server`），并在其中创建**专用数据库与专用账号**，不共用其他项目的库

## 部署（本机 Docker）

```bash
# 0) 数据库容器要先跑起来
../mysql-server/scripts/start.sh

# 1) 一次性初始化：建库 writing_assistant + 专用账号 + 建表 + 生成 .env
./scripts/db-init.sh

# 2) 构建并启动（容器内监听 80，宿主发布 127.0.0.1:7001）
docker compose up -d --build

# 或者一步到位（先跑本地门禁再 build + up + 健康等待）
./scripts/deploy.sh

# 验证
curl -s http://127.0.0.1:7001/health     # {"status":"ok","database":true}
```

打开 <http://127.0.0.1:7001> 即是网页版；API 在 `http://127.0.0.1:7001/api`。要让局域网其他设备访问，把 `.env` 里的 `APP_BIND_ADDR` 改成 `0.0.0.0` 后重新 `docker compose up -d`。

数据库结构变更：改 `back-end/db/schema.mysql.sql`，再对目标库执行相应 `ALTER`（新库直接跑该文件）。

### 公网访问（共享网关 gw，可选）

当前实例：<https://writer.sloan.dpdns.org>。

入口**不在本项目里**，而在同级的共享项目 [`../gw`](../gw/README.md)：一个容器里同时跑
cloudflared（拨到 Cloudflare 边缘，本机不开任何入站端口、TLS 在边缘终结）和 nginx（按 `Host`
头分发给 `gw_default` 网络上的应用容器）。和 `../mysql-server` 是同一套思路——应用只挂网络，
不各自养隧道。

隧道带的是 `*.sloan.dpdns.org` **通配**记录，所以新增域名只在网关本地加一个 nginx vhost，
Cloudflare 侧零操作（不需要 `cloudflared tunnel route dns`，也不需要改 ingress）。

```bash
# 每台机器一次：建隧道 + 通配 DNS 记录 + 共享网络，然后起网关容器
cd ../gw && ./scripts/gw-init.sh && docker compose up -d && cd -

# 本项目一次（可重复执行）：挂上 gw_default + .env 置 TRUST_PROXY=1 + 生成 vhost
./scripts/gw-join.sh

docker logs -f gw             # 公网 530 / 502 时看这里
```

之后 `./scripts/deploy.sh` 和 `docker compose up -d --build` 都不必再关心入口。

注意点：

- **`TRUST_PROXY=1` 与隧道是绑定的**。不开隧道却把 `APP_BIND_ADDR` 改成 `0.0.0.0`，局域网里任何设备都能伪造 `X-Forwarded-For`，绕过按 IP 的登录限速；`server.ts` 正是用这个头合成 `CF-Connecting-IP`。
- **vhost 里只能写容器名**（`writing-assistant:80`），不能写 `127.0.0.1`——那是网关容器自己的回环。也故意不用 `app` 这个 compose 服务名，共享网络里别的项目若也有 `app` 会撞同一个 DNS 名。
- **上传上限两端要对齐**：网关的 `client_max_body_size 64m`（`../gw/conf.d/writer.conf`）对应 `server.ts` 的 `MAX_BODY_BYTES = 64 MiB`，改一边就得改另一边，否则应用还没看到请求体就被 nginx 413。
- **应用只发布在 `127.0.0.1:7001`**（容器内监听 `80`）：桌面版与 mcp 这类本机调用方都直连这个发布端口，不再认识自己的公网域名——域名归网关管，网关加第二个 zone 应用侧零改动；公网入口只有网关这一条，供浏览器访问。
- 传输协议在 `../gw/cloudflared/config.yml` 固定为 `protocol: http2`：QUIC/UDP 7844 走本机代理时曾把 4 条连接同时打挂，连接器随之退出、公网 530 约两分钟。

撤销公网访问：删掉 `../gw/conf.d/writer.conf` 并 `docker exec gw nginx -s reload`（未登记的 Host 会被网关直接 404）；要连整个 zone 的入口一起撤，就删 `gw` 隧道（私钥随隧道作废）。

AI 工具（`mcp/`）默认走容器在本机发布的回环端口 `http://127.0.0.1:7001/api`（见 `mcp/server.mjs` 的 `DEFAULT_API_BASE`），可用 `WRITER_API_BASE` 覆盖（例如在别的机器上指向公网域名）。地址规则见 `mcp/README.md`。

## 后端

```bash
cd back-end
npm install

# 类型检查
npm run typecheck

# 单元测试（token 验签 / 密码哈希 / 请求校验）
npm test

# 打成 dist/server.js 并前台运行（需先有 .env）
npm run dev

# 只构建
npm run build

# 生产启动（容器内用的就是这个）
npm start
```

### 环境变量

`scripts/db-init.sh` 会生成仓库根的 `.env`（已存在则不覆盖，避免重置密钥把所有人踢下线）。容器通过 `env_file` 读取它。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` | 是 | 数据库地址。容器内是 `mysql` / `3306`（compose 网络里的服务名）；宿主机直连用 `127.0.0.1` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 是 | 专用库名、专用账号与口令（权限只限该库） |
| `TOKEN_SECRET` | 是 | Access Token 签名密钥，≥ 32 字符 |
| `REFRESH_SECRET` | 是 | Refresh Token 签名密钥，≥ 32 字符且**必须与上者不同** |
| `PORT` / `HOST` | 否 | 容器内监听端口（compose 里设 `80`，源码兜底 `8787`）与地址（默认 `0.0.0.0`） |
| `STATIC_DIR` | 否 | 静态目录，默认 `./public` |
| `TRUST_PROXY` | 否 | 设为 `1` 时才信任 `X-Forwarded-For` 取客户端 IP（登录限速用）。走公网入口时必须为 `1`，`gw-join.sh` 会写入 |
| `APP_BIND_ADDR` / `APP_PORT` | 否 | 仅 compose 用：宿主绑定地址与端口，默认 `127.0.0.1:7001`（容器内监听 `80`，宿主 `80/443` 归 gw） |

缺少任一项服务会直接启动失败（快速失败优于所有接口 500）。

### 数据库

`back-end/db/schema.mysql.sql` 建 9 张表（InnoDB / utf8mb4）：

| 表 | 用途 |
| --- | --- |
| `t_user` | 账号（密码为 `pbkdf2$迭代数$盐$哈希`） |
| `t_login_log` | Refresh Token 会话（jti / 吊销 / 轮换链） |
| `t_login_attempt` | 登录失败计数（限流，短期数据） |
| `t_book` / `t_volume` / `t_chapter` | 书 / 分卷 / 章节（章节冗余字数与 `version`） |
| `t_chapter_history` | 保存前快照，每章最多 5 条 |
| `t_entry` | 设定库条目（character / location / concept） |
| `t_write_log` | 按天净增字数（写作热力图） |

几条与 SQLite 时代对齐的约定，改表时请保持：

- 列名与 D1 完全一致，业务 SQL 两边通用；时间列是 **UTC 文本 / `DATETIME`**，服务端会话时区固定为 `+00:00`（不依赖容器时区）
- 主键用 `BIGINT AUTO_INCREMENT`（对应 D1 的 8 字节 INTEGER）
- `content` 这类 `TEXT` 列**必须带表达式默认值** `DEFAULT ('')`（MySQL 不允许 BLOB/TEXT 用普通 `DEFAULT ''`），否则 `createChapter` 只插 `book_id/title/sort_order` 会报 1364
- 不再预置示例账号；`admin/123456`、`zhangsan/123456` 那类公开弱口令只存在于旧的 D1 演示库里，迁移脚本默认把它们连同其数据一并丢弃（`--keep-demo-accounts` 可保留）

### 数据来源：从 Cloudflare D1 迁过来（已完成）

本库的首批数据来自旧的 D1 部署，`scripts/d1-to-mysql.mjs` 记录了过程（脚本头部的三步命令仍可重复执行）：导出 → 离线转换 → `--apply` 写入并逐表逐字段回读比对。要点：

- 导出文件是 SQLite 方言 SQL，正文里的换行被写成 `replace('…\n…', '\n', char(10))`；脚本把 dump 交给真实 SQLite 求值后再取值，而不是自己解析字符串，因此正文不会被转义规则坑掉
- 主键原样保留（`book_id`/`chapter_id` 关系不变），导入后重设 `AUTO_INCREMENT`
- 0001_init.sql 预置的演示账号（`admin`、`zhangsan`）连同它们的数据一起被丢弃（`--keep-demo-accounts` 可保留）
- 2026-09-26 完成迁移：81 行，全部字段回读一致

### 接口约定

统一信封结构，**HTTP 状态码与业务 `code` 一致**（200/400/401/403/404/409/429/500）：

```json
{ "code": 200, "message": "ok", "data": {} }
```

容器同源部署时 API 挂在 `/api` 前缀下（`server.ts` 去掉前缀后交给路由），下表路径均为**去掉 `/api` 后**的路径。

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `GET` | `/health`（或 `/api/health`） | 存活 + 数据库连通性探测 | 否 |
| `POST` | `/login` | 用户名密码登录，返回 token 对 | 否 |
| `POST` | `/register` | 注册（密码 6-128 字符，自动登录） | 否 |
| `POST` | `/refresh` | 用 Refresh Token 换新 token 对（轮换） | 否 |
| `POST` | `/logout` | 吊销当前 Refresh Token 会话 | 否 |
| `GET` | `/me` | 当前用户信息 | 是 |
| `PUT` | `/me/password` | 修改密码（吊销该账号全部会话） | 是 |
| `GET` / `POST` | `/books` | 书列表 / 新建书 | 是 |
| `PUT` / `DELETE` | `/books/:id` | 重命名 / 删除书（级联删除章节） | 是 |
| `GET` / `POST` / `PUT` | `/books/:bookId/chapters` | 章节列表 / 新建 / 重排（body: `{ ids }`） | 是 |
| `GET` | `/books/:bookId/search?q=` | 全书关键字搜索（按章聚合命中数） | 是 |
| `GET` | `/books/:bookId/outline` | 全书大纲（各章标题层级） | 是 |
| `POST` | `/books/:bookId/replace` | 全书批量替换（body: `{ from, to }`） | 是 |
| `GET` / `POST` | `/books/:bookId/volumes` | 分卷列表 / 新建 | 是 |
| `GET` / `POST` / `PUT` | `/books/:bookId/entries` | 设定条目列表 / 新建 / 重排（query 或 body: `type`） | 是 |
| `PUT` / `DELETE` | `/volumes/:id` | 重命名 / 删除分卷 | 是 |
| `GET` | `/chapters/:id` | 章节详情（含正文） | 是 |
| `PUT` | `/chapters/:id` | 保存章节（body 含 `baseVersion` 乐观锁） | 是 |
| `DELETE` | `/chapters/:id` | 删除章节 | 是 |
| `PUT` | `/chapters/:id/volume` | 移动章节到某卷（`volumeId: null` 取消分卷） | 是 |
| `GET` | `/chapters/:id/history`、`/chapters/:id/history/:hid` | 历史版本列表 / 某一版内容 | 是 |
| `GET` / `PUT` / `DELETE` | `/entries/:id` | 条目详情 / 更新（带 `baseVersion`）/ 删除 | 是 |

`userId` 由中间件从 token 解析，不接受前端传入。除公开接口（login/register/refresh/logout/health）外，所有路径先校验形状（非法路径返回 404）再鉴权（返回 401）。

## 前端

网页版与 API 同源，因此浏览器构建默认请求 `/api`（用哪个域名打开都自适应）；Tauri 桌面版没有同源可用，直连容器在本机发布的回环端口上的同一个 `/api` 挂载 `http://127.0.0.1:7001/api`——域名只归网关管，本机调用方不再认识它（离开这台机器即不可用，是刻意的）。逻辑在 `front-end/src/config/index.ts`，可用 `VITE_API_BASE_URL` 覆盖。

桌面版走的是 `http://127.0.0.1:7001`，`src-tauri/tauri.conf.json` 的 CSP `connect-src` 已放行该地址；若换成别的地址（公网域名、LAN 直连等），记得同步把那个 origin 加进 `connect-src`，否则请求会被 webview 拦掉。改完需重新构建桌面端才生效。

```bash
cd front-end
npm install

npm run dev          # Vite 开发服务器；/api 代理到 127.0.0.1:7001（可用 VITE_DEV_API_TARGET 改）
npm run build        # vue-tsc 类型检查 + 产物
npm run tauri dev    # 桌面应用开发模式
npm run tauri build  # 桌面安装包
```

> ⚠️ 换 API 地址时需**同步**三处，漏改任何一处都会让桌面端请求被静默拦截：`VITE_API_BASE_URL`（或 `src/config/index.ts` 默认值）、`src-tauri/tauri.conf.json` 的 CSP `connect-src`、`src-tauri/capabilities/default.json`（如后续恢复 http 插件权限）。

## 持续集成

`.github/workflows/ci.yml` 一条流水线做三件事：后端 `typecheck` + 单测 + esbuild 打包、前端 `npm run build`（含 `vue-tsc`）、`docker build` 出镜像验证 Dockerfile 可用。**不推送镜像、不部署**——部署始终是宿主机上的 `docker compose up -d --build`。

## 安全设计（已加固项）

- 密码：PBKDF2-SHA256（21 万次迭代）+ 每用户随机盐，登录恒时比对；防用户名枚举（账号不存在与密码错误返回同一消息）。迭代次数写在每个哈希串里并按串校验，所以从 1 万上调到 21 万不影响存量账号（它们仍按自己的成本通过校验，改密时升档）
- 令牌：AT/RT 双密钥、`typ` 声明隔离（AT 不能当 RT 用）、RT 库内只存 SHA-256 哈希、刷新轮换 + jti 条件更新防并发重放、启动时密钥长度守卫
- 接口：全参数化 SQL、逐资源归属校验（403）、请求体/路径参数校验（400）、未知异常不向客户端泄露内部信息、结构化请求日志
- 静态托管：路径拼接前规范化并限制在 `STATIC_DIR` 内，越界只回 SPA `index.html`；密钥只存在于 `.env`（`.dockerignore` 排除，不进镜像层）
- 前端：请求超时（20s）、401 自动续签重试、登出/关窗前同步 flush、Tauri CSP 与最小权限（仅 `core:default`）
- 多会话共存：登录/刷新各自独立会话（`t_login_log` 按 jti 隔离，互不吊销）；改密吊销该账号全部会话；写操作前置校验会话有效（401 防已注销会话继续写）
- 网络暴露：容器端口只绑 `127.0.0.1`，不对局域网开放；对外只有 Cloudflare Tunnel 一条入向路径（连接器主动出网，不开任何监听端口，TLS 在边缘终结）。注意 `TRUST_PROXY=1` 时 `X-Forwarded-For` 可被直连者伪造，所以「改 `APP_BIND_ADDR=0.0.0.0` 暴露局域网」与「开隧道」二选一，别同时做

## 说明

登录限流、密码哈希等已做基础加固，但项目仍不带 HTTPS 终结、正式限流与审计能力；若要公网开放，请在前置反代处理 TLS 与真实客户端 IP（并设置 `TRUST_PROXY=1`）。

### 命名说明

项目原名 `WriterDemo`，仓库与包名已统一为 `writing-assistant`。数据已于 2026-09-26 完整迁出，Cloudflare 上对应本项目的资源（Worker `api` 及其域名 `api.sloan.dpdns.org`、Pages 项目 `writer-demo-web` 及其域名 `sloan.dpdns.org`、D1 库 `writer-demo`）已全部删除，仓库里也不再有 `wrangler.jsonc`、`migrations/` 和 wrangler 依赖。只剩一处旧名：

| 位置 | 标识 | 含义 |
| --- | --- | --- |
| `mcp/` 的凭证路径 | `~/.writer-mcp.json`、`WRITER_MCP_CONFIG` | 指向用户机器上已存在的凭证文件，改名等于要求所有人重新 `login` |

迁移前的唯一备份是 `back-end/.d1-export/dump.sql`（已 gitignore，内含密码哈希），云端那份已随 `writer-demo` 一起删除；本地文件已确认导入正确（81 行逐字段比对通过），需要长期留存的请自行归档。

MCP 的 npm 包已更名为 `writing-assistant-mcp`（原 `writer-demo-mcp` 停止发布）：老用户需 `npm install -g writing-assistant-mcp`、更新 AI 客户端里的配置，并**重新 `login`**——旧凭证里的地址指向已下线的 Worker，且新后端换了签名密钥。详见 `mcp/README.md`。
