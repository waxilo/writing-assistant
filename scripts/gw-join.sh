#!/usr/bin/env bash
# 把本项目接到共享公网入口 ../gw（可重复执行）。
#
#   ./scripts/gw-join.sh [公网域名]
#
# 依次做四件事：
#   1. 确认 ../gw 存在且网关容器在跑
#   2. 确保共享网络 gw_default 存在，本项目 compose 以 external 引用它
#   3. .env 写 TRUST_PROXY=1
#   4. 调 ../gw/scripts/gw-add-host.sh：生成 nginx vhost + 网关内 reload
#
# 这里不涉及 cloudflared：隧道带的是 *.sloan.dpdns.org 通配记录，新域名只在网关
# 本地加一个 server 块，Cloudflare 侧零操作（../gw/scripts/gw-init.sh 每次 zone 只跑一次）。
#
# TRUST_PROXY 是必须的：不信任代理时每个公网请求的客户端 IP 都是 127.0.0.1，
# 按 IP 计的登录限流会把所有用户挤进同一个桶（back-end/src/server.ts 从
# X-Forwarded-For 还原 CF-Connecting-IP）。
#
# 撤销公网访问：删掉 ../gw/conf.d/writer.conf 并 reload（未登记的 Host 会被网关 404）。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PUBLIC_HOSTNAME="${1:-writer.sloan.dpdns.org}"
CONTAINER_TARGET="writing-assistant:80"   # 必须是容器名：网关容器里的 127.0.0.1 是它自己
GW_DIR="${GW_DIR:-$ROOT_DIR/../gw}"
NETWORK=gw_default

[ -f "$GW_DIR/scripts/gw-add-host.sh" ] || {
  echo "❌ 找不到共享入口项目 $GW_DIR，先建好并执行 ../gw/scripts/gw-init.sh" >&2
  exit 1
}
[ "$(docker inspect -f '{{.State.Running}}' gw 2>/dev/null || echo false)" = "true" ] || {
  echo "❌ 网关 gw 没在跑：cd $GW_DIR && docker compose up -d" >&2
  exit 1
}

echo "==> 确保共享网络 $NETWORK 存在"
# 正常由 ../gw/scripts/gw-init.sh 创建；这里兜底一次，让 clone 后单独跑本脚本也能成。
docker network create "$NETWORK" >/dev/null 2>&1 && echo "    已创建" || echo "    已存在，跳过"

echo "==> 更新 .env（TRUST_PROXY=1）"
[ -f .env ] || { echo "❌ 缺少 .env，先执行 ./scripts/db-init.sh" >&2; exit 1; }
if grep -q "^TRUST_PROXY=" .env; then
  sed -i '' -E 's|^TRUST_PROXY=.*|TRUST_PROXY=1|' .env
else
  printf 'TRUST_PROXY=1\n' >>.env
fi

echo "==> 让容器挂上 $NETWORK"
docker compose up -d

echo "==> 登记域名 $PUBLIC_HOSTNAME → $CONTAINER_TARGET"
( cd "$GW_DIR" && ./scripts/gw-add-host.sh "$PUBLIC_HOSTNAME" "$CONTAINER_TARGET" )

echo ""
echo "✅ 就绪。https://$PUBLIC_HOSTNAME"
echo "   网关健康：docker inspect -f '{{.State.Health.Status}}' gw    日志：docker logs gw"
