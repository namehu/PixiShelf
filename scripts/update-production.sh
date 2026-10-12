#!/bin/bash

set -euo pipefail

# ================= 配置区域 =================
SOURCE_DIR="${PIXIV_SOURCE_DIR:-$HOME/Downloads/pixiv}"
BACKUP_DIR="${PIXIV_BACKUP_DIR:-/Volumes/Aria2/pixiv/}"
CONVERT_DIR="${PIXIV_CONVERT_DIR:-$HOME/Downloads/zip-convert/}"
META_OUTPUT_DIR="${PIXIV_META_OUTPUT_DIR:-$HOME/Desktop}"

WEBHOOK_URL="${PIXISHELF_SCAN_WEBHOOK_URL:-http://you-domain/api/webhooks/scan}"
WEBHOOK_TOKEN="${PIXISHELF_SCAN_WEBHOOK_TOKEN:-${SCAN_WEBHOOK_TOKEN:-yourtoken}}"
WEBHOOK_WAIT_TIMEOUT_SECONDS="${PIXISHELF_SCAN_WEBHOOK_TIMEOUT_SECONDS:-7200}"
WEBHOOK_REQUEST_TIMEOUT_SECONDS="${PIXISHELF_SCAN_WEBHOOK_REQUEST_TIMEOUT_SECONDS:-60}"
WEBHOOK_POLL_INTERVAL_SECONDS="${PIXISHELF_SCAN_WEBHOOK_POLL_INTERVAL_SECONDS:-3}"

DATE_STR=$(date +"%Y-%m-%d_%H-%M-%S")

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
  printf '%b\n' "${GREEN}[INFO] $1${NC}"
}

log_warn() {
  printf '%b\n' "${YELLOW}[WARN] $1${NC}"
}

log_error() {
  printf '%b\n' "${RED}[ERROR] $1${NC}" >&2
}

require_command() {
  local cmd="$1"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "缺少依赖命令: $cmd"
    exit 1
  fi
}

require_positive_integer() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    log_error "$name 必须是正整数，当前值: $value"
    exit 1
  fi
}

WEBHOOK_PAYLOAD_FILE=""
WEBHOOK_RESPONSE_FILE=""

cleanup() {
  if [ -n "$WEBHOOK_PAYLOAD_FILE" ]; then
    rm -f -- "$WEBHOOK_PAYLOAD_FILE"
  fi

  if [ -n "$WEBHOOK_RESPONSE_FILE" ]; then
    rm -f -- "$WEBHOOK_RESPONSE_FILE"
  fi
}

trap cleanup EXIT

# ================= 开始执行 =================

for cmd in npm rsync node curl find sed mktemp date sleep rm mkdir ls; do
  require_command "$cmd"
done

require_positive_integer \
  "PIXISHELF_SCAN_WEBHOOK_TIMEOUT_SECONDS" \
  "$WEBHOOK_WAIT_TIMEOUT_SECONDS"

require_positive_integer \
  "PIXISHELF_SCAN_WEBHOOK_REQUEST_TIMEOUT_SECONDS" \
  "$WEBHOOK_REQUEST_TIMEOUT_SECONDS"

require_positive_integer \
  "PIXISHELF_SCAN_WEBHOOK_POLL_INTERVAL_SECONDS" \
  "$WEBHOOK_POLL_INTERVAL_SECONDS"

# 0. 检查源目录
if [ ! -d "$SOURCE_DIR" ]; then
  log_error "源目录不存在: $SOURCE_DIR"
  exit 1
fi

if [ -z "$(ls -A "$SOURCE_DIR")" ]; then
  log_warn "源目录是空的，无需操作。"
  exit 0
fi

# 0. 检查外部硬盘
if [ ! -d "/Volumes/Aria2" ]; then
  log_error "外部硬盘 /Volumes/Aria2 未挂载！请插入硬盘。"
  exit 1
fi

# 0. 检查 Webhook Token
if [ -z "$WEBHOOK_TOKEN" ]; then
  log_error "未设置 Webhook Token。请配置 PIXISHELF_SCAN_WEBHOOK_TOKEN 或 SCAN_WEBHOOK_TOKEN。"
  exit 1
fi

log_info "开始处理 Pixiv 下载流程..."

# 1. 执行 APNG 转 WebM
log_info "步骤 1/5: 执行 APNG 转 WebM..."

cd "$CONVERT_DIR"
npm run a2w

# 2. 提取 Meta 文件路径
log_info "步骤 2/5: 查找 Meta 文件并导出..."

# 将输出目录转为绝对路径，日志显示实际保存位置。
mkdir -p -- "$META_OUTPUT_DIR"
META_OUTPUT_DIR=$(cd "$META_OUTPUT_DIR" && pwd -P)
META_FILE="${META_OUTPUT_DIR}/meta_files_${DATE_STR}.txt"
log_info "Meta 清单保存路径: $META_FILE"

require_meta_list() {
  if [ ! -f "$META_FILE" ]; then
    log_error "Meta 清单不存在，停止执行，保留源目录: $META_FILE"
    exit 1
  fi
  if [ ! -s "$META_FILE" ]; then
    log_error "Meta 清单为空，停止执行，保留源目录: $META_FILE"
    exit 1
  fi
}

# -H 允许 SOURCE_DIR 本身是符号链接；末尾 / 确保读取目录内容。
# BSD find 可能在目录与文件之间输出双斜杠；先统一分隔符，再按完整目录前缀截取。
# 使用 Node 去除路径前缀，避免 sed 将目录中的特殊字符当作正则。
if ! find -H "${SOURCE_DIR%/}/" -maxdepth 4 -type f \
  \( -name "*-meta.json" -o -name "*-meta.txt" \) \
  | node -e '
const fs = require("fs")
const normalizeSeparators = value => value.replace(/\/+/g, "/")
const prefix = normalizeSeparators(process.argv[1]).replace(/\/+$/, "") + "/"
const paths = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean).map(normalizeSeparators)
for (const path of paths) {
  if (!path.startsWith(prefix)) {
    console.error("[ERROR] Meta 路径不属于源目录: " + path)
    process.exit(1)
  }
}
if (paths.length) process.stdout.write(paths.map(path => path.slice(prefix.length)).join("\n") + "\n")
' "$SOURCE_DIR" > "$META_FILE"; then
  log_error "生成 Meta 清单失败，停止执行，保留源目录: $META_FILE"
  exit 1
fi

require_meta_list

if ! META_COUNTS=$(node - "$META_FILE" <<'NODE'
const fs = require('fs')
const paths = fs.readFileSync(process.argv[2], 'utf8')
  .split(/\r?\n/).map(line => line.trim()).filter(Boolean)
const artworks = new Set()
for (const path of paths) {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    console.error(`[ERROR] Meta 路径必须是扫描根目录内的相对路径，停止执行: ${path}`)
    process.exit(1)
  }
  const match = path.match(/(?:^|\/)([0-9]+)(?:_p[0-9]+)?-meta\.(?:json|txt)$/)
  if (!match) {
    console.error(`[ERROR] 无法识别作品 ID，停止执行: ${path}`)
    process.exit(1)
  }
  artworks.add(match[1])
}
if (!paths.length || !artworks.size) {
  console.error('[ERROR] Meta 清单没有有效作品，停止执行')
  process.exit(1)
}
process.stdout.write(`${paths.length}\t${artworks.size}`)
NODE
); then
  log_error "统计 Meta 清单失败，停止执行，保留源目录。"
  exit 1
fi

IFS=$'\t' read -r META_COUNT ARTWORK_COUNT <<< "$META_COUNTS"
log_info "Meta 清单已生成: $META_FILE"
log_info "本次作品数量: ${ARTWORK_COUNT}（按作品 ID 去重），Meta 文件数量: ${META_COUNT}"

# 3. 执行 Rsync 备份
log_info "步骤 3/5: 同步文件到 Aria2..."

rsync -avh --progress "$SOURCE_DIR/" "$BACKUP_DIR"

# 4. 安全删除
# 同步完成后、清理源目录前，再次检查清单。
require_meta_list
log_info "步骤 4/5: 同步成功，正在清理源目录..."

if [[ "$SOURCE_DIR" == *"/Downloads/pixiv"* && -n "$SOURCE_DIR" ]]; then
  rm -rf -- "$SOURCE_DIR"
  mkdir -p -- "$SOURCE_DIR"
  log_info "清理完成！"
else
  log_error "路径校验失败，跳过删除操作以保护系统安全: $SOURCE_DIR"
  exit 1
fi

# 5. 调用 Webhook，并在异步模式下轮询最终结果
log_info "步骤 5/5: 调用 Webhook 执行扫描并等待结果..."

require_meta_list

WEBHOOK_PAYLOAD_FILE=$(mktemp)
WEBHOOK_RESPONSE_FILE=$(mktemp)

node - "$META_FILE" > "$WEBHOOK_PAYLOAD_FILE" <<'NODE'
const fs = require('fs')

const metaFile = process.argv[2]

const metadataList = fs
  .readFileSync(metaFile, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

process.stdout.write(
  JSON.stringify({
    type: 'list',
    metadataList
  })
)
NODE

# 提交扫描任务
if ! HTTP_STATUS=$(curl \
  -sS \
  -m "$WEBHOOK_REQUEST_TIMEOUT_SECONDS" \
  -o "$WEBHOOK_RESPONSE_FILE" \
  -w "%{http_code}" \
  -X POST "$WEBHOOK_URL" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$WEBHOOK_PAYLOAD_FILE"); then

  log_error "Webhook 请求失败，请检查服务是否可达: $WEBHOOK_URL"
  exit 1
fi

# 解析提交响应，同时兼容旧版同步响应
PARSED_RESPONSE=$(node - "$WEBHOOK_RESPONSE_FILE" "$HTTP_STATUS" <<'NODE'
const fs = require('fs')

const responseFile = process.argv[2]
const statusCode = Number(process.argv[3] || 0)
const content = fs.readFileSync(responseFile, 'utf8').trim()

function fail(message) {
  console.error(`[ERROR] ${message}`)
  process.exit(1)
}

function requiredNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`Webhook 响应缺少有效字段 ${name}`)
  }

  return value
}

if (!content) {
  fail(`Webhook 返回空响应，HTTP ${statusCode}`)
}

let data

try {
  data = JSON.parse(content)
} catch {
  fail(`Webhook 响应不是有效 JSON，HTTP ${statusCode}: ${content}`)
}

if (
  !data ||
  !data.success ||
  statusCode < 200 ||
  statusCode >= 300
) {
  fail(
    `Webhook 扫描请求失败，HTTP ${statusCode}，error=${
      data?.error || 'Unknown error'
    }`
  )
}

const jobId =
  typeof data.jobId === 'string' && data.jobId
    ? data.jobId
    : '-'

if (data.queued === true || statusCode === 202) {
  if (jobId === '-') {
    fail('Webhook 入队响应缺少 jobId')
  }

  const status =
    typeof data.status === 'string' && data.status
      ? data.status
      : 'PENDING'

  process.stdout.write(`QUEUED\t${jobId}\t${status}`)
  process.exit(0)
}

const result = data.data

if (!result || typeof result !== 'object') {
  fail('Webhook 同步成功响应缺少 data')
}

process.stdout.write(
  [
    'COMPLETED',
    jobId,
    'COMPLETED',
    requiredNumber(
      result.totalArtworks,
      'data.totalArtworks'
    ),
    requiredNumber(
      result.newArtworks,
      'data.newArtworks'
    ),
    requiredNumber(
      result.newImages,
      'data.newImages'
    )
  ].join('\t')
)
NODE
)

IFS=$'\t' read -r \
  RESPONSE_KIND \
  JOB_ID \
  JOB_STATUS \
  VALUE_1 \
  VALUE_2 \
  VALUE_3 \
  <<< "$PARSED_RESPONSE"

# 旧版同步模式直接输出结果
if [ "$RESPONSE_KIND" = "COMPLETED" ]; then
  log_info "Webhook 同步扫描完成，jobId=${JOB_ID}，totalArtworks=${VALUE_1}，newArtworks=${VALUE_2}，newImages=$VALUE_3"
else
  log_info "Webhook 扫描任务已入队，jobId=${JOB_ID}，status=$JOB_STATUS"

  POLL_STARTED_AT=$(date +%s)
  LAST_STATE=""

  while true; do
    # 查询异步任务状态
    if ! HTTP_STATUS=$(curl \
      -sS \
      -m "$WEBHOOK_REQUEST_TIMEOUT_SECONDS" \
      -o "$WEBHOOK_RESPONSE_FILE" \
      -w "%{http_code}" \
      --get "$WEBHOOK_URL" \
      -H "Authorization: Bearer $WEBHOOK_TOKEN" \
      --data-urlencode "jobId=$JOB_ID"); then

      log_error "Webhook 状态查询失败，jobId=$JOB_ID"
      exit 1
    fi

    POLL_RESULT=$(node - "$WEBHOOK_RESPONSE_FILE" "$HTTP_STATUS" <<'NODE'
const fs = require('fs')

const responseFile = process.argv[2]
const statusCode = Number(process.argv[3] || 0)
const content = fs.readFileSync(responseFile, 'utf8').trim()

function fail(message) {
  console.error(`[ERROR] ${message}`)
  process.exit(1)
}

function clean(value) {
  const text =
    value === null ||
    value === undefined ||
    value === ''
      ? '-'
      : String(value)

  return (
    text
      .replace(/[\t\r\n]+/g, ' ')
      .trim() || '-'
  )
}

function metric(value, name, required) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value
  }

  if (required) {
    fail(
      `Webhook 状态响应缺少有效字段 data.${name}`
    )
  }

  return 0
}

if (!content) {
  fail(
    `Webhook 状态查询返回空响应，HTTP ${statusCode}`
  )
}

let data

try {
  data = JSON.parse(content)
} catch {
  fail(
    `Webhook 状态响应不是有效 JSON，HTTP ${statusCode}: ${content}`
  )
}

if (
  !data ||
  !data.success ||
  statusCode < 200 ||
  statusCode >= 300
) {
  fail(
    `Webhook 状态查询失败，HTTP ${statusCode}，error=${
      data?.error || 'Unknown error'
    }`
  )
}

const status = clean(data.status)

const result =
  data.data &&
  typeof data.data === 'object'
    ? data.data
    : {}

const completed = status === 'COMPLETED'

process.stdout.write(
  [
    status,
    metric(data.progress, 'progress', false),
    metric(
      result.totalArtworks,
      'totalArtworks',
      completed
    ),
    metric(
      result.processedArtworks,
      'processedArtworks',
      completed
    ),
    metric(
      result.succeededArtworks,
      'succeededArtworks',
      completed
    ),
    metric(
      result.skippedArtworks,
      'skippedArtworks',
      completed
    ),
    metric(
      result.failedArtworks,
      'failedArtworks',
      completed
    ),
    metric(
      result.newImages,
      'newImages',
      completed
    ),
    result.durationMs === null ||
    result.durationMs === undefined
      ? '-'
      : clean(result.durationMs),
    clean(data.error),
    clean(data.message)
  ].join('\t')
)
NODE
)

    IFS=$'\t' read -r \
      JOB_STATUS \
      JOB_PROGRESS \
      TOTAL_ARTWORKS \
      PROCESSED_ARTWORKS \
      SUCCEEDED_ARTWORKS \
      SKIPPED_ARTWORKS \
      FAILED_ARTWORKS \
      NEW_IMAGES \
      DURATION_MS \
      JOB_ERROR \
      JOB_MESSAGE \
      <<< "$POLL_RESULT"

    case "$JOB_STATUS" in
      COMPLETED)
        log_info "Webhook 扫描完成，jobId=${JOB_ID}，totalArtworks=${TOTAL_ARTWORKS}，processedArtworks=${PROCESSED_ARTWORKS}，succeededArtworks=${SUCCEEDED_ARTWORKS}，skippedArtworks=${SKIPPED_ARTWORKS}，failedArtworks=${FAILED_ARTWORKS}，newImages=${NEW_IMAGES}，durationMs=$DURATION_MS"
        break
        ;;

      FAILED | CANCELLED | SKIPPED)
        log_error "Webhook 扫描未成功完成，jobId=${JOB_ID}，status=${JOB_STATUS}，error=$JOB_ERROR"
        exit 1
        ;;

      PAUSED)
        log_error "Webhook 扫描已暂停，需要管理员处理，jobId=${JOB_ID}，message=$JOB_MESSAGE"
        exit 1
        ;;

      PENDING | RUNNING | PAUSING | RETRY_WAIT | CANCELLING)
        CURRENT_STATE="${JOB_STATUS}:${JOB_PROGRESS}:${JOB_MESSAGE}"

        if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
          log_info "等待扫描完成，jobId=${JOB_ID}，status=${JOB_STATUS}，progress=${JOB_PROGRESS}%，message=$JOB_MESSAGE"
          LAST_STATE="$CURRENT_STATE"
        fi
        ;;

      *)
        log_error "Webhook 返回未知任务状态，jobId=${JOB_ID}，status=$JOB_STATUS"
        exit 1
        ;;
    esac

    CURRENT_EPOCH=$(date +%s)
    ELAPSED_SECONDS=$((CURRENT_EPOCH - POLL_STARTED_AT))

    if [ "$ELAPSED_SECONDS" -ge "$WEBHOOK_WAIT_TIMEOUT_SECONDS" ]; then
      log_error "等待扫描结果超时，jobId=${JOB_ID}，已等待 ${ELAPSED_SECONDS} 秒"
      exit 1
    fi

    sleep "$WEBHOOK_POLL_INTERVAL_SECONDS"
  done
fi

printf '%s\n' '------------------------------------------------'
log_info "🎉 所有操作执行完毕！"
