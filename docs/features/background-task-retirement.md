---
status: current
scope: 后台任务兼容层退役第一阶段实现、两阶段发布边界与待验收事项
last-verified: 2026-10-07
---

# 后台任务兼容层退役

## 第一阶段实现

App 固定通过中央队列入队，Worker 启动即消费 ARCHIVE_RESOLVE 与 BACKGROUND_WRITER 两个 lane，每 lane 并发 1。
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
旧 `SystemJob.targetImageId/targetPath/mode`、旧索引和全部计划列保留；App 与 Runtime 仍双写三列，供 v0.50.8 回退读取。

计划列表显示 `lastMaterializedAt/Date`（上次计划入队），移除逐任务执行时间编辑和 time 更新输入。
统一上海 00:00–08:00 窗口与每周核对规则不变；lastJobId 仍可能指向手动触发任务。

## 第二阶段（尚未实施）

第一阶段生产至少观察 7 天，通过日常任务、一次周级 GC、归档恢复、重启恢复和历史查询后，另行发布：

- 停止旧三列双写，删除旧三列与索引；
- 删除计划 time/timezone/mutexKey/lastTriggeredAt/lastTriggeredDate；
- 审计后收紧 availableAt、中央租约、SKIPPED 和计划来源约束，保留 v0 历史与计划删除后的日期；
- 保留双 lane 并发边界，合法的已删除收件历史不能视为需重建的孤儿。

当前 migration 链没有第二阶段删列或强约束迁移。不得把本文待办解释为已执行。

发布、只读审计和恢复步骤见[两阶段发布手册](../deployment/background-task-retirement.md)。
