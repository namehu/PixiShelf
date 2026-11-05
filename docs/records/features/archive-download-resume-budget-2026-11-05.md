---
status: historical
scope: 生产归档切换画质后等待下载的只读定位和继续命令修复
last-verified: 2026-11-05
sources:
  - packages/pixishelf/services/archive/archive-download-control.ts
  - packages/pixishelf/services/archive/archive-task-service.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - packages/pixishelf/services/archive/__tests__/archive-download-control-regression.postgres.test.ts
---

# 下载继续预算修复

2026-11-05，在 `v0.56.4`（`7d210af7`）的生产实例，EH 作品 `4183902` 的下载任务切换展示图后停在“等待下载”。DBX 只读核对确认导入和关联的 `ARCHIVE_DOWNLOAD@2` job 都已进入 PENDING，选定画质为 DISPLAY，原请求仍为 ORIGINAL。队列事件在 22:35:40（北京时间）记录了显式继续及 `ALL_INCOMPLETE` 准备意图。允许领取的时间已到，下载通道没有其他执行任务，READY Worker 仍上报心跳并支持该定义版本。目标没有执行租约，也未出现新的领取事件。

该 job 已执行三次，最近一次因需要人工处理而暂停。切换时 `attempt = 3` 且 `maxAttempts = 3`。旧命令把同一个 job 改为 PENDING，却没有为这次显式继续留出执行机会。领取 SQL 要求 `attempt < maxAttempts`，所以 Worker 在发出下一次图片请求之前就排除了该任务。下载明细仍显示旧检查点中的 194 页待下载和 3 页下载中，因为新执行还未开始准备。诊断角色无权直接读取执行准备、通道租约和限流相关表，以上判断以 job、队列事件、页面汇总和 Worker 心跳为依据。

修复将预算更新纳入既有 DOWNLOAD 继续事务，只在当前上限不足以允许下一次领取时补足。原 job ID、已发生的执行次数和已完成图片保留。后台任务页的归档继续操作和归档任务页的单项及 DOWNLOAD 批量继续使用相同控制服务。旧的不带 scope 的归档批量命令也对 DOWNLOAD 阶段采用同一规则。LEGACY 与 PUBLISH 各有继续路径，仍有达到执行次数上限的同类风险。本修复无需数据库迁移或配置变更。

隔离 PostgreSQL 回归 14 项通过。原图任务保留已完成的原图页，改用展示图后以第 4 次尝试被真实队列领取。仍有预算的继续操作沿用原上限。两种批量调用也复现了已耗尽任务在 PENDING 时无法领取，并验证暂停、显式继续及真实领取。

主应用 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 通过，单元测试 3798 项通过、393 项按运行环境跳过，归档服务定向检查 61 项通过。`pnpm docs:check` 检查 394 个 Markdown 文件，`pnpm docs:diagrams:check` 检查 34 个图源和 23 个内嵌 Mermaid 图，均通过。

本次修复目标版本为 `v0.56.5`。生产核对为只读。主应用升级后，管理员可在归档任务列表勾选仍处于等待下载的目标，从批量工具栏暂停，再显式继续。继续沿用已保存的展示图选择，Worker 启动后按已有准备意图处理未完成页面。
