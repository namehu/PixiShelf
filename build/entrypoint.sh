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

# ==================== MODIFICATION START ====================
echo "Searching for files with placeholders..."

# 定义要搜索的目录和占位符模式
# - 使用 grep -r (递归) -l (只列出文件名) 来查找
# - 使用 -E 来支持扩展正则表达式，用 | 表示“或”
# - 将要搜索的两个目录作为参数传给 grep
# - `|| true` 是为了防止在找不到任何匹配文件时 grep 返回非零退出码，从而导致 `set -e` 中止脚本
files_to_process=$(grep -rlE '__NEXT_PUBLIC_IMGPROXY_URL__|__NEXT_PUBLIC_THUMBOR_VIDEO_URL__' packages/pixishelf/.next/static packages/pixishelf/.next/server || true)
# ===================== MODIFICATION END =====================

# 检查是否找到了需要处理的文件
if [ -z "$files_to_process" ]; then
  echo "No files with placeholders found. Skipping replacement."
else
  echo "Found files to process:"
  # echo "$files_to_process" # 使用 for 循环逐行打印更清晰
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
echo "Starting supervisord..."
exec "$@"
