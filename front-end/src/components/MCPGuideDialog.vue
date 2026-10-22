<script setup lang="ts">
import BaseDialog from "./dialog/BaseDialog.vue";
import CodeBlock from "./CodeBlock.vue";
import { MCP_DOWNLOAD_BASE } from "../config";

/**
 * MCP 接入教程弹层：教用户把写作助手接入外部 AI（Claude Desktop / Cursor）。
 * 内容静态，从顶部栏"AI 接入"入口打开。
 *
 * MCP server 不再走 npm：构建产物作为 GitHub Release 的 asset 发布，安装脚本
 * （install.ps1 / install.sh）和 server.mjs、latest.json 平铺在
 * `releases/latest/download/` 下，一条命令下载安装即可（见 mcp/build.mjs 与
 * mcp/README.md）。命令里的地址固定写 GitHub（MCP_DOWNLOAD_BASE）——用户可能在
 * 另一台机器上粘贴这条命令，写页面来源或 127.0.0.1 都只在本机能用。
 */
const emit = defineEmits<{ (e: "close"): void }>();

const INSTALL_WINDOWS = `irm ${MCP_DOWNLOAD_BASE}/install.ps1 | iex`;
const INSTALL_UNIX = `curl -fsSL ${MCP_DOWNLOAD_BASE}/install.sh | sh`;

const LOGIN_WINDOWS = `node "$HOME\\.writing-assistant-mcp\\server.mjs" login`;
const LOGIN_UNIX = `node ~/.writing-assistant-mcp/server.mjs login`;

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "writing-assistant": {
      "command": "node",
      "args": ["C:\\\\Users\\\\你的用户名\\\\.writing-assistant-mcp\\\\server.mjs"]
    }
  }
}`;
const CURSOR_CONFIG = `command: node
args: C:\\Users\\你的用户名\\.writing-assistant-mcp\\server.mjs`;
const CLAUDE_CODE = `claude mcp add writing-assistant -- node ~/.writing-assistant-mcp/server.mjs`;
</script>

<template>
  <BaseDialog
    :visible="true"
    :close-on-mask="false"
    :panel-width="680"
    @close="emit('close')"
  >
    <div class="guide">
      <h3 class="guide-title">🤖 AI 接入（MCP）</h3>
      <p class="guide-intro">
        通过 MCP 协议，让 <b>Claude Desktop / Cursor / Claude Code</b> 等 AI
        客户端直接读写你的书——AI 可以帮你创建设定、润色正文、全书搜索。
        只需下载一个文件，<b>不需要 npm，也不需要 npm 账号</b>。
      </p>

      <h4 class="guide-step">① 安装（在电脑终端执行一条命令）</h4>
      <p class="guide-client">Windows（PowerShell）</p>
      <CodeBlock :code="INSTALL_WINDOWS" single />
      <p class="guide-client">macOS / Linux</p>
      <CodeBlock :code="INSTALL_UNIX" single />
      <p class="guide-note">
        脚本会下载单文件到 <code>~/.writing-assistant-mcp/</code>、校验 sha256、
        检查 Node 版本，最后把可直接粘贴的客户端配置打印出来。需要
        <b>Node.js 20+</b>（跑 <code>node -v</code> 确认）。
      </p>
      <p class="guide-note">
        命令里的地址是 <b>GitHub Release</b>（所有文件平铺在
        <code>releases/latest/download/</code>），换一台机器照样能用。国内网络访问
        GitHub 慢或不通时，把下载源换成自建镜像
        <code>https://writer.sloan.dpdns.org/download/mcp</code>——Windows 先设
        <code>$env:WRITER_MCP_BASE</code>，macOS/Linux 用
        <code>WRITER_MCP_BASE=… sh install.sh</code>；容器同机时还可用
        <code>http://127.0.0.1:7001/download/mcp</code>。
      </p>
      <p class="guide-note">
        升级就<b>重跑同一条命令</b>：已是最新版本会跳过下载，只重新打印配置。
      </p>

      <h4 class="guide-step">② 登录账号（只需一次）</h4>
      <p class="guide-client">Windows（PowerShell）</p>
      <CodeBlock :code="LOGIN_WINDOWS" single />
      <p class="guide-client">macOS / Linux</p>
      <CodeBlock :code="LOGIN_UNIX" single />
      <p class="guide-note">
        输入写作助手的账号密码，凭证保存在 <code>~/.writer-mcp.json</code>
        （仅本人可读），access token 过期会自动续期。
      </p>
      <p class="guide-note">
        默认连公网入口 <code>https://writer.sloan.dpdns.org/api</code>，任何机器可用；
        若 MCP 与容器在同一台机器、想少一跳，登录前设
        <code>WRITER_API_BASE=http://127.0.0.1:7001/api</code>（地址随凭证保存，
        换地址要重新登录）。
      </p>

      <h4 class="guide-step">③ 配置你的 AI 客户端</h4>

      <p class="guide-client">Claude Desktop</p>
      <p class="guide-note">
        菜单 → Settings → Developer → Edit Config，在
        <code>claude_desktop_config.json</code> 中加入（路径用安装脚本打印的那一行）：
      </p>
      <CodeBlock :code="CLAUDE_CONFIG" />

      <p class="guide-client">Cursor</p>
      <p class="guide-note">Settings → MCP → Add new MCP server → command 类型：</p>
      <CodeBlock :code="CURSOR_CONFIG" />

      <p class="guide-client">Claude Code（命令行）</p>
      <CodeBlock :code="CLAUDE_CODE" single />

      <h4 class="guide-step">④ 开始使用</h4>
      <p class="guide-note">
        重启客户端后，AI 就能：列出书籍与章节 · 读取/修改正文 · 新建
        人物/地点/设定 · 全书搜索。示例提问：<i>「看看我的书有哪些章节」
        「为第 3 章新增一个叫林晚的角色设定」「把全书中的“旧名字”改成
        “新名字”」</i>
      </p>

      <h4 class="guide-step">⚠️ 注意事项</h4>
      <ul class="guide-warn">
        <li>AI 执行<b>写操作</b>（修改正文/设定）时，按单会话策略网页端会被下线，重新登录即可</li>
        <li>凭证含登录令牌（30 天有效），请勿分享 <code>~/.writer-mcp.json</code></li>
        <li>修改正文是整体替换：AI 会先读取再修改，服务端自动处理版本冲突</li>
        <li>客户端报「找不到 node」时，用 <code>where node</code> / <code>which node</code> 取绝对路径替换配置里的 <code>command</code></li>
        <li>以前用 npm 装过旧包（<code>writer-demo-mcp</code> / <code>writing-assistant-mcp</code>）的，请卸载旧包、按上面重新安装并<b>重新登录</b>——旧包指向的接口已下线</li>
      </ul>

      <div class="guide-actions">
        <button class="guide-close" @click="emit('close')">知道了</button>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 72vh;
  overflow-y: auto;
}

.guide-title {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 700;
  color: #2a2a2a;
}

.guide-intro {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #555;
}

.guide-step {
  margin: 12px 0 4px;
  font-size: 13.5px;
  font-weight: 600;
  color: #3a3a3a;
}

.guide-client {
  margin: 8px 0 2px;
  font-size: 12.5px;
  font-weight: 600;
  color: #6b7a9c;
}

.guide-note {
  margin: 2px 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: #888;
}

.guide-note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: #6b7a9c;
  background: rgba(79, 110, 247, 0.08);
  padding: 1px 4px;
  border-radius: 4px;
}

.guide-warn {
  margin: 2px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.8;
  color: #a07a3a;
}

.guide-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.guide-close {
  padding: 7px 20px;
  font-size: 13px;
  color: #fff;
  background: #4f6ef7;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.guide-close:hover {
  background: #3f5de0;
}
</style>
