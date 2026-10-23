---
status: current
scope: 原媒体写入异常的停写核验、一次授权、原任务恢复及回退边界
last-verified: 2026-10-23
sources:
  - packages/pixishelf-worker/src/media-content-recovery.ts
  - packages/pixishelf-db/src/media-content-recovery.ts
  - packages/pixishelf-job-runtime/src/media-content-control.ts
  - packages/pixishelf-job-executors/src/scan/media-content-recovery.ts
---

# 原媒体写入异常恢复

本文适用于已部署 `20261023002000_media_content_fingerprints`、`20261023003000_media_content_recovery_grants` 及配套 App/Worker 的版本。当前开发分支已通过独立代码审查，阶段证据见[验证记录](../../records/artwork-deduplication-phase-1-2026-10-23.md)，不能据此视为生产恢复已验收。只有停止 App、所有 Worker 与外部媒体写入，确认文件流退出，并保存数据库、媒体及领域恢复检查点后，才使用恢复 CLI。不能删除 gate、改根 namespace 或手改 CANCELLED 绕过恢复。

## 环境与恢复单位

恢复单位是原任务、会话、持久声明、领域检查点及同点媒体。参照[备份与恢复基线](../backup-and-recovery.md)准备恢复依据；文件根的设备/inode/身份变化时必须停止，不能修改命名空间或删除状态记录来绕过。本文不提供物理根自动重绑定。

使用与实际 Worker 相同的 DATABASE_URL、SOURCE_MEDIA_ROOT（兼容 SCAN_PATH）、ARCHIVE_ROOT（兼容 ARCHIVE_STORAGE_PATH）。CLI 会读取库存根标记绑定并通过物理根解析器核对路径、设备和 inode；不同物理根会拒绝。正式构建产物为 packages/pixishelf-worker/dist/media-content-recovery.cjs。

```bash
node packages/pixishelf-worker/dist/media-content-recovery.cjs inspect --job JOB_ID --session SESSION_ID --output /absolute/recovery-inspection.json
node packages/pixishelf-worker/dist/media-content-recovery.cjs grant --snapshot /absolute/recovery-inspection.json --expect INSPECT_DIGEST --backup-checkpoint VERIFIED_CHECKPOINT_REF --operator OPERATOR --confirm-all-writers-stopped
node packages/pixishelf-worker/dist/media-content-recovery.cjs resume --grant GRANT_ID --operator OPERATOR --confirm-all-writers-stopped
```

inspect 只读数据库并独占创建 0600 快照文件，不覆盖已有文件。核对完整声明、根身份、source 范围和领域检查点后，grant 用摘要 CAS 创建一次授权，不解锁、不写媒体、不排队。resume 在仍全部停写时复核 ACTIVE 授权和原范围，将原 job 置为 PENDING 并预留下一 attempt，保留 job/session/声明身份。授权仍为 ACTIVE，随后重启 Worker，由其下一执行围栏消费；消费后仍须领域执行器验证和恢复文件，最终 publication 才结束 gate。

恢复仅适用于受支持的 PENDING_REPLACE（BATCH/RESTORE）、MIGRATION、VIDEO_STREAMING_OPTIMIZATION、ARCHIVE_MAINTENANCE（非 CLEAN_STAGING/RECONCILE）和受限 ARCHIVE_PUBLISH。PUBLISH 的 rename 前恢复核对原领域快照与文件检查点；其 postrename 自动交接仍只接受 final manifest 完整、staging 明确不存在的“仅剩 DML”证明。

如果 grant 已提交但回执丢失，可在现场仍未变化时重放完全相同命令；CLI 再核对物理根和全局停写状态，DB 再核对完整快照、范围、版本、操作者和备份检查点，返回原 ACTIVE grantId，不增加授权或审计。已有 ACTIVE 授权时更换任一输入均拒绝。

resume 不创建新任务。重复 resume 只在原 job 仍 PENDING、未增加 attempt、同一授权仍 ACTIVE、完整快照未变且有前次排队审计时幂等。归档发布同时将精确原 ArchiveImport 绑定恢复为 PENDING，不改变封存 generation、manifest 或成员。已消费/撤销授权、内容变化、活动任务/租约/近期 Worker 心跳或根变化均拒绝。普通 FAILED retry 若有遗留声明会拒绝创建新 job，须走原任务恢复。

## 撤销授权

尚未消费且不再使用的授权可撤销：

```bash
node packages/pixishelf-worker/dist/media-content-recovery.cjs revoke --grant GRANT_ID --operator OPERATOR --reason REASON
```

撤销保留 gate 和文件，不回收已消费授权，不自动取消已排队的 job。原已撤销/消费授权的命令重放不会重新激活它。如撤销后仍需恢复，应重新核验现场和新的备份检查点，使用该检查点引用明确创建新授权；不得篡改旧引用，也不会复用旧授权行。

## 页面控制与取消

PENDING/RETRY_WAIT/PAUSED 存在 ACTIVE/READY/RECOVERY_REQUIRED 声明时拒绝直接取消；RUNNING/PAUSING 仅当前 token/attempt 拥有全部声明才允许请求取消。原执行者只有验证回滚或安全收口后，才可同一 fenced finalizer 结束声明并取消。若 CANCELLING 执行租约过期且声明仍在，任务改为 PAUSED/ACTION_REQUIRED，消息“取消未完成，需恢复处理”；清 cancelRequestedAt 和租约，原取消时间及未完成原因保留在 job.paused 审计。原 job/session/gate 不变，不自动执行。非 PUBLISH 的普通继续需已有下一 attempt ACTIVE 授权；PUBLISH 显式继续仍依赖专用文件证明或离线授权。无声明取消行为保持原状。

归档重试：两个专用入口仅在原 FAILED ARCHIVE_PUBLISH/PUBLISH 持有本 job 的唯一 ACTIVE DIRECTORY 声明且业务执行绑定仍一致时，复用原 job 排队。其他 job/session 声明、画质/范围变更和终态 CANCELLED 拒绝；无声明仍沿用创建新 job。存在 publication gate 时 App 暂存清理入口拒绝创建清理意图，Executor 与 RECONCILE 同样拒绝破坏未完成发布的恢复证据，发布声明和清理共用协调锁。

## 上传与同步删除

App 上传、替换及同步删除不使用 Worker job 授权。它们绑定原账户、原上传会话或 operationId，使用既有页面显式续传、回滚或重试原清单。恢复 manifest 与残留文件位于 `.pixishelf-upload-recovery`，必须随原媒体同点备份，不能当缓存删除；原目录锁不按超时自动抢占。确认旧写入已退出之前，不手工移除文件锁或源声明。同步删除无法找回已经删除的文件，恢复依赖完整备份；操作语义见[作品删除](../../features/artwork-deletion.md)。

## 升级与回退

停止 App、Worker 和外部写入者，先保存完整检查点，再执行正式 migrate deploy，随后部署理解声明/授权的配套 Worker 与 App，最后恢复入口。迁移本身不扫描媒体。存在活动、待恢复声明或已消费但未收口授权时，不得直接降级到忽略该协议的旧版本，也不得只回退数据库或单独删除新增表。优先修复并继续原操作；需要整体回退时恢复数据库、媒体、领域 manifest 与程序的同一检查点。
