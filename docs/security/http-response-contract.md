---
status: current
scope: 扫描迁移 HTTP 错误、Webhook 兼容响应与未迁移入口
last-verified: 2026-10-22
sources:
  - packages/pixishelf/lib/api-handler.ts
  - packages/pixishelf/types/http-response.ts
  - packages/pixishelf/types/scan-webhook.ts
  - packages/pixishelf/app/api/webhooks/scan/route.ts
---

# HTTP 响应契约与兼容边界

`POST /api/scan/stream`、`POST /api/scan/rescan` 与 `POST /api/migration/stream` 在建立 SSE 前统一返回
`{ code: number, message: string, data?: unknown }`，其中失败 `code` 等于 HTTP 状态码。
参数/路径/配置错误使用 400，缺失会话使用 401，作品不存在使用 404，任务冲突使用 409；
未分类异常使用 500 和固定 `Internal Server Error`（`data: null`），异常经应用 logger 脱敏后写入服务端日志。
Zod 校验错误的说明位于 `data.details`。这些 HTTP 响应不再附加 `success/errorCode/error` 别名。

声明 `Content-Type: application/json` 时必须提供合法 JSON 对象：无内容、非法 JSON、数组、null
或原始值均返回 400，不能落入扫描请求默认值而触发全目录扫描。合法空对象 `{}` 保留默认目录发现行为；
未声明 JSON 内容类型仍按原有参数合并规则执行。校验顺序仍为代理认证、Route 输入校验、Route 会话复核。

已建立连接后的 `connection/progress/complete/error/cancelled/queued` SSE 事件保持原结构，
包括事件中的 `success/error` 字段。扫描设置与作品重扫入口优先读取
HTTP `message`，同时兼容旧 `{ error }` 响应。迁移页面对不可重试的 4xx（不含 429）同样读取 `message`，再回退到 `error`；非 JSON 或无有效文案时显示带 HTTP 状态码的通用提示。429/5xx 沿用既有连接处理。

`apiHandler` 默认使用 canonical 响应，浏览器和服务端共用 `types/http-response.ts` 的 `ApiResponse<T>`。
Webhook POST 显式使用 `responseContract: 'compatible'`：失败补齐 `code/message/data`，同时保留
`success/errorCode/error` 与顶层校验 `details`（同样放在 `data.details`）；成功 202 的入队 DTO 放在
`data`，同时保留原顶层 `queued/jobId/scanRunId/status/reused`。Webhook GET 健康检查及所有显式失败
响应采用同样字段，HEAD 成功仍为无正文 204。Webhook 保留原有宽松 JSON 解析，不在响应迁移中收紧
请求；调用方应发送明确的合法对象 `{}`，不能依赖错误 JSON 触发默认扫描。

Webhook GET 状态查询成功是明确的兼容例外：`LegacyScanWebhookStatusResponse` 保留可空的任务
`message/error` 与 `data` 统计，不能将它们解释为请求失败或通用 envelope；不新增 `code`、不搬移统计。
查询失败仍使用上述兼容错误，数据库未知异常返回通用 500。外部脚本应先检查 HTTP 状态，再判断任务
`status`。待外部消费者具备版本协商后再迁移该成功 DTO，不能无计划覆盖领域字段。

`lib/api-response.ts` 的媒体上传、分块状态、媒体替换和 scheduler API 仍沿用既有 `success/error`
及顶层业务字段；其 `ApiSuccessResponse/ApiErrorResponse` 不是当前 canonical 类型。后续若修改响应，须按
各路由与消费端成对迁移，覆盖上传分块/完成、替换冲突详情和 scheduler Token 响应；不能直接改共享
helper 令所有路由换壳。这几类响应仍各有边界，不能宣称全局 API 已统一。

认证与脱敏原则见[权限边界](./access-control.md)，外部调用示例见[扫描 Webhook](../../packages/pixishelf/docs/webhook-features.md)。
