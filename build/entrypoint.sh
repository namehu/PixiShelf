#!/bin/sh
# entrypoint.sh

# 严格模式，任何命令失败则脚本退出
set -e

# 执行数据库迁移
echo "Running database migrations..."
pnpm --filter="@pixishelf/next" db:deploy

#在宿主机创建 logs 目录：
# mkdir -p logs
# chmod 777 logs

# 找到所有构建出的 JS 文件
# .next/static/**/*.js
files=$(find packages/pixishelf/.next/static -type f -name "*.js")

echo "Found files to process:"
echo "$files"

# 遍历文件，用 sed 命令将占位符替换为真正的运行时环境变量
for file in $files
do
  echo "Processing $file ..."
  # 使用 | 作为 sed 的分隔符，因为 URL 中可能包含 /
  sed -i "s|__NEXT_PUBLIC_IMGPROXY_URL__|${NEXT_PUBLIC_IMGPROXY_URL}|g" "$file"
  sed -i "s|__NEXT_PUBLIC_THUMBOR_VIDEO_URL__|${NEXT_PUBLIC_THUMBOR_VIDEO_URL}|g" "$file"
done

# 执行 Dockerfile 中定义的 CMD
# "$@" 会将 CMD 的所有参数传递给 exec
echo "Starting supervisord..."
exec "$@"
