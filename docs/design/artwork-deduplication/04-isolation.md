---
status: deprecated
scope: 旧隔离与恢复计划的兼容入口，已被直接删除方案替代
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/direct-delete.md
---

# 旧第四阶段：隔离与恢复（已替代）

2026-10-24 用户批准取消隔离、文件移动、恢复和到期清理。后续实施以[总计划](../artwork-deduplication.md)、[直接删除契约](./direct-delete.md)和[文件执行契约](./file-execution-contracts.md)为准：冻结预览后一次确认，由 Worker 在原位置逐文件永久删除，无恢复入口。

保留全局 keeper/copy 声明、写入口守卫、根/来源证明、真实 drain、PREPARE 和逐文件意图/回执基础。原 rename/no-replace、隔离目录、恢复冲突、URL 隔离后无限保留等目标不再实施；旧 ISOLATION 预览不能授权 DIRECT_DELETE。旧实现与测试可保留兼容，但新独立能力门禁默认关闭。

本页保留旧链接，不能当作现行操作手册。历史进度及 WIP 见[暂停记录](../../records/artwork-deduplication-resume-pause-2026-10-24.md)与[旧共享契约](./phase-3-contracts.md)。普通 URL 归档删除继续使用其原回收协议。
