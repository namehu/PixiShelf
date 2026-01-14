#!/bin/sh
# entrypoint.sh

# 严格模式，任何命令失败则脚本退出
set -e

# 执行数据库迁移
echo "Running database migrations..."
# 注意：在 Standalone 模式下，我们使用全局安装的 prisma CLI
# schema 路径相对于工作目录 /app
prisma migrate deploy --schema=packages/pixishelf/prisma/schema.prisma

# ==================== MODIFICATION START ====================
echo "Searching for files with placeholders..."

# 定义要搜索的目录和占位符模式
# 在 Standalone 模式下，我们复制了 .next/static 和 .next/server 到对应目录
files_to_process=$(grep -rlE '__NEXT_PUBLIC_IMGPROXY_URL__|__NEXT_PUBLIC_THUMBOR_VIDEO_URL__' packages/pixishelf/.next/static packages/pixishelf/.next/server || true)
# ===================== MODIFICATION END =====================

# 检查是否找到了需要处理的文件
if [ -z "$files_to_process" ]; then
  echo "No files with placeholders found. Skipping replacement."
else
  echo "Found files to process:"
  printf '%s\n' "$files_to_process"

  # 遍历找到的文件列表，用 sed 命令将占位符替换为真正的运行时环境变量
  for file in $files_to_process
  do
    echo "Processing $file ..."
    # 使用 | 作为 sed 的分隔符，因为 URL 中可能包含 /
    sed -i "s|__NEXT_PUBLIC_IMGPROXY_URL__|${NEXT_PUBLIC_IMGPROXY_URL}|g" "$file"
    sed -i "s|__NEXT_PUBLIC_THUMBOR_VIDEO_URL__|${NEXT_PUBLIC_THUMBOR_VIDEO_URL}|g" "$file"
  done
fi

# 执行 Dockerfile 中定义的 CMD
# "$@" 会将 CMD 的所有参数传递给 exec
echo "Starting application..."
exec "$@"
