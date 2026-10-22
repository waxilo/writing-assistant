# writing-assistant-mcp

写作助手 MCP server：让外部 AI（Claude Desktop、Cursor、Claude Code
等支持 MCP 的客户端）直接读写写作项目的**章节正文**与**设定资料库**——AI 可以
创建人物/地点/设定条目、修改章节内容、全书搜索等。数据与网页端完全一致
（同一套自托管 API）。

**分发方式**：构建产物作为 **GitHub Release 的 asset** 发布——`server.mjs`、`latest.json`
和两个安装脚本平铺在 `releases/latest/download/` 下，一条命令装好即可用。不经过
npm、不需要 npm 账号、装完不依赖网络（`login` 与调用 API 除外）。容器里另有一份
`/download/mcp/` 镜像，作为 GitHub 不通时的备用下载源。

## 安装（一条命令）

```powershell
# Windows（PowerShell）
irm https://github.com/waxilo/writing-assistant/releases/latest/download/install.ps1 | iex
```
```bash
# macOS / Linux
curl -fsSL https://github.com/waxilo/writing-assistant/releases/latest/download/install.sh | sh
```

- 地址是 **GitHub Release**（`releases/latest/download` 下的所有 asset 平铺同一前缀，
  正是脚本期望的目录结构），任何一台能上网的机器都能直接粘这段命令
- 默认装到 `~/.writing-assistant-mcp/server.mjs`（Windows 为 `%USERPROFILE%\.writing-assistant-mcp\server.mjs`）
- 脚本会校验 sha256、检查 node，并直接把**可粘贴的 MCP 配置**打印出来
- 重复执行是幂等的：已是最新版本就只打印配置，不重新下载
- **国内网络访问 GitHub 慢/不通时换镜像**（同一批文件，容器托管）：
  - `https://writer.sloan.dpdns.org/download/mcp`（公网域名）
  - `http://127.0.0.1:7001/download/mcp`（容器同机）
  - Windows：`$env:WRITER_MCP_BASE="https://writer.sloan.dpdns.org/download/mcp"; irm "$env:WRITER_MCP_BASE/install.ps1" | iex`
  - macOS/Linux：`WRITER_MCP_BASE=https://writer.sloan.dpdns.org/download/mcp sh install.sh`

装完先登录一次（凭证存 `~/.writer-mcp.json`，600 权限）：

```bash
node ~/.writing-assistant-mcp/server.mjs login
```

## 接入 AI 客户端

安装脚本最后会打印下面这段，直接粘进对应配置即可（把路径换成脚本打印的那个）：

```json
{
  "mcpServers": {
    "writing-assistant": {
      "command": "node",
      "args": ["C:\\Users\\<你>\\.writing-assistant-mcp\\server.mjs"]
    }
  }
}
```

| 客户端 | 位置 |
|---|---|
| Claude Desktop | 菜单 → Settings → Developer → Edit Config（`claude_desktop_config.json`），改完重启 |
| Cursor | Settings → MCP → Add new MCP server → `command` 类型 |
| Claude Code（CLI） | `claude mcp add writing-assistant -- node ~/.writing-assistant-mcp/server.mjs` |

> 若客户端报"找不到 node"，是因为 GUI 应用的环境 PATH 不含 node 所在目录——终端执行
> `which node`（Windows：`where node`）拿到绝对路径，把配置里的 `command` 换成它。

## 更新

重跑同一条安装命令即可（幂等，已最新会跳过下载）。

server 启动时也会向 `releases/latest/download/latest.json` 查一次版本，落后时在
**stderr** 提示更新命令（MCP 协议走 stdout，不会被污染）。

## 工具清单

| 工具 | 说明 |
|---|---|
| `list_books` | 列出书籍 |
| `list_chapters` / `read_chapter` | 章节列表 / 读全文 |
| `create_chapter` / `update_chapter` / `delete_chapter` | 新建 / 修改 / 删除章节 |
| `search_chapters` | 全书关键字搜索（按章匹配数） |
| `list_entries` / `read_entry` | 设定条目列表（人物/地点/设定）/ 读条目 |
| `create_entry` / `update_entry` / `delete_entry` | 设定条目增改删 |

## API 地址怎么选

| 场景 | 地址 |
|---|---|
| 默认 | 不用设，内置 `https://writer.sloan.dpdns.org/api`（经共享网关，任何机器可用） |
| 与容器同机（少一跳） | `WRITER_API_BASE=http://127.0.0.1:7001/api`（不依赖公网 DNS，隧道挂了也不影响 AI 工具） |
| 局域网另一台机器 | `http://192.168.x.x:7001/api`（需把 `.env` 的 `APP_BIND_ADDR` 改成 `0.0.0.0`） |

- **末尾的 `/api` 不能省**：容器只在 `/api/*` 下提供接口，其他 GET 路径会被当成前端路由返回网页（写请求反而正常），少这个后缀的症状是"能保存但列表永远是空的"。漏了会在 `login` 时提示并自动补上。
- **地址随凭证保存**（`~/.writer-mcp.json` 里的 `apiBase`），换地址要重新 `login`。
- 默认值是公网入口而不是 `127.0.0.1`：单文件可能被装到任意一台机器上，回环地址只对同机成立。

## 为什么不再走 npm

原先发 `writer-demo-mcp` / `writing-assistant-mcp` 到 registry，代价是：发布要 npm 账号 +
2FA OTP、安装端要能访问 registry、版本一多还得处理镜像源。现在改成「构建产物挂 GitHub Release」：

- 发布 = `mcp/build.mjs` 打成单文件，`git tag mcp-v*` 触发工作流把 `dist/` 里的 4 个文件
  上传成该 release 的 asset（也可手工上传）
- 安装 = 从 `releases/latest/download/` 取文件，sha256 校验后落地
- 不依赖 npm 账号；容器另存一份 `/download/mcp` 作镜像，GitHub 不通时兜底
- **前提：仓库必须是 public**——private 仓库的 release asset 要带 token 才能下，脚本和 AI 都拿不到

## 维护者：打包与验证

```bash
cd mcp
npm ci
npm run build          # → dist/server.mjs + dist/latest.json + 两个安装脚本
```

发版：`git tag mcp-v0.2.0 && git push origin mcp-v0.2.0`——`.github/workflows/release-mcp.yml`
会重建 dist 并把 4 个文件上传到该 tag 的 release。

- `build.mjs` 会交叉校验 `package.json` 的 `version` 与 `server.mjs` 里的 `VERSION` 常量，
  不一致直接失败（否则会出现"提示更新却下载到同一版本"）
- 产物 1.1 MB、零 `node_modules`；`latest.json` 含 `sha256`/`size`，安装脚本据此校验
- 四个 asset 必须**同时**属于同一个 release：`latest.json` 里的 `sha256` 和 `server.mjs`
  是绑死的，混版本会让安装脚本直接校验失败
- Dockerfile 的 `mcp` 阶段做同样的事并复制到 `public/download/mcp`，由
  `back-end/src/server.ts` 的 `serveStatic` 直接对外（`.mjs`/`.ps1`/`.sh` 的 MIME 在
  `server.ts` 的 `MIME` 表里；脚本必须是 `text/plain; charset=utf-8`）
- `install.ps1` **必须保持纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的 UTF-8 按系统
  ANSI 解码，`irm ... | iex` 会因此报"字符串缺少终止符"
- GitHub 把 asset 的 Content-Type 打成 `application/octet-stream`，`Invoke-RestMethod`
  不会按 JSON 解析，所以 `install.ps1` 里改成「取文本 + `ConvertFrom-Json`」

## 注意事项

1. **凭证安全**：`~/.writer-mcp.json` 含登录令牌（refresh token 30 天有效），
   请勿分享或提交该文件。删除它即可让 MCP 失效。
2. **写操作会让网页端下线**：应用采用"单活跃会话抢占"——AI 执行**写操作**（修改章节/设定）时，
   网页端会被要求重新登录。只读操作不影响。
3. **token 自动续期**：server 运行期间 access token 过期会自动刷新，无需重新登录；
   只有 refresh token 也失效时才需要重跑 `login`。
4. **修改正文是整体替换**：`update_chapter` 的 `content` 是全文覆盖语义；
   AI 客户端应先用 `read_chapter` 读取再修改（server 已自动处理版本冲突）。
5. 标题语法：正文中行首 `# `（1-6 个 #）会被渲染为章节标题层级。
