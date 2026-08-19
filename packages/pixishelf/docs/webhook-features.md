---
status: current
scope: GET/POST /api/webhooks/scan 的认证、扫描入队、状态查询和调用示例
last-verified: 2026-08-19
sources:
  - ../app/api/webhooks/scan/route.ts
---

# Webhook 扫描功能

PixiShelf 提供了一个基于 Webhook 的扫描触发机制，允许外部服务（如 Bash 脚本、CI/CD 流程或其他自动化工具）触发增量或全量扫描。

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
- **认证方式**: Bearer Token
- **Content-Type**: `application/json`

### 请求头 (Headers)

| Key           | Value                         | 说明                           |
| ------------- | ----------------------------- | ------------------------------ |
| Authorization | `Bearer <SCAN_WEBHOOK_TOKEN>` | 必须与环境变量中配置的令牌一致 |
| Content-Type  | `application/json`            |                                |

### 请求参数 (Body)

| 参数名         | 类型       | 必填 | 默认值   | 说明                                                                |
| -------------- | ---------- | ---- | -------- | ------------------------------------------------------------------- |
| `type`         | `string`   | 否   | `"full"` | 扫描类型。可选值：`"full"` (全量/增量扫描), `"list"` (指定文件列表) |
| `force`        | `boolean`  | 否   | `false`  | 是否强制全量重扫（**注意**：`true` 会清空数据库重新扫描，慎用）     |
| `metadataList` | `string[]` | 否   | `[]`     | 当 `type` 为 `"list"` 时必填。指定要扫描的元数据文件相对路径列表    |

### 响应格式

启用 Central Dispatcher 时，POST 成功表示任务已入队，返回 HTTP `202`：

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

状态查询只允许读取由 Webhook 使用的系统扫描任务，不会返回其他后台任务的 payload 或内部结果。Dispatcher 未启用时，POST 保持旧的同步成功响应：

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

失败响应：

```json
{
  "success": false,
  "error": "错误信息"
}
```

常见状态码：

| 状态码 | 场景                                       |
| ------ | ------------------------------------------ |
| `400`  | 请求参数非法，或 `SCAN_PATH` 未配置        |
| `401`  | Bearer Token 无效                          |
| `404`  | 状态查询的 `jobId` 不属于 Webhook 扫描任务 |
| `409`  | 扫描任务冲突（已有扫描进行中）或任务被取消 |
| `202`  | 扫描任务已入队，尚未完成                   |
| `503`  | 服务未配置 `SCAN_WEBHOOK_TOKEN`            |
| `500`  | 服务端内部错误                             |

## 3. 使用示例

### 场景 A：触发增量扫描 (扫描变更文件)

适用于定期任务或文件变更监控，扫描整个目录寻找新文件。

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/webhooks/scan"
TOKEN="your-secure-random-token-here"

curl -X POST "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 场景 B：扫描指定文件列表 (精确更新)

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

### 查询已入队任务

```bash
curl --get "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "jobId=cmszeyxot00ln110lvqz2go2z"
```

`PENDING`、`RUNNING`、`PAUSING`、`RETRY_WAIT` 和 `CANCELLING` 尚未结束；`COMPLETED` 表示成功；`FAILED`、`CANCELLED` 和 `SKIPPED` 是未成功完成的终态。`PAUSED` 需要管理员处理，自动化调用方不应无限轮询。
