#!/usr/bin/env node
// WriterDemo MCP server
// 让外部 AI（Claude Desktop / Cursor / 其他 MCP 客户端）读写写作项目的
// 章节正文与设定资料库。通过用户账号凭证（~/.writer-mcp.json）调用现有
// Cloudflare API，access token 过期时自动用 refresh token 续期。
//
// 运行：
//   writer-demo-mcp           启动 MCP server（stdio 传输，由客户端拉起）
//   writer-demo-mcp login     交互登录并保存凭证

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const CONFIG_PATH =
  process.env.WRITER_MCP_CONFIG || join(homedir(), ".writer-mcp.json");
const DEFAULT_API_BASE = "https://api.sloan.dpdns.org";
/** 发布到 npm 的当前版本（发布时同步更新）。 */
const VERSION = "0.1.2";

// --- `login` subcommand -------------------------------------------------------

/**
 * 行输入（终端 raw 模式手动读取）。`hidden` 时密码不回显（显示 *）。
 * 相比 readline 更可靠：readline 的回显走内部路径，无法可靠拦截。
 */
function askLine(question, hidden = false) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question + " ");
    if (stdin.isTTY) stdin.setRawMode(true);
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk.toString()) {
        if (ch === "\n" || ch === "\r" || ch === "\x04") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\x03") {
          // Ctrl+C：raw 模式下信号被禁用，手动退出。
          process.exit(130);
        }
        if (ch === "\x7f" || ch === "\b") {
          // 退格：删除最后一个字符（不回显占位符）。
          if (value.length > 0) value = value.slice(0, -1);
          continue;
        }
        value += ch;
        process.stdout.write(hidden ? "*" : ch);
      }
    };
    stdin.on("data", onData);
  });
}

async function runLogin() {
  let username = "";
  let password = "";

  if (process.stdin.isTTY) {
    username = await askLine("账号: ", false);
    password = await askLine("密码: ", true);
  } else {
    const lines = readFileSync(0, "utf8").split("\n");
    username = lines[0]?.trim() ?? "";
    password = lines[1]?.trim() ?? "";
  }

  if (!username || !password) {
    console.error("账号和密码不能为空");
    process.exit(1);
  }

  const apiBase = process.env.WRITER_API_BASE || DEFAULT_API_BASE;
  const res = await fetch(`${apiBase}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client": "mcp", // 标记 AI 工具会话（多会话并存，无需抢占）
    },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.code !== 200 || !json.data) {
    console.error("登录失败:", json?.message ?? "网络错误");
    process.exit(1);
  }

  const config = {
    apiBase,
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
    accessExp: Date.now() + json.data.expiresIn * 1000,
  };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`✅ 凭证已保存到 ${CONFIG_PATH}（access token 会自动续期）`);
  process.exit(0);
}

if (process.argv[2] === "login") {
  await runLogin();
}

/**
 * 启动时检查 npm 最新版本，落后时在 stderr 提示更新命令。
 * （MCP 协议走 stdout，stderr 不会被解析，安全。）
 */
async function checkForUpdate() {
  try {
    const res = await fetch("https://registry.npmjs.org/writer-demo-mcp/latest", {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    if (json.version && json.version !== VERSION) {
      console.error(
        `[writer-demo-mcp] 发现新版本 v${json.version}（当前 v${VERSION}）。` +
          `更新：npm install -g writer-demo-mcp@latest；或改用 npx -y writer-demo-mcp 自动获取最新。`
      );
    }
  } catch {
    // 网络不可用时静默，不影响 MCP 启动。
  }
}

if (process.argv[2] !== "login") {
  void checkForUpdate();
}

// --- MCP server ---------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- credentials & auto-refresh ----------------------------------------------

let config = null;

function loadConfig() {
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    throw new Error(
      `未找到凭证 ${CONFIG_PATH}。请先运行：writer-demo-mcp login（输入账号密码登录）`
    );
  }
}

function saveConfig() {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function refreshTokens() {
  const res = await fetch(`${config.apiBase ?? DEFAULT_API_BASE}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: config.refreshToken }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.code !== 200 || !json.data) {
    throw new Error("登录已过期，请重新运行 writer-demo-mcp login");
  }
  config.accessToken = json.data.accessToken;
  config.refreshToken = json.data.refreshToken;
  config.accessExp = Date.now() + json.data.expiresIn * 1000;
  saveConfig();
}

/**
 * 调用 WriterDemo API。自动续期 + 401 后重试一次。
 */
async function api(path, { method = "GET", body } = {}) {
  if (!config) loadConfig();
  if (
    config.accessExp &&
    Date.now() >= config.accessExp - 60_000 &&
    config.refreshToken
  ) {
    await refreshTokens();
  }

  const request = async (token) => {
    const res = await fetch(`${config.apiBase ?? DEFAULT_API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return res.json().catch(() => ({
      code: res.status,
      message: `HTTP ${res.status}`,
      data: null,
    }));
  };

  let json = await request(config.accessToken);
  if (json.code === 401 && config.refreshToken) {
    await refreshTokens();
    json = await request(config.accessToken);
  }
  if (json.code !== 200) {
    // 携带 code（如 409），供调用方做并发重试等分支处理。
    throw Object.assign(new Error(json.message || "请求失败"), {
      code: json.code,
    });
  }
  return json.data;
}

// --- helpers ------------------------------------------------------------------

const text = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** 章节修改：字段级保存（只发送 patch 提供的字段，服务器保留其余字段），
 * 以最新版本为乐观锁基线；并发 409 时重取最新再试一次。 */
async function saveChapter(chapterId, patch) {
  for (let attempt = 0; ; attempt++) {
    const current = await api(`/chapters/${chapterId}`);
    const payload = { baseVersion: current.version };
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.content !== undefined) payload.content = patch.content;
    try {
      return await api(`/chapters/${chapterId}`, {
        method: "PUT",
        body: payload,
      });
    } catch (error) {
      if (attempt === 0 && error?.code === 409) continue; // 重取最新再存
      throw error;
    }
  }
}

// --- MCP server & tools -------------------------------------------------------

const server = new McpServer({
  name: "writer-demo",
  version: "0.1.0",
  instructions:
    "写作助手数据服务。可列出书籍与章节、读写章节正文、管理设定资料库" +
    "（人物/地点/设定）、全书搜索。修改正文或设定后，写作应用的网页端" +
    "需要重新登录（单活跃会话策略）。",
});

// 书籍
server.tool(
  "list_books",
  "列出当前账号的所有书籍（含章节数与总字数）",
  {},
  async () => text(await api("/books"))
);

// 章节
server.tool(
  "list_chapters",
  "列出某本书的全部章节（标题/字数/版本/所属卷），不含正文",
  { bookId: z.number().int().positive() },
  async ({ bookId }) => text(await api(`/books/${bookId}/chapters`))
);

server.tool(
  "read_chapter",
  "读取某个章节的完整正文（含标题、字数、版本号）",
  { chapterId: z.number().int().positive() },
  async ({ chapterId }) => text(await api(`/chapters/${chapterId}`))
);

server.tool(
  "create_chapter",
  "在书中新建章节，可选指定标题（默认“未命名章节”）",
  { bookId: z.number().int().positive(), title: z.string().max(200).optional() },
  async ({ bookId, title }) => {
    const chapter = await api(`/books/${bookId}/chapters`, {
      method: "POST",
      body: { title },
    });
    return text(chapter);
  }
);

server.tool(
  "update_chapter",
  "修改章节的标题和/或正文（整体替换 content；省略的字段保持不变）。" +
    "注意：这是写操作；多会话并存，不会使网页端下线（同字段并发修改由乐观锁保护）",
  {
    chapterId: z.number().int().positive(),
    title: z.string().max(200).optional(),
    content: z.string().max(500_000).optional(),
  },
  async ({ chapterId, title, content }) => {
    if (title === undefined && content === undefined) {
      throw new Error("至少提供 title 或 content 之一");
    }
    return text(await saveChapter(chapterId, { title, content }));
  }
);

server.tool(
  "delete_chapter",
  "删除章节（不可恢复）",
  { chapterId: z.number().int().positive() },
  async ({ chapterId }) => text(await api(`/chapters/${chapterId}`, { method: "DELETE" }))
);

server.tool(
  "search_chapters",
  "全书搜索关键字，返回每章匹配数（不含正文）",
  { bookId: z.number().int().positive(), query: z.string().min(1).max(200) },
  async ({ bookId, query }) =>
    text(await api(`/books/${bookId}/search?q=${encodeURIComponent(query)}`))
);

// 设定资料库
server.tool(
  "list_entries",
  "列出书的设定资料库条目，可按类型过滤（character 人物 / location 地点 / concept 设定）",
  {
    bookId: z.number().int().positive(),
    type: z.enum(["character", "location", "concept"]).optional(),
  },
  async ({ bookId, type }) => {
    const qs = type ? `?type=${type}` : "";
    return text(await api(`/books/${bookId}/entries${qs}`));
  }
);

server.tool(
  "read_entry",
  "读取单个设定条目（含正文）",
  { entryId: z.number().int().positive() },
  async ({ entryId }) => text(await api(`/entries/${entryId}`))
);

server.tool(
  "create_entry",
  "新建设定条目（人物/地点/设定），可选标题",
  {
    bookId: z.number().int().positive(),
    type: z.enum(["character", "location", "concept"]),
    title: z.string().max(200).optional(),
  },
  async ({ bookId, type, title }) => {
    const entry = await api(`/books/${bookId}/entries`, {
      method: "POST",
      body: { type, title },
    });
    return text(entry);
  }
);

server.tool(
  "update_entry",
  "修改设定条目（标题/正文/类型；省略的字段保持不变，字段级保存互不覆盖）。写操作；多会话并存，不会使网页端下线",
  {
    entryId: z.number().int().positive(),
    title: z.string().max(200).optional(),
    content: z.string().max(500_000).optional(),
    type: z.enum(["character", "location", "concept"]).optional(),
  },
  async ({ entryId, title, content, type }) => {
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (type !== undefined) patch.type = type;
    if (Object.keys(patch).length === 0) throw new Error("至少提供一个字段");
    return text(await api(`/entries/${entryId}`, { method: "PUT", body: patch }));
  }
);

server.tool(
  "delete_entry",
  "删除设定条目（不可恢复）",
  { entryId: z.number().int().positive() },
  async ({ entryId }) => text(await api(`/entries/${entryId}`, { method: "DELETE" }))
);

// --- start ---------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
