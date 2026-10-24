---
status: partial
scope: 第三阶段只读 PREPARE 来源检查、分页清单与目录检查点小批交接
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-prepare.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-prepare.postgres.test.ts
---

# PREPARE 只读执行小批

本批仅实现内部只读 pipeline；未注册维护 Worker executor，未开放 PREPARE 高级入口，也未开放原媒体移动或删除。共享阶段门禁仍为 2。按额度收口指令冻结在此边界，尚未独立审查；不能据本记录宣称第三至五阶段验收。

文件写入基础的 P1/P2 修复延续上一记录。原 Sol 独立复审及缩减的只读复审均被平台风险检查拦截，没有继续重试或绕行，状态仍为“已修复、待独立复审”。本批只读验证不替代该复审。

## 冻结范围

- `packages/pixishelf-job-executors/src/artwork-dedup/maintenance-source.ts`：真实来源文件身份与摘要；复用 Pixiv metadata、章节解析器；归档 manifest 身份和严格条目检查；16 MiB/5 MiB 上限及每读块进度。
- `packages/pixishelf-job-executors/src/artwork-dedup/maintenance-directory-checkpoint.ts`：十进制纳秒属性、100 项目录页、10,000 项总预算、12 层有界 DFS 游标。
- `packages/pixishelf-job-executors/src/artwork-dedup/maintenance-prepare.ts`：50 个 Image 页（带章节最多 100 行）、最多 4 个真实 stat 并行、来源串行、来源唯一行续跑、短围栏事务同时提交文件/计数/媒体游标；只遍历有登记后代的独占目录，未知附件或子树保持 BLOCKED。
- `packages/pixishelf-job-executors/src/artwork-dedup/reader-protocol.ts`、`reader-child.ts`、`reader.ts`：固定 reader 内增加互斥的 maintenance-source 请求，沿用进度、停滞和 close 规则。文件还包含上批 maintenance-inspect/directory/capability 改动，审查需区分来源读取与尚待独立复审的写基础。
- `packages/pixishelf-job-executors/src/scan/content-reader.ts`：稳定读取增加可选逐块进度回调，原调用行为不变。
- 新增附近测试 `maintenance-source.test.ts`、`maintenance-prepare.postgres.test.ts`；更新执行契约 PREPARE 只读段。

数据库、共享 DTO、App 和其他协作者文件由对应负责人维护，本批没有修改。没有触碰规模基准、冻结测量源码和实际媒体库。

## 验证证据

受影响测试命令：

```bash
pnpm --filter @pixishelf/job-executors test src/artwork-dedup/__tests__/maintenance-source.test.ts src/artwork-dedup/__tests__/reader.test.ts src/scan/__tests__/content-reader.test.ts
```

结果 **33/33 通过**（14 新来源/游标，12 reader，7 stable-read）。覆盖真实 Pixiv ID、章节规范摘要、201 项归档 100/100/1 有界响应、重复/越界引用、超限读取前拒绝、硬链接/符号链接、纳秒游标及损坏范围。

仅隔离 `dedup_executor_next` 正式 migrate deploy 至 **110**（`20261024001300_artwork_dedup_reference_indexes`），未 generate。随后：

```bash
QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next?connection_limit=20&pool_timeout=20' pnpm --filter @pixishelf/job-executors test src/artwork-dedup/__tests__/maintenance-prepare.postgres.test.ts
pnpm --filter @pixishelf/job-executors typecheck
```

真实 PostgreSQL＋真实受控 child **9/9 通过，测试耗时 9.473 秒**。每组先执行真实 SCAN 产生完成分组，再冻结操作并通过真实队列 claim、全局 reader latch 和租约围栏对接 PREPARE。覆盖：

- 51 个媒体跨 50/1 页，来源已提交后续跑不重复读取；Pixiv 平铺邻居不进入清单且内容保留。
- 未登记目录整体 BLOCKED、有界目录游标落盘，不枚举/授权其中未知文件。
- 硬链接、缺文件、额外无归属 Image 共享同路径均阻断。
- 文件读完后添加成员使快照失效，或替换租约令牌：均不提交文件及媒体游标。
- 两页之间目录变化拒绝，并保留原检查点。
- 完整内部 preview 可由数据 helper 得到 READY，4 个文件只统计 COPY 的 16 字节；所有原文件仍存在。

Executor 类型检查通过。首次检查暴露共享 helper 当时仍在编辑的 nullable 字段和本批模型类型导入，分别由各自所有者修复；后一次检查暴露测试泛型声明，改为显式 T 后通过。泛型修复不改变测试运行行为，未重复整套测试。未执行全量构建、Worker 构建或 App 检查。

## 续接依赖与未验证边界

1. 本批内部函数要求调用方先证明/领取全局 reader，解析并复核原 operation.rootBindings（包括 archiveRelativePrefix），且每次 mutation 使用 runtime fence。生产 Worker orchestration 尚未实现；下一批需封装这些入口、10 秒/256 MiB 文件边界让出、3 秒 preserveAttempt 冷却、聚合进度、取消/失租约及最终 scope.complete。同一个 supervisor 需服务 SCAN 与维护。
2. 数据线已落 `validateArtworkDedupOperationSnapshot(tx, operationId, artworkId?)`、saveFilesPage 真实归属覆写/最终复核、COPY 唯一路径字节计数、`readArtworkDedupArchiveManifestEvidence` 和 inventory.archiveItem。当前源文件已对接封印摘要、manifest 身份和 memberCount；真实归档 sealed/drained/importItem 发布链的专门 PostgreSQL 测试仍未执行，不能宣称归档全链验收。现有 PG 共享测试只覆盖额外 Image 引用，跨作品/跨角色全集还需数据线专门回归。
3. 数据线确认 PAUSED＋Operation.BUILDING 在离线证明清除 reader 后的恢复控制尚未闭合；operation 离线 reader CAS 恢复 helper/CLI 未做。不得用 fail、直接清 token 或 lease 到期代替退出证明。后续 orchestration 必须等明确恢复接口。
4. 原媒体动作的独立复审、完整 fresh hash、声明/URL drain、磁盘 manifest、ISOLATE/RESTORE/PURGE、恢复占用不覆盖、hold/tombstone 和故障重放不在本小批完成范围。
5. 继续时先读本记录与最新 phase-3-contracts/数据交接，复用上面的定向命令；专库已为 110，无需重建或 generate。新增实装点才扩展对应测试，不能据本批重复全量 App/Worker 构建。

## 恢复后的窄修复与归档证据（01:52）

原只读 PREPARE 批独立审查确认两项 P2，已修并交原 Sol 窄复核，复核结论由审查记录单独维护：

- 目录检查把精确登记文件和登记后代目录分开。前者不递归，真实类型或完整 stat/nlink 变化写回原 referenceKey 为 BLOCKED，既有行不重复增加文件计数。
- 错误 IPC 携带当前请求最终累计 bytesRead，父进程只加与已接收 progress 的差额。解析/身份失败仍计完整实际已读字节，reads 继续只统计成功读取；SIGKILL 丢失的最后窗口边界没有因此被宣称精确累计。

真实 PG＋child 受影响文件 **12/12** 通过（原 9 项加 SYMLINK、空 DIRECTORY、FIFO 替换三例，均检查最终不能 READY 和计数不重复），source 文件 **15/15** 通过（新增 8 MiB 无效 metadata 完整读取后报身份错，累计字节精确为 8,388,608），reader **12/12** 通过。拟用 `-t` 限定新增用例，但 pnpm 将参数消费，实际运行上述三个受影响文件；没有跑其他整套。Executor typecheck 通过。

新增独立 `maintenance-archive.postgres.test.ts` 与 `maintenance-executor-fixture.ts`：用实际 createArchiveExecutorRegistrations 执行 DOWNLOAD → sealed/drained → PUBLISH，再真实 SCAN → 冻结 → PREPARE。两项 **2/2** 通过：实际 manifest 与 importItem/Image 精确映射可形成 READY（fixture pageIndex=7，不按排序猜测），仅追加换行使实际封印 SHA 不符时写为 BLOCKED。首次测试两项断言通过但 afterAll 清理遇到 path-write FK；仅补自有 rootIdentity 下的 MediaContentPathWrite 清理，清除精确失败夹具后重跑通过。没有绕过生产封印或修改真正媒体。

新 `maintenance-executor.ts`、`reader-latch.ts`、`root-bindings.ts` 及 Worker 注册已保存实现中间结果，尚未完成调度 PG/Worker 验证，不据此视为阶段3完成。SCAN 原根映射比较等价提取；原孤儿 reader 逻辑扩为扫描/维护共用全局持久占用。生产 release stage 仍 2，文件写基础复审阻断状态不变。
