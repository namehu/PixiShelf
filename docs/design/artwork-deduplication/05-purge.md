---
status: deprecated
scope: 旧隔离后手动永久清理计划的兼容入口，已被直接删除方案替代
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/direct-delete.md
---

# 旧第五阶段：隔离后清理（已替代）

2026-10-24 批准的新流程取消“先隔离、再 preparePurge、第二次确认清理”。使用[直接删除契约](./direct-delete.md)的一次不可恢复确认，Worker 完成全范围 fresh 校验后原地逐文件删除；实际删除后只保留删除记录，无恢复或到期清理。

保留原计划中的保留者保护、精确清单、逐文件意图/回执、原授权范围重试、来源墓碑、显式 allowReimport 和独立审查原则；原 ISOLATED/PURGING/PURGED 状态及 PURGE 授权不替代新 DIRECT_DELETE 目的、协议和关闭的独立能力门禁。普通 URL 回收删除的既有行为不变。

后续三批、最终验证与恢复依据见[总计划](../artwork-deduplication.md)，页面见[检查结果与删除记录](./ui-design.md)。旧契约和历史证据见[历史共享契约](./phase-3-contracts.md)及[暂停记录](../../records/artwork-deduplication-resume-pause-2026-10-24.md)。
