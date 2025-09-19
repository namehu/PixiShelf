#!/bin/sh
# entrypoint.sh

# 严格模式，任何命令失败则脚本退出
set -e

# 执行数据库迁移
echo "Running database migrations..."
pnpm --filter="@pixishelf/next" db:deploy

# 执行 Dockerfile 中定义的 CMD
# "$@" 会将 CMD 的所有参数传递给 exec
echo "Starting supervisord..."
exec "$@"
