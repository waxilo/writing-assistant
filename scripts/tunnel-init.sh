#!/usr/bin/env bash
# One-time (idempotent) Cloudflare Tunnel setup for this project.
#
#   ./scripts/tunnel-init.sh              # create/reuse the tunnel + DNS route
#   ./scripts/tunnel-init.sh --show       # just print the current ids
#
# Afterwards `docker compose up -d` starts the connector (see the `tunnel`
# service) and the app is reachable at https://$PUBLIC_HOSTNAME.
#
# What it writes:
#   cloudflared/credentials.json  the tunnel's private key (gitignored; revoking
#                                 is done by deleting the tunnel, not by hiding
#                                 this file)
#   cloudflared/config.yml        the tunnel id line, kept in sync
#   .env                          CF_CRED_FILE (path for compose) and TRUST_PROXY=1
#
# TRUST_PROXY matters: without it every public request looks like it came from
# 127.0.0.1, so the per-IP login throttle would collapse all users into one
# bucket (back-end/src/server.ts synthesises CF-Connecting-IP from X-Forwarded-For).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TUNNEL_NAME="writing-assistant"
PUBLIC_HOSTNAME="writer.sloan.dpdns.org"
CRED_DIR="cloudflared"
CRED_FILE="$CRED_DIR/credentials.json"

command -v cloudflared >/dev/null || {
  echo "❌ 未找到 cloudflared，先安装（https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/）" >&2
  exit 1
}
[ -f .env ] || { echo "❌ 缺少 .env，先执行 ./scripts/db-init.sh" >&2; exit 1; }

# cloudflared's JSON is the only reliable way to read ids back; -o json on list.
find_uuid() {
  cloudflared tunnel list -o json 2>/dev/null |
    node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const t = JSON.parse(s).find(x => x.name === process.argv[1]);
        if (t) process.stdout.write(t.id);
      });' "$TUNNEL_NAME"
}

uuid=$(find_uuid)
if [ "${1:-}" = "--show" ]; then
  echo "tunnel: $TUNNEL_NAME = ${uuid:-<未创建>}"
  echo "host:   $PUBLIC_HOSTNAME"
  echo "creds:  $CRED_FILE $([ -f "$CRED_FILE" ] && echo "(已就位)" || echo "(缺失)")"
  exit 0
fi

if [ -z "$uuid" ]; then
  echo "==> 创建隧道 $TUNNEL_NAME"
  cloudflared tunnel create "$TUNNEL_NAME"
  uuid=$(find_uuid)
else
  echo "==> 复用已有隧道 $uuid"
fi
[ -n "$uuid" ] || { echo "❌ 创建后仍查不到隧道 id" >&2; exit 1; }

src="$HOME/.cloudflared/$uuid.json"
[ -f "$src" ] || { echo "❌ 缺少凭证文件 $src" >&2; exit 1; }
echo "==> 安装凭证到 $CRED_FILE"
mkdir -p "$CRED_DIR"
# 600 on the copy: only the compose-managed connector needs it. If the container
# user cannot read it, the tunnel service logs it — see the note in config.yml.
install -m 600 "$src" "$CRED_FILE"

echo "==> 写入隧道 id 到 $CRED_DIR/config.yml"
tmp=$(mktemp)
sed -E "s|^tunnel: .*|tunnel: $uuid|" "$CRED_DIR/config.yml" >"$tmp"
mv "$tmp" "$CRED_DIR/config.yml"

echo "==> 绑定 DNS：$PUBLIC_HOSTNAME"
# `|| true`: a repeat run hits "already exists", which is not an error here.
cloudflared tunnel route dns "$uuid" "$PUBLIC_HOSTNAME" 2>&1 | tail -2 || true

echo "==> 更新 .env（CF_CRED_FILE、TRUST_PROXY、COMPOSE_PROFILES）"
put() {
  local key="$1" value="$2"
  if grep -q "^$key=" .env; then
    sed -i '' -E "s|^$key=.*|$key=$value|" .env
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}
put CF_CRED_FILE "$ROOT_DIR/$CRED_FILE"
put TRUST_PROXY 1
# The tunnel service sits behind a compose profile; this line is what makes a
# plain `docker compose up -d` start the connector on this machine.
put COMPOSE_PROFILES tunnel

echo ""
echo "✅ 就绪。下一步：docker compose up -d   （几秒后访问 https://$PUBLIC_HOSTNAME）"
echo "   撤销公网访问：cloudflared tunnel delete $uuid"
