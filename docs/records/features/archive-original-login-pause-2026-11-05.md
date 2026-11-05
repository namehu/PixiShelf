---
status: historical
scope: EH 原图登录跳转、暂停检查点和显式画质切换的修复验证
last-verified: 2026-11-05
sources:
  - packages/pixishelf-job-executors/src/archive/providers/e-hentai.ts
  - packages/pixishelf-job-executors/src/archive/executor.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts
  - packages/pixishelf/services/archive/archive-task-action-policy.ts
---

# 原图登录跳转与暂停恢复

## 生产记录与本机复现

2026-11-05，修复基于 `10fb306c`（`v0.56.3`），目标补丁为 `v0.56.4`。对生产 EH 作品 `4183902` 的首次归档任务执行只读数据库核对。任务仍处于下载阶段，选择原图，197 页中成功与失败均为 0。暂停记录为 `ORIGINAL_UNAVAILABLE` 和 `MEDIA_VALIDATION`，没有画质切换决策码。第 1 页保存的最终响应是同源 `bounce_login.php`。逐页状态为 194 页待下载、3 页下载中，后者已经写入数据库。

本机使用匿名请求复现该图片页。图片页返回 HTTP 200 和 HTML，内有一个可识别的 `fullimg` 原图链接。请求该链接返回 HTTP 302，响应体为空，重定向指向 EH 同源登录入口。访问该入口返回 HTTP 200 和 1,329 字节 HTML，其中表单的提交目标是 EH 论坛登录端点。本机与生产的网络和会话环境不同。生产最终地址与本机复现吻合，生产的完整重定向链没有单独记录。探测设置了超时和响应大小上限，未下载图片或使用登录凭据。

上一版仅识别 HTTP 401 和论坛登录地址，导致同源登录页进入图片解码并以文件无法解析的原因暂停。下载并发已经停止时，暂停结算能恢复尚在内存里的下载中记录，却遗漏了此前已持久化的下载中记录。

## 修复与验证

- 提供器在重定向请求和最终成功响应两处识别精确的 EH 登录入口。HTTP 401 继续单独处理，HTTP 403、额度限制和普通 HTML 按各自原因处理。Cookie 仍只发送到精确的 EH 原图入口，匿名请求和原图文件验收继续沿用既有规则。
- 列表和任务详情由服务端提供同一画质切换资格。可续跑的普通原图下载通过既有操作显式改用展示图。补全、原图升级、封存和清理状态均禁止切换。
- Worker 等待下载结束，在持有执行围栏的暂停事务中保存最后的检查点，再把数据库中仍为下载中的页面恢复为待下载。完成页和已有诊断保留。
- 定向回归通过。主应用任务界面和资格检查共 46 项，执行器 HTTP、登录和暂停相关单测共 56 项。PostgreSQL 15 隔离回归先持久保存 10 页完成和 2 页下载中，再触发登录暂停。请求流关闭，下载中清零，继续后只请求 2 页未完成图片。
- 同一隔离库中的 5 项画质切换回归通过。无收件归因及决策码的暂停任务从原图切换后，队列继续处理未完成页，Provider 收到展示图请求，原图成功回执保留。测试到下载封存并交接发布为止。补全、原图升级、已封存和发布阶段分别验证拒绝。既有混合画质发布及原图升级保持媒体身份的 PostgreSQL 场景也通过。
- 主应用 `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过，生成 46 个页面。`pnpm test` 通过 513 个文件、3,798 项，另有 54 个文件、386 项因数据库测试条件未启用而跳过。浏览器登录后的任务页操作未在本轮验收。
- Worker 依赖链的 `pnpm --filter @pixishelf/worker... typecheck`、`test` 和 `build` 均通过。其中数据库包通过 184 项、跳过 286 项，执行器包通过 1,181 项、跳过 565 项，Worker 包通过 121 项、跳过 12 项。上列 7 项隔离 PostgreSQL 用例已单独执行。构建仍报告既有的 `import.meta`／CJS 警告。
- `pnpm docs:check` 检查 393 个 Markdown 文件。`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 检查 34 个图源和 23 个内嵌 Mermaid 块。差异与主应用路径大小写检查通过。

本补丁没有数据库结构或环境变量变更。生产核对限于只读，已暂停的任务需由管理员在部署后显式继续原图请求或切换展示图。
