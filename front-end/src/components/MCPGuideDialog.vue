<script setup lang="ts">
import BaseDialog from "./dialog/BaseDialog.vue";
import CodeBlock from "./CodeBlock.vue";

/**
 * MCP 接入教程弹层：教用户把写作助手接入外部 AI（Claude Desktop / Cursor）。
 * 内容静态，从顶部栏"AI 接入"入口打开。
 */
const emit = defineEmits<{ (e: "close"): void }>();

// 全局安装（网络受限环境推荐：npx 每次运行需访问 registry，全局安装只装一次）
const INSTALL_CODE = "npm install -g writer-demo-mcp@latest";
const LOGIN_CODE = "writer-demo-mcp login";
const CLAUDE_CONFIG = `{
  "mcpServers": {
    "writer-demo": {
      "command": "writer-demo-mcp",
      "args": []
    }
  }
}`;
const CURSOR_CONFIG = `command: writer-demo-mcp
args: （留空）`;
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
      </p>

      <h4 class="guide-step">① 全局安装（在电脑终端执行）</h4>
      <CodeBlock :code="INSTALL_CODE" single />
      <p class="guide-note">
        重复执行同一条命令即可升级到最新版；server 启动时会自动检查 npm
        是否有新版本并提示更新。
      </p>
      <p class="guide-note">
        网络较差的场景：安装时会拉取 npm registry，只需成功一次即可离线运行；
        若 <code>npx</code> 方式网络不通，用全局安装即可。
      </p>

      <h4 class="guide-step">② 登录账号</h4>
      <CodeBlock :code="LOGIN_CODE" single />
      <p class="guide-note">输入写作助手的账号密码，凭证保存在
        <code>~/.writer-mcp.json</code>（仅本人可读）。</p>

      <h4 class="guide-step">③ 配置你的 AI 客户端</h4>

      <p class="guide-client">Claude Desktop</p>
      <p class="guide-note">
        菜单 → Settings → Developer → Edit Config，在
        <code>claude_desktop_config.json</code> 中加入：
      </p>
      <CodeBlock :code="CLAUDE_CONFIG" />

      <p class="guide-client">Cursor</p>
      <p class="guide-note">Settings → MCP → Add new MCP server → command 类型：</p>
      <CodeBlock :code="CURSOR_CONFIG" />

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
  margin: 10px 0 2px;
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
