---
status: current
scope: GET/HEAD/POST /api/webhooks/scan 的认证、扫描入队、状态查询和调用示例
last-verified: 2026-08-19
sources:
  - ../app/api/webhooks/scan/route.ts
---

# Webhook 扫描功能

PixiShelf 提供基于 Webhook 的 Pixiv 扫描入队机制。外部服务（如 Bash 脚本、CI/CD 流程或
文件变更监控）可以请求目录发现，或只处理明确的 metadata 相对路径。全目录强制刷新已退役，不再是
Webhook 能力。

## 1. 配置

在使用 Webhook 功能前，需要在环境变量中配置安全令牌：

```bash
# .env 文件
SCAN_WEBHOOK_TOKEN="your-secure-random-token-here"
```

## 2. API 接口说明

- **扫描入队**: `POST /api/webhooks/scan`
- **健康检查**: `GET /api/webhooks/scan`
- **任务状态**: `GET /api/webhooks/scan?jobId=<jobId>`
- **认证探测**: `HEAD /api/webhooks/scan`
- **认证方式**: Bearer Token
- **Content-Type**: `application/json`

`GET` 和 `HEAD` 都不会创建或触发扫描：无 `jobId` 的 `GET` 只返回健康状态，带 `jobId` 的 `GET` 只读任务
状态，`HEAD` 只校验 Bearer Token 并在成功时返回 `204`。

### 请求头 (Headers)

| Key           | Value                         | 说明                           |
| ------------- | ----------------------------- | ------------------------------ |
| Authorization | `Bearer <SCAN_WEBHOOK_TOKEN>` | 必须与环境变量中配置的令牌一致 |
| Content-Type  | `application/json`            |                                |

### 请求参数 (Body)

| 参数名         | 类型       | 必填 | 默认值   | 说明                                                                      |
| -------------- | ---------- | ---- | -------- | ------------------------------------------------------------------------- |
| `type`         | `string`   | 否   | `"full"` | `"full"` 是目录发现的兼容请求名；`"list"` 表示仅处理明确路径              |
| `force`        | `boolean`  | 否   | `false`  | 仅在 `type="list"` 时区分已有来源是跳过还是定向刷新；`full + true` 已退役 |
| `metadataList` | `string[]` | 否   | `[]`     | `type="list"` 时必填且不能为空；内容是 metadata 文件相对路径列表          |

请求语义：

| POST 请求                  | 当前行为                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| `{}`                       | 遍历扫描目录以发现新作品；等价于 `type="full", force=false`                   |
| `type="full", force=false` | 目录发现；已有 Pixiv Source Reference 使用 `SKIP`                             |
| `type="full", force=true`  | 认证后返回 HTTP `410` 和 `FULL_SCAN_RETIRED`；不创建 `SystemJob` 或 `ScanRun` |
| `type="list", force=false` | 冻结明确路径；新身份可导入，已有 Source Reference 使用 `SKIP`                 |
| `type="list", force=true`  | 冻结明确路径；新身份可导入，已有 Source Reference 使用有界的 `REFRESH`        |

### 响应格式

生产稳态启用 Central Dispatcher。POST 成功表示任务已入队，返回 HTTP `202`：

```json
{
  "success": true,
  "queued": true,
  "jobId": "cmsz...",
  "scanRunId": "cmsz...",
  "status": "PENDING",
  "reused": false
}
```

调用方必须使用返回的 `jobId` 查询最终状态，不能把 `202` 当作扫描已经完成。任务状态响应：

```json
{
  "success": true,
  "jobId": "cmsz...",
  "scanRunId": "cmsz...",
  "status": "COMPLETED",
  "progress": 100,
  "message": "Scan completed",
  "error": null,
  "createdAt": "2026-08-19T01:29:30.000Z",
  "startedAt": "2026-08-19T01:29:31.000Z",
  "finishedAt": "2026-08-19T01:29:37.000Z",
  "data": {
    "totalArtworks": 15,
    "processedArtworks": 15,
    "succeededArtworks": 15,
    "skippedArtworks": 0,
    "failedArtworks": 0,
    "newImages": 31,
    "durationMs": 6000
  }
}
```

状态查询只允许读取由 Webhook 使用的 `SYSTEM + SCAN` 任务，不会返回其他后台任务的 payload 或内部结果。
Dispatcher 未启用时，仅保留故障隔离所需的旧同步执行路径；它同样拒绝全目录强制刷新，但成功时使用历史 `200`
响应：

```json
{
  "success": true,
  "jobId": "clt...",
  "data": {
    "totalArtworks": 10,
    "newArtworks": 2,
    "newImages": 5,
    ...
  }
}
```

普通失败响应：

```json
{
  "success": false,
  "error": "错误信息"
}
```

`type="full", force=true` 的稳定退役响应为：

```json
{
  "code": 410,
  "data": {
    "reason": "FULL_SCAN_RETIRED"
  },
  "message": "Directory-wide forced scans have been retired; use incremental discovery or an explicit metadata list instead",
  "success": false,
  "errorCode": 410,
  "error": "Directory-wide forced scans have been retired; use incremental discovery or an explicit metadata list instead"
}
```

常见状态码：

| 状态码 | 场景                                               |
| ------ | -------------------------------------------------- |
| `400`  | 请求参数非法，或 `SCAN_PATH` 未配置                |
| `401`  | Bearer Token 无效                                  |
| `404`  | 状态查询的 `jobId` 不属于 Webhook 扫描任务         |
| `409`  | 扫描任务冲突（已有扫描进行中）或任务被取消         |
| `410`  | 请求已退役的 `type="full", force=true`；未创建任务 |
| `202`  | 扫描任务已入队，尚未完成                           |
| `503`  | 服务未配置 `SCAN_WEBHOOK_TOKEN`                    |
| `500`  | 服务端内部错误                                     |

## 3. 使用示例

### 场景 A：扫描目录中的新作品

适用于定期任务，遍历扫描目录寻找新作品。

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/webhooks/scan"
TOKEN="your-secure-random-token-here"

curl -X POST "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 场景 B：扫描指定文件列表

适用于已知具体变更文件的场景，例如通过 `fswatch` 或 git 钩子获取到了变动的文件列表。

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/webhooks/scan"
TOKEN="your-secure-random-token-here"

# 指定要扫描的元数据文件相对路径
PAYLOAD='{
  "type": "list",
  "metadataList": [
    "112349563/ー/137026182-meta.txt",
    "9645567/HALLOWEEN/136994763-meta.txt"
  ]
}'

curl -X POST "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

若这些路径中的已有作品也需要重新同步 Pixiv 来源，在同一请求中增加 `"force": true`。该选项只刷新
`metadataList` 中的路径，不遍历或刷新整个扫描目录。

### 查询已入队任务

```bash
curl --get "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "jobId=cmszeyxot00ln110lvqz2go2z"
```

`PENDING`、`RUNNING`、`PAUSING`、`RETRY_WAIT` 和 `CANCELLING` 尚未结束；`COMPLETED` 表示成功；`FAILED`、`CANCELLED` 和 `SKIPPED` 是未成功完成的终态。`PAUSED` 需要管理员处理，自动化调用方不应无限轮询。
