# Webhook 扫描功能

PixiShelf 提供了一个基于 Webhook 的扫描触发机制，允许外部服务（如 Bash 脚本、CI/CD 流程或其他自动化工具）触发增量或全量扫描。

## 1. 配置

在使用 Webhook 功能前，需要在环境变量中配置安全令牌：

```bash
# .env 文件
SCAN_WEBHOOK_TOKEN="your-secure-random-token-here"
```

## 2. API 接口说明

- **接口地址**: `POST /api/webhooks/scan`
- **认证方式**: Bearer Token
- **Content-Type**: `application/json`

### 请求头 (Headers)

| Key | Value | 说明 |
| --- | --- | --- |
| Authorization | `Bearer <SCAN_WEBHOOK_TOKEN>` | 必须与环境变量中配置的令牌一致 |
| Content-Type | `application/json` | |

### 请求参数 (Body)

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `type` | `string` | 否 | `"full"` | 扫描类型。可选值：`"full"` (全量/增量扫描), `"list"` (指定文件列表) |
| `force` | `boolean` | 否 | `false` | 是否强制全量重扫（**注意**：`true` 会清空数据库重新扫描，慎用） |
| `metadataList` | `string[]` | 否 | `[]` | 当 `type` 为 `"list"` 时必填。指定要扫描的元数据文件相对路径列表 |

### 响应格式

成功响应：
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

| 状态码 | 场景 |
| --- | --- |
| `400` | 请求参数非法，或 `SCAN_PATH` 未配置 |
| `401` | Bearer Token 无效 |
| `409` | 扫描任务冲突（已有扫描进行中）或任务被取消 |
| `503` | 服务未配置 `SCAN_WEBHOOK_TOKEN` |
| `500` | 服务端内部错误 |

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
