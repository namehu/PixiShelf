---
status: historical
scope: v9 热检查整轮复用的独立代码审查与定向验证
last-verified: 2026-10-30
sources:
  - packages/pixishelf-db/src/artwork-dedup-hot-run.ts
  - packages/pixishelf-db/src/artwork-dedup-hot-run-reuse.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/hot-run.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
---

# 独立审查

日期为 2026-10-30，基线 `c8d1f380`，审查对象为分支 `codex/dedup-hot-run-reuse` 的本轮未提交改动。审查者未修改实现，只提交本记录与临时表复现 SQL。依据为仓库工程、测试、产品及恢复规则和[批准设计](../../../design/artwork-deduplication/hot-run-reuse.md)。本记录不证明生产部署或 NAS 性能。

## 发现与修复复核

1. **P2：跨复制页排序变化会静默丢失图片证据。** 修复前 `pages` 每页按当前图片顺序重新计算目标 ordinal，而持久游标只记录历史 ordinal；复制首批 1,000 行后改变排序，后续页会与旧 ordinal 冲突并被 `ON CONFLICT DO NOTHING` 跳过。使用[纯临时表 SQL](./order-copy-pre-fix-repro.sql)在专用隔离库执行，首批复制 1,000 行，排序后源页剩 1 行、实际复制 0 行，最终源 1,001 行而目标只有 1,000 行。会话 `ROLLBACK`，未读写业务表。修复增加独立的 `projectionDigest`，事务内锁定 Image 行并覆盖顺序和媒体分类，每批及最终发布重新核对；变化时清理本轮复制图并从同一历史来源重新分页复制。
2. **P2：最终复制后的分类变化回退可能误跳过视觉准备。** 原末次复制已经保存 `visualStatus=COMPLETE`；最终分类变化触发重新复制，继而因历史覆盖不兼容回退时，若只清媒体行却保留完成标志，`prepareVisualVersions` 会提前返回，随后面对 PENDING 媒体报 `FILE_CHANGED`。修复使 abandon 同时恢复本轮视觉状态、原因、游标、轮次、候选、关系版本及已复制计数；保留已经核对的原件与全局文件／特征缓存。
3. **P2：废弃复制被重复计入复用数量。** 已提交图因排序重启后再次复制，会重复增加 `copiedRows` 和 `reusedRelations`。修复把当前复制数量保存在同一持久检查点，重置／放弃时原子扣减净值，并独立累计 `discardedCopyRows`、`discardedReusedRelations`。最终发布重置的修正合并到该事务唯一一次性能快照，避免重复累计事务和 active 时间。

上述修复的代码路径已复核，并读取了核心作者在专用隔离库运行的[完整定向测试输出](./review-regression-tests.log)：3 项通过，25 项因本次过滤未执行。跨 1,000 行恢复后保留全部 1,212 行证据；净复制计数与废弃复制量分账，最终排序变化只重新复制，最终分类变化正确回到普通视觉准备。上述 P2 发现关闭，本次审查未保留未解决的 P1／P2。

此前 12:16 的三个定向场景曾全部失败，当次摘要未包含完整错误栈。大批排序 fixture 的查询取消后，核心作者保存该隔离库私有 dump，确认无活动查询，再重建该专用库并执行正式迁移；其它测量库未改动。12:19:35 的最终运行通过，保留初次失败事实。该测试库重建不是生产恢复演练。

## 其他核对结论

- 每次原件提交重新取得 execution、catalog、根／目录、Artwork 与 Image 的本事务权限，检查归属、路径、修订、写入状态、目录身份和完整缓存属性。普通预读不授予写权限。
- 500 原件／50 作品批次、单作品跨批游标、完成作品和原件计数在同一事务提交；快照为函数局部数据，取消、暂停、返回和切换执行不保留长期元数据缓存。
- 整轮复用要求完整历史、同艺术家、作品／成员／文件身份、检查选项和版本兼容；FULL、缺缓存、失败及超限结果回到普通路径。明确的动图排除与完整无匹配结果可复用。
- 复制仅包含分组、关系、图片证据、必要缓存明细和完成事实；未复制 review 选择、operation 或删除授权。历史来源按复制事务锁定；完成后结果与历史来源无外键依赖。
- App 创建／重试能力门禁、扫描任务版本与预算暂停后的 resume 均引用最新版本常量，因此接受 v9。部署的 Worker 只注册扫描 v9；历史执行器只用于测试生成旧已完成样本。
- 新 migration 与上一版 `system_jobs_dedup_policy` 逐字比对，除扫描允许版本增加 9 外完全相同；没有扩大维护任务、lane、优先级或 payload 规则，也没有增加表、修改列或清理历史。
- 数据库 API 计数与 SQL 数量分开。运行时计时仅在成功提交后回调，最终提交未覆盖部分显式标记 `transactionTiming.complete=false`，未将未知值记为零。

## 已实际执行的独立检查

| 范围                                                                           | 实际结果                  |
| ------------------------------------------------------------------------------ | ------------------------- |
| `hot-run.test.ts`、`executor-lifecycle-telemetry.test.ts`、`telemetry.test.ts` | 修复后定向 24/24 通过     |
| `queue-repository-mutation-timing.test.ts`                                     | 6/6 通过                  |
| Worker `executor-registry.test.ts`、`runtime-dispatcher-queue.test.ts`         | 17/17 通过                |
| 新旧约束正文等价断言                                                           | 通过，唯一变化为扫描 v9   |
| `git diff --check`                                                             | 无问题                    |
| `rg --files packages/pixishelf \| rg '[A-Z]'`                                  | 无匹配                    |
| 修复前 PostgreSQL 临时表复现                                                   | 如上，确认丢失 1 行并回滚 |

另外，核心作者运行、审查者读取完整输出的新增 PostgreSQL 恢复专项为 3/3 通过，25 项过滤未执行；本记录明确区分独立执行和读取他人运行证据。

只运行本轮相关专项，未运行主应用全量 lint／test／build，也未操作生产或主目录。元数据回退单测通过注入小阈值验证分支，不代表实际分配了 800 MiB；完整性能、真实 Worker 重启和桌面验收分别由本轮对应证据说明。

## 限制

- 核心作者后续运行的整份 hot-run PostgreSQL 专项、完整类型检查与测量结果不包含在此独立审查结论中，以本轮最终记录为准。
- 本轮独立审查不替代实际 Worker 崩溃重启、浏览器删除确认或真实合成删除验收。

## 测量后日志补充复审

同日 A/B 运行后发现，整轮复用路径的性能摘要尚未填入 `inputDigest` 和 `searchVersion`。补丁在 `onHotRunBatch` 中解析该事务已经读取的本轮 v4 检查点，把其中的输入摘要和检索版本传给已有的 `saveTelemetry` delta；没有增加查询、事务或结果写入，也没有调整算法和执行权限。后续快照未覆盖这两个字段时，`advanceArtworkDedupPerformance` 保留已有值。定向复审未发现新增 P1／P2。

独立执行 `executor-lifecycle-telemetry.test.ts -t 'persists hot-run aggregates'`：1 项通过，11 项过滤未执行。该用例加入 v4 检查点，确认最终快照仍含输入摘要和检索版本。随后按审查建议，把用例初始 `searchVersion` 也明确设为 null，主 agent 再次执行该单例通过；复核确认两个字段都从 null 补齐并保留到最终快照。未重复其它专项或 A/B，测量原始证据中的 null 值没有改写；测量冻结代码与最后日志补丁的区别由测量记录说明。
