---
status: current
scope: 退役后的中央执行、历史快照与数据约束
last-verified: 2026-10-11
sources:
  - packages/pixishelf-db/prisma/migrations/20261011000000_background_task_retirement_contract/migration.sql
  - packages/pixishelf-worker/src/dispatcher.ts
---

# 后台任务兼容层退役

## 当前执行边界

App 固定通过中央队列入队，Worker 启动即消费 ARCHIVE_RESOLVE、ARCHIVE_DOWNLOAD 与 BACKGROUND_WRITER 三个 lane，每 lane 并发 1。
`CENTRAL_DISPATCHER_CUTOVER_ENABLED`、`WORKER_DISPATCH_ENABLED` 已退出配置；即使旧环境仍设置为 false，也不能禁止消费。
维护必须停止 App、scheduler、Worker 和外部写入者，不再支持依靠开关暗启动。

扫描、重扫、Webhook、迁移、本地导入、媒体维护、待替换和计划任务不再进入旧 App 执行器。
海报代表帧人工选择保留现有产品行为；共享解析、配对和文件校验不是退役目标。

归档暂停/继续/取消/重试继续使用专用事务，同时维护队列和领域状态；重试的新任务、归档重绑、未完成项重置和旧失败确认必须原子提交。
保留 403/509 恢复、原质量、已完成媒体及清理门禁。共享 E-Hentai Provider 的 Web 错误转换适配层保留。
失败收件删除仍保留 SystemJob/事件/回执；旧解析任务不能通过重试重新创建被删除收件。
REMOTE_NOT_FOUND 的人工重试不改变自动重试规则。

## 数据与接口

新增 `SystemJob.legacyDisplay` JSON，仅迁入 definitionVersion=0 的旧目标信息，结构为 schemaVersion=1、targetImageId、targetPath、mode（保留 null）。
它是只读展示快照，不是可执行 payload。新任务的展示目标来自校验后的版本化 payload；非法或未知版本不会回落到旧列猜测。
输出继续使用原展示字段名称并脱敏。媒体查询使用 JSON 表达式索引；代表帧保持活跃任务优先，视频优化保持最新创建任务优先，同时间由 id 稳定排序。

v0 历史不能暂停、继续、取消、重试或改优先级，已有失败确认不被重置。
第一阶段曾保留旧目标列与双写供 v0.50.8 回退。第二阶段删除这些列，接口展示字段仍由 payload/legacyDisplay 投影，不能将展示字段误当数据库列。

计划列表显示 `lastMaterializedAt/Date`（上次计划入队），移除逐任务执行时间编辑和 time 更新输入。
统一上海 00:00–08:00 窗口与每周核对规则不变；lastJobId 仍可能指向手动触发任务。

## 当前数据约束

`20261011000000_background_task_retirement_contract` 在单个事务中锁定任务、计划和资源租约表，先检查再回填、加约束、删列；异常整体回滚。

- App 入队/重试与 Runtime 子任务停止目标三列双写，删除 `targetImageId/targetPath/mode` 与旧目标索引；Worker 关键帧失败发现同样使用 payload/legacyDisplay。
- 删除计划 `time/timezone/mutexKey/lastTriggeredAt/lastTriggeredDate` 和 mutex 索引；保留 `scheduleMode`、启用、优先级、配置、物化记录及统一上海时区展示。
- `availableAt` 非空；旧空值只按该行 `createdAt` 回填。
- v0 只能为终态；历史快照、失败确认、事件与诊断保留，不提供执行控制。
- 中央任务执行态必须同时具有 workerId/leaseToken/leaseExpiresAt，非执行态三者均为空；不要求清空历史 heartbeatAt。
- 中央任务 SKIPPED 必须有 skipReason/skippedAt，其他状态两者均为空。
- 中央 SCHEDULE 任务必须有 scheduledForDate，计划删除后允许 scheduledTaskId 为空并保留日期；其他来源两者均为空。

约束不对 v0 历史强行补租约、跳过原因或计划日期。合法的已删除收件历史不重建、不删除。除 availableAt 外，违规数据只报告并阻断，不自动修复。

生产确认的日期、证据来源和限制见[发布记录](../records/operations/background-task-retirement-2026-10.md)。

已有库普通 App 启动在二阶段未完成时阻断，必须显式审计并迁移；空库允许初始化。Worker 要求二阶段 migration、删列和已验证约束满足后才能 READY。二阶段删列后不能仅换旧镜像回退。

发布、只读审计和恢复步骤见[两阶段发布手册](../operations/runbooks/background-task-retirement.md)。
