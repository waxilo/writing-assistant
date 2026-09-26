#!/usr/bin/env bash
# One-off setup for the self-hosted deployment:
#   1. create the dedicated database + its own user inside the shared
#      mysql-server container (nothing here touches the server's other DBs),
#   2. apply back-end/db/schema.mysql.sql,
#   3. generate .env with the credentials and token secrets.
#
# The mysql-server container must already be running:
#   ../mysql-server/scripts/start.sh
#
# Re-running is safe: CREATE ... IF NOT EXISTS, and an existing .env is left
# alone (secrets are never regenerated in place, that would log everyone out).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-writing_assistant}"
DB_USER="${DB_USER:-writing_assistant}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-mysql-server}"
MYSQL_PROJECT_DIR="${MYSQL_PROJECT_DIR:-$(dirname "$ROOT_DIR")/mysql-server}"

password() { openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

[ -f "$MYSQL_PROJECT_DIR/.env" ] || {
  echo "❌ 找不到 ${MYSQL_PROJECT_DIR}/.env（mysql-server 项目的密码文件）" >&2
  exit 1
}
docker inspect -f '{{.State.Running}}' "$MYSQL_CONTAINER" 2>/dev/null | grep -q true || {
  echo "❌ 容器 ${MYSQL_CONTAINER} 未运行，先执行：${MYSQL_PROJECT_DIR}/scripts/start.sh" >&2
  exit 1
}

# Root password comes from the mysql-server project; it is never written here.
ROOT_PW="$(sed -n 's/^MYSQL_ROOT_PASSWORD=//p' "$MYSQL_PROJECT_DIR/.env" | head -1)"
[ -n "$ROOT_PW" ] || { echo "❌ ${MYSQL_PROJECT_DIR}/.env 里没有 MYSQL_ROOT_PASSWORD" >&2; exit 1; }

mysql_admin() {
  docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$ROOT_PW" --default-character-set=utf8mb4 "$@"
}

if [ -f "$ROOT_DIR/.env" ]; then
  echo "ℹ️  .env 已存在，沿用其中的密码/密钥；只有缺失项会被补全"
else
  echo "📝 生成 ${ROOT_DIR}/.env"
  cat > "$ROOT_DIR/.env" <<EOF
DB_HOST=mysql
DB_PORT=3306
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=$(password 24)
TOKEN_SECRET=$(password 48)
REFRESH_SECRET=$(password 48)
APP_BIND_ADDR=127.0.0.1
APP_PORT=7001
TRUST_PROXY=0
EOF
  chmod 600 "$ROOT_DIR/.env"
fi

# Fill in any key an older .env is missing, so the file always has all three
# credentials after a run.
for key in DB_PASSWORD TOKEN_SECRET REFRESH_SECRET; do
  grep -q "^${key}=.\+" "$ROOT_DIR/.env" || {
    value=$(password 48)
    printf '%s=%s\n' "$key" "$value" >> "$ROOT_DIR/.env"
    echo "🔑 已补齐 ${key}"
  }
done

DB_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$ROOT_DIR/.env" | head -1)"

echo "🗄️  创建数据库 ${DB_NAME} 与专用账号 ${DB_USER}..."
# The account is scoped to this one database and reached only from the compose
# network, so '%' as host is the practical grant here.
mysql_admin <<SQL
create database if not exists \`${DB_NAME}\`
  default character set utf8mb4 collate utf8mb4_unicode_ci;
create user if not exists '${DB_USER}'@'%' identified by '${DB_PASSWORD}';
alter user '${DB_USER}'@'%' identified by '${DB_PASSWORD}';
grant select, insert, update, delete, create, alter, index, references
  on \`${DB_NAME}\`.* to '${DB_USER}'@'%';
flush privileges;
SQL

echo "📐 应用表结构 back-end/db/schema.mysql.sql..."
docker exec -i "$MYSQL_CONTAINER" \
  mysql -u"$DB_USER" -p"$DB_PASSWORD" --default-character-set=utf8mb4 "$DB_NAME" \
  < "$ROOT_DIR/back-end/db/schema.mysql.sql"

echo "✅ 完成。表："
mysql_admin -N -e "select table_name from information_schema.tables where table_schema='${DB_NAME}' order by table_name;"

cat <<'EOF'

下一步：
  docker compose up -d --build        # 构建并启动（前端 + API 同容器）
  open http://127.0.0.1:7001          # 注册第一个账号

.env 里已是随机强密码，无需手动改动。
EOF
