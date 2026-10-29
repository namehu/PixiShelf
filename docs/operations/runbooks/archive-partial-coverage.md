---
status: current
scope: 部分归档协议升级、退休修订故障保全与成组回退
last-verified: 2026-10-29
sources:
  - packages/pixishelf-db/prisma/migrations/20261029110000_archive_partial_coverage/migration.sql
  - packages/pixishelf-worker/src/production-capabilities.ts
  - packages/pixishelf-job-executors/src/archive/phase-handoff.ts
  - packages/pixishelf-job-executors/src/archive/retire-partial-executor.ts
  - packages/pixishelf-job-executors/src/scan/media-content-recovery.ts
---

# 部分归档升级与恢复

适用于尚未部署 `20261029110000_archive_partial_coverage` 的已有实例，或已升级实例的补全／退休异常。目标是保存下载覆盖事实并支持显式补全，业务规则仅维护在[部分归档规格](../../features/archive-partial-coverage.md)。生产执行前遵循[标准部署](../deployment.md)和[备份基线](../backup-and-recovery.md)。

**停止条件**：无法证明数据库与媒体恢复点一致、旧写入者仍在运行、migration 异常、新任务能力不匹配，或退休证据／替代文件无法核验。保持停写、保全现场，不通过删列、改任务终态或手工删除目录绕过。

**恢复单位**：数据库（含任务、媒体写入声明、覆盖与退休字段）、原媒体（含 staging 和全部仍保留修订）、派生媒体、Pixiv data、配置及匹配的 App／Worker。不能只恢复数据库或切换旧镜像。

## 升级顺序

1. 停止调度、Webhook 和外部维护触发，完成或受控暂停／取消活动任务，再停止 App、Worker 和全部文件写入者。确认旧 Worker 已退出。
2. 按[一致性检查点](../backup-and-recovery.md#发布前一致性检查点)保存完整恢复集合及实际版本、migration 状态、任务清单；在隔离环境验证备份可恢复。保留补全前旧目录，不把它们当可重建缓存。
3. 使用目标版本生成 Prisma Client，显式部署 migration 并确认成功。使用已核对的受控数据库连接，不把连接秘密记入日志：

   ```bash
   pnpm --filter @pixishelf/db db:generate
   pnpm --filter @pixishelf/db db:deploy
   pnpm --filter @pixishelf/db db:status
   ```

4. 协调启动配套 App 和单 Worker，保持调度关闭，运行既有 READY 与 capability audit。核对解析、下载、发布和维护的新版本能力，再开放提交与调度。
5. 用受控样本核对部分归档 → 补全 → 旧副本退休 → 回收／恢复；登记版本、任务／修订 ID、退休检查点及文件抽样证据。正式环境的通过结论必须另有发布记录。

migration 增加 `ArchiveDownloadScope`、收件／导入／修订的覆盖字段和补全快照，以及修订退休意图、检查点和替代关系；它不删除记录、不移动媒体。旧记录默认 `ALL`，来源总数与摘要为空，不假造历史来源页数。禁止用 `db:push` 替代 migration 历史。

## 任务兼容边界

新收件解析、归档下载／发布和新维护命令使用 definition version 2，具体集合由 [production-capabilities.ts](../../../packages/pixishelf-worker/src/production-capabilities.ts)与注册表核对。配套 Worker 同时保留这些任务的 version 1 执行器，继续处理既有任务；旧导入的后继阶段可继续使用 version 1，不需要改写历史 payload。`RETIRE_PARTIAL_REVISION` 只存在于维护 version 2，version 1 校验器不接收此 action。

version 兼容是新 Worker 执行旧任务的能力，不代表旧程序能读取新生命周期。新 App 不能与缺少 version 2 能力的旧 Worker 混跑；也不能把新任务手工降为 version 1。

## 退休异常与保全

首先核对当前完整修订、替代关系、退休意图、`retirementStartedAt`／`retiredAt`、相关 SystemJob／事件、原媒体写入声明，以及两侧 manifest 和文件。不要仅根据目录存在或任务状态判断发布／删除成功。

| 现场                                         | 处理                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| 补全尚未发布                                 | 保留旧当前修订；通过原归档任务暂停、重试或取消，新 staging 沿用通用清理规则        |
| 完整修订已发布，退休失败                     | 完整作品继续作为当前版本；保留旧目录和证据，解决占用或冲突后重试专用维护任务       |
| 已有退休开始检查点，旧目录部分或全部缺失     | 保全完整替代目录及声明，使用兼容执行器／领域恢复复核后续行；不创建空目录伪装旧副本 |
| 没有退休开始检查点，旧目录缺失               | 视为媒体异常并停查，不能写入退休完成标记掩盖缺失                                   |
| `retiredAt` 已提交                           | 旧目录缺失是预期；回收、恢复和 purge 跳过这条历史实体，不从零补建旧 revision       |
| 替代目录、哈希／长度、来源快照或引用关系不符 | 保留所有现有文件并停止清理，按完整备份恢复或专项领域核查处理                       |

原媒体声明有未完成或结果未知状态时，使用[原媒体写入异常恢复](./media-content-recovery.md)；不要通过改声明状态释放互斥。退休只清重复旧实体，不能以它代替普通作品永久删除或任意历史目录清理。

## 回退

回退前停止新提交、调度和全部写入者，保全目标版本产生的 dump、任务／事件、manifest 与媒体，确认将丢失哪些检查点后的作品和整理数据。

旧代码对回收／恢复／永久清理仍假定所有历史 revision 对应目录存在；成功退休已使该假设失效。即使队列里没有 version 2 任务，也禁止直接启动旧程序配当前数据库和媒体。删除新字段或退休标记不能把已删除目录恢复回来。

优先运行理解覆盖与退休标记的兼容修复版本。确需退回不支持此协议的旧版本时，在隔离环境验证后，将数据库、全部媒体根、配置和 App／Worker 成组恢复到启用该协议前的一致检查点，再按标准恢复顺序开放。不得把新数据库配旧媒体，或把旧数据库指向退休后的媒体目录；正式覆盖及数据损失由实例管理员按备份基线明确批准。

发布检查点至少保留到稳定观察结束、回退窗口关闭且下一套完整备份通过恢复验证。当前隔离环境与尚未完成的验证见[本次记录](../../records/features/archive-partial-coverage-2026-10-29.md)。
