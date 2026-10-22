#!/usr/bin/env sh
# 写作助手 MCP server — macOS / Linux 安装脚本（单文件，不需要 npm）
#
#   curl -fsSL https://github.com/waxilo/writing-assistant/releases/latest/download/install.sh | sh
#
# 默认从 GitHub Release 下载（server.mjs / latest.json / 两个安装脚本平铺同一个
# URL 前缀）；自托管容器另外镜像了一份 https://writer.sloan.dpdns.org/download/mcp。
#
# 覆盖默认值（下载源 / 安装目录）：
#   WRITER_MCP_BASE=https://writer.sloan.dpdns.org/download/mcp WRITER_MCP_DIR=$HOME/.mcp sh install.sh

set -eu

BASE_URL="${WRITER_MCP_BASE:-https://github.com/waxilo/writing-assistant/releases/latest/download}"
DIR="${WRITER_MCP_DIR:-$HOME/.writing-assistant-mcp}"
BASE_URL="${BASE_URL%/}"
TARGET="$DIR/server.mjs"
MARKER="$DIR/.version"

command -v curl >/dev/null 2>&1 || { echo "需要 curl" >&2; exit 1; }

echo "-> 读取版本信息 $BASE_URL/latest.json"
LATEST="$(curl -fsSL "$BASE_URL/latest.json")"

# latest.json 是逐行缩进的，按行取第一个字符串值即可，不引入 jq 依赖。
field() {
    printf '%s\n' "$LATEST" |
        sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" |
        head -n 1
}

VERSION="$(field version)"
SHA="$(field sha256)"
FILE="$(field file)"
[ -n "$VERSION" ] || { echo "latest.json 里没有 version，下载源可能不对：$BASE_URL" >&2; exit 1; }
[ -n "$FILE" ] || FILE="server.mjs"

if [ -f "$TARGET" ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$VERSION" ]; then
    echo "OK 已是最新 v$VERSION：$TARGET"
else
    mkdir -p "$DIR"
    TMP="$TARGET.download"
    echo "-> 下载 v$VERSION → $TARGET"
    curl -fsSL "$BASE_URL/$FILE" -o "$TMP"

    if [ -n "$SHA" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
            ACTUAL="$(sha256sum "$TMP" | cut -d' ' -f1)"
        else
            ACTUAL="$(shasum -a 256 "$TMP" | cut -d' ' -f1)"
        fi
        if [ "$ACTUAL" != "$SHA" ]; then
            rm -f "$TMP"
            echo "sha256 校验失败：期望 $SHA，实际 $ACTUAL" >&2
            exit 1
        fi
        echo "OK sha256 校验通过"
    fi

    chmod 755 "$TMP"
    mv -f "$TMP" "$TARGET"
    printf '%s' "$VERSION" >"$MARKER"
fi

if command -v node >/dev/null 2>&1; then
    echo "OK node $(node -v)"
else
    echo "警告：没有找到 node，请先安装 Node.js 20+（https://nodejs.org/），否则 MCP 跑不起来。" >&2
fi

cat <<EOF

== 下一步 1/2：登录（只需一次，凭证存 ~/.writer-mcp.json）==
  node "$TARGET" login

== 下一步 2/2：把下面这段并进 AI 客户端的 MCP 配置 ==
   Claude Desktop: Settings -> Developer -> Edit Config（claude_desktop_config.json）
   Cursor:         Settings -> MCP -> Add new MCP server -> 选 command 类型

{
  "mcpServers": {
    "writing-assistant": {
      "command": "node",
      "args": ["$TARGET"]
    }
  }
}
EOF
