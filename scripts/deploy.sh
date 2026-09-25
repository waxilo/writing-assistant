#!/usr/bin/env bash
# Rebuild the image from the current working tree and restart the container.
# This replaced deploy.ps1: nothing is pushed to a cloud any more, the deploy
# target is this machine.
#
#   ./scripts/deploy.sh                 # gate (typecheck+tests) -> build -> up -d
#   ./scripts/deploy.sh --skip-checks   # skip the local gate
#   ./scripts/deploy.sh --logs          # follow logs afterwards
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_CHECKS=0
SHOW_LOGS=0
for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=1 ;;
    --logs) SHOW_LOGS=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

[ -f .env ] || { echo "❌ 缺少 .env，先执行 ./scripts/db-init.sh" >&2; exit 1; }
docker network inspect mysql-server_default >/dev/null 2>&1 || {
  echo "❌ 网络 mysql-server_default 不存在，先启动数据库：../mysql-server/scripts/start.sh" >&2
  exit 1
}

if [ "$SKIP_CHECKS" -eq 0 ]; then
  echo "==> 后端 typecheck + 单测"
  (cd back-end && npm run typecheck && npm test)
  # The front end is not checked here on purpose: `npm run build` inside the
  # image runs `vue-tsc --noEmit && vite build`, so a type error already fails
  # the build below — and doing it locally would need a full `npm ci` first.
fi

echo "==> 构建镜像"
docker compose build

echo "==> 启动容器"
docker compose up -d

echo "==> 等待健康检查"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' writing-assistant 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 2
done
docker compose ps

bind=$(sed -n 's/^APP_BIND_ADDR=//p' .env | head -1)
port=$(sed -n 's/^APP_PORT=//p' .env | head -1)
echo ""
echo "✅ 部署完成： http://${bind:-127.0.0.1}:${port:-8787}   （健康检查：${status}）"

if [ "$(sed -n 's/^COMPOSE_PROFILES=//p' .env | head -1)" = "tunnel" ]; then
  # The connector registers asynchronously, so a 530 right here is normal for a
  # couple of seconds; a real failure shows up in `docker compose logs tunnel`.
  echo "   公网入口： https://writer.sloan.dpdns.org   （隧道：$(docker inspect -f '{{.State.Status}}' writing-assistant-tunnel 2>/dev/null || echo 未启动)）"
fi

[ "$SHOW_LOGS" -eq 1 ] && exec docker compose logs -f
