---
status: historical
scope: 第一阶段 DB 与控制面两项独立审查问题的定向修复证据
date: 2026-10-23
---

# P2-DC01 与 P2-DC02 修复交付

范围限于独立审查两项：未改 Executor、App 上传删除、迁移及队列状态机。

DC01：导出既有 lockContentControlJob 并由归档单项/批量 PAUSE、RESUME、CANCEL、RETRY 一致先取得 resource/job 行锁，再取发布 coordination advisory 锁。锁后比对原 job 绑定、原 import/job 状态，保留既有 updateMany CAS。单项/批量 USE_DISPLAY_QUALITY 的 resume/retry 路径也沿用该顺序。

DC02：grant 先重新完成 inspect 的全局停写锁与现场完整快照 CAS，再查原 ACTIVE。完整规范 snapshot、digest、原 job/session、expected/target attempt、operator、backupCheckpointRef 精确相等才返回原 ID/nextAttempt，不增加授权或 GRANTED 审计；任一不符拒绝。已撤销/消费的原检查点引用拒绝重放；撤销后需新核验检查点明确创建新授权行，不重用旧行。CLI 每次仍执行物理根校验。共享契约和正式 runbook 已同步。

验证：

- App PostgreSQL 新增并发 8 例通过：单项/bulk 互换执行 RESUME/CANCEL、PAUSE/CANCEL、RETRY/RETRY；用真实 coordination 持锁和 pg_stat_activity 等待屏障制造交错，无 40P01，仅一个 APPLIED、另一个 STATE_CONFLICT，任务/领域最终状态一致、一次对应转换事件；另有两个入口与实际 runtime withFencedMutationTransaction 的 resource/job→coord 并发验证。
- DB PostgreSQL 新增 14 个独立用例均验证通过：跨事务提交后丢回执精确重放；operator、backup、重新计算 digest 的篡改 snapshot、attempt、domain、source、root、scope、declarationVersion、Worker、lease、revoked、consumed 拒绝。首次执行 13 通过，root 用例因期望写为 STALE 失败，修正为现有 ROOT_CHANGED 后只重跑 root/revoked 两例通过。撤销用例同时验证只换 operator 不能绕过，新的检查点建立不同 ID 的新授权。
- 真实 CLI 1 条链路通过：ACTIVE 精确重放同 ID/一条授权/单个审计，重放时物理根变化仍拒绝，撤销旧命令拒绝、新检查点新授权、原 job resume→下一 attempt consume。
- archive-module / archive-task-service 单元 32 通过。
- App tsc --noEmit 和 DB typecheck 通过；git diff --check 通过，App 大写路径搜索无匹配。
- 未重复全量 build/test 或全局文档/图示检查；dedup_tests 专用库仅唯一合成 fixture，清理自身行，不改正式迁移。

后续独立窄复审已通过；审查者另执行并发控制 8 项、授权重放 14 项、真实 CLI 1 项，完整结论见[独立审查](./artwork-deduplication-phase-1-data-control-review-2026-10-23.md)。本记录只保存实施修复证据。
