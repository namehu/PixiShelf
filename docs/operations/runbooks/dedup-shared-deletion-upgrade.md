---
status: current
scope: 从旧专用去重删除切换到通用作品删除的升级门槛
last-verified: 2026-10-31
sources:
  - packages/pixishelf-worker/src/dedup-deletion-upgrade-gate.ts
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# 去重删除切换门槛

适用于仍包含旧 ARTWORK_DEDUP_MAINTENANCE 的版本升级到共享普通删除版本。本版本不再执行或重试旧 PREPARE/DELETE，保留表和历史供查看；先在旧版本收口，不能部署后依赖新兼容执行器续跑。恢复单位为[数据库与媒体同点检查点](../backup-and-recovery.md#发布前一致性检查点)，代码回退不会恢复已删文件。

## 先盘点，达到停止条件就保留旧版本

在停写和备份窗口只读核对以下事实；表名取自当前 Schema，不执行修改：

```sql
SELECT id, status, mode, "preparePurpose", "readerState", "readerToken",
       "deleteStartedAt", "movedFiles", "restoredFiles", "deletedFiles", "jobId"
FROM "ArtworkDedupOperation" ORDER BY "createdAt";
SELECT id, status, attempt FROM system_jobs
WHERE type = 'ARTWORK_DEDUP_MAINTENANCE'
  AND status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING');
SELECT "artworkId", "operationId", role FROM "ArtworkDedupClaim";
SELECT id, "ownerOperationId", status FROM "ArtworkDedupSourceIdentity" WHERE status='HOLD';
```

同时按 operationId 核对旧 OperationFile、FileReceipt、原件与恢复清单。只看累计计数不足以证明零文件变化；删除意图已写、文件已移动／缺失但回执未写也属于未收口。读取现场须遵循原版本的路径和身份校验，不按文件名猜测。

- 活动旧 job、claim/HOLD、未退出 reader、已开始却未收口的文件动作存在时停止升级。实际已开始的操作由旧版本按原授权清单完成或按旧恢复流程收口；不得盲删执行和占用，也不能仅把 SystemJob 改为终态。
- 零文件动作的未授权预览或失败准备，核对无读写进程后通过旧版本明确取消并释放原占用。旧取消仍卡住时，按故障恢复流程保全并由管理员审查该 operation 的精确修复，不能运行泛化的清占用 SQL。
- 无活动 job、无占用、无 reader、无文件动作的终态 FAILED 是纯历史，保留只读即可；它不会使新 Worker 永久无法启动。无占用的未提交 READY 草稿同样不会产生新执行授权，升级前宜在旧版本取消。
- 旧 DELETED/PURGED/RESTORED/CANCELLED 历史保留；已完成来源 tombstone 不清除。若仍有 claim/HOLD 或 reader，仍须先核实实际未结事实。

Worker 启动会检查活动旧 job、claim/HOLD、reader 及未收口动作的业务标记；此检查是最后门禁，不代替文件现场盘点。门槛通过后再按标准部署启动 App/Worker，核对新 ARTWORK_BATCH_DELETE 能力及旧维护执行注册已移除。出现门槛错误时回到旧版本恢复窗口处理，不通过删除历史记录绕过。

已知 COMPLETED LEGACY 导入可能早于 generation 表：旧 drain 的代次数要求不能证明它们仍在执行。普通回收只阻止真实活动导入。具体生产取消事实及本次隔离证据放在[记录](../../records/dedup-shared-deletion-2026-10-31.md)，本手册不授权对生产重复操作。
