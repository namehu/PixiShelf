---
status: draft
scope: 扫描、归档与普通归档维护写入口的只读盘点和待定接线方案；不代表已实施
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-executors/src/scan/
  - packages/pixishelf-job-executors/src/archive/
  - packages/pixishelf/services/media-root-central-service.ts
  - packages/pixishelf/services/archive-intake/archive-intake-service.ts
---

# 去重写入口与来源代次接线盘点

日期：2026-10-24。适用工作树：`codex/artwork-deduplication`，第二阶段冻结基线 `c2d6be73` 加当前三至五阶段未提交协作变更。本轮只读代码并记录方案，没有生产代码、迁移或数据库写入，也没有执行文件动作、测试、构建或规模测量。

权威锁与身份约束见[声明契约](../design/artwork-deduplication/claims-contracts.md)。统筹者已确认五字段、旧行策略、staging 登记顺序与控制/drain 允许列表作为下一批契约基线，已追加至上述权威设计；下列辅助接口名称仍由数据线固定，尚无迁移或入口实现。当前 gate 为 3，文件写基础仍是“已修复、待独立复审”，本记录不能开放隔离、恢复或永久清理。

## 已核对的持久化缺口

扫描的目录快照由 `scan/media-content-guard.ts` 在处理输入时捕获，只存在当前执行内存；它负责阶段一目录写入互斥，不是任务冻结时的去重来源代次。`ScanRunMetadataInput`、`ScanRunLocalWorkInput` 和 `PixivSourceAuditItem` 没有来源代次证明字段。

`ArchiveIntakeItem.resolvedSnapshot` 是外部解析结果，`ArchiveImport.generationToken` 是 staging 执行 UUID。`ArchiveStagingGeneration.sealedAt/drainedAt` 是该执行的封印与退出证据。这些字段都不能替代来源 `generation`，也不能写入不同语义的值来复用。

建议只在五张现有业务表各加一个 `dedupSourceSnapshot Json?`：

| 表 | 新证明产生或复制时机 | 建议证明范围 |
| --- | --- | --- |
| ScanRunMetadataInput | 输入行冻结事务内捕获；已经冻结的输入只读取 | Pixiv PROVIDER 和精确元数据 PATH，最多两项 |
| ScanRunLocalWorkInput | 目录导入或重扫输入冻结事务内捕获 | 已证明身份的 LOCAL_DIRECTORY DIRECTORY，一项 |
| PixivSourceAuditItem | 从产生该观察的冻结 Scan 输入复制 | 原证明，不在审计完成或 Apply 时刷新 |
| ArchiveIntakeItem | 新提交意图与 RESOLVE 入队的同一事务内捕获 | 严格 URL 身份解析得到的 PROVIDER，一项 |
| ArchiveImport | READY Intake 转为下载任务的同一事务内复制 | Intake 原证明；先复核再复制 |

候选共享 Zod 结构为 `{ version: 1, sources: [{ identity, sourceId, generation }] }`，`generation` 为无符号十进制字符串，不经 JavaScript number；每行最多两项。identity 完全复用 DB 的 PROVIDER/PATH/DIRECTORY 联合和统一身份编码，rootIdentity、规范路径也由既有可信 resolver 产生。字段不得包含文件全集或远端任意 metadata。具体命名、共享类型导出和迁移由数据线在统筹确认后固定。

现有单身份 capture/assert helper 不能让调用者随意循环：一次事务涉及多根和 provider 时，先取得全部受信根协调，再按统一 identityKey 顺序锁来源，最后 Artwork。需要数据线提供最小有界批量包装，或明确已有统一排序入口；不在 Executor 重新实现身份 hash。单输入最多两项，批量冻结仍按现有页处理。

### 迁移前输入和任务

可空字段只为兼容存量行；不是允许缺证据继续写入。已有未完成 SCAN 输入、已排队/READY Intake、ArchiveImport 的 null、缺失、版本未知或格式非法，在第一次执行、重试及发布前明确拒绝，不补捕获当前 generation，不默认 0。保留旧任务、文件和检查点；用户明确新建意图后，重新校验身份并冻结新的证明，不能在原输入上静默改代次。

已完成项只允许真正无领域写入的幂等读取；会更新 lastSeen、检查点或来源数据的“SKIP”仍按实际写入检查。旧审计报告可展示，缺证明的差异不能 Apply。迁移不通过当前文件状态推导历史代次，不批量回填当前 generation。

目录释放是接线开放的前置：未来 DIRECTORY 获准恢复 OPEN 时，在既有根锁下同步递增其覆盖的所有既存 PATH/DIRECTORY generation，与释放原子提交；其他操作的 HOLD/TOMBSTONE 保持。只推进父目录自身会使旧子 PATH 证明失效机制不完整；反向也必须验证旧 DIRECTORY 跨子 PATH 周期拒绝，需同时使既存重叠祖先 DIRECTORY 证明失效，不能只测单一 identity。精确原子传播规则已交权威契约，本批没有 release helper。

## 扫描接线位置

下表路径前缀为 `packages/pixishelf-job-executors/src/scan/`；App 路径另标。

| 入口 | 已存在的位置 | 最小接线要求 |
| --- | --- | --- |
| 全量发现冻结 | `run-store.ts:286` freezeDiscoveredMetadataPages，`:323` createMany | 每页冻结行与原来源证明同事务；恢复不重新捕获 |
| 增量清单冻结 | `inventory-run.ts:65`、`:376` | 使用相同证明，不把处理时目录快照当来源代次 |
| CLIENT_LIST、定点重扫、目录导入 | App `services/media-root-central-service.ts:43/105/252/351` | 在已有 afterEnqueue/冻结事务中捕获；本地单行 create 分支同样覆盖 |
| 审计观察与 Apply | `consistency-audit-executor.ts:730/918`；App `services/source-audit/source-audit-apply-service.ts:230` | 审计复制原冻结证明；Apply 再原样复制。没有输入来源证明的 MISSING/异常项只报告，不能凭完成时刻补证据 |
| Pixiv 处理与发布 | `scan-executor.ts:251/377`，`pixiv-publisher.ts:39` | 稳定读取前可早拒绝；最终 fenced 发布事务按原证明复核，再执行 Artwork/ExternalRef/Image 变更；文件 metadata ID 仍须匹配冻结身份 |
| 本地新建与重扫 | `local-executor.ts:117/170`，`local-publisher.ts:16`，`local-rescan.ts:15` | 原 DIRECTORY 证明与现有 root/目录快照同时复核；既有 Artwork 的 CONTENT/STRUCTURE 写入口检查 Claim |
| 审计应用发布 | `audit-apply-executor.ts:336/391/434` | 保留已有 audit snapshot/hash/identity 校验，发布复核审计原证明，不在恢复时捕获 |

Pixiv 平铺作品由稳定 provider/externalId 保护，精确 metadata PATH 证明不意味着拥有整个父目录。LOCAL_DIRECTORY 可使用冻结独占目录身份。历史未知来源或只具 PATH 声明的非 LOCAL_DIRECTORY 作品，不能随意改用父 DIRECTORY 证明：单 PATH 释放不会推进祖先目录代次。该分支应拒绝或另行固定有界精确文件证明，不能凭文件名猜来源或放宽为目录授权。

现有 `beginMediaContentPathWrite` / `beginMediaContentSourceWrite` 已接底层来源/Claim 检查，不能替代扫描最终数据库发布处的原代次验证；扫描未必声明一次实际文件写入。

## URL 提交、下载与发布

| 阶段 | 具体位置 | 最小要求 |
| --- | --- | --- |
| 提交 | App `archive-intake/archive-intake-service.ts:296/555`；uploader 手动提交 `archive-uploader/archive-uploader-service.ts:834` 复用此入口 | 在 QUEUED 项及 RESOLVE job 创建前取得证明；DUPLICATE/容量拒绝审计行无需伪造执行授权，后续转为可执行项必须走明确新意图 |
| URL 身份 | `archive/providers/e-hentai.ts:99/428/798`；`archive/types.ts:188`；App provider wrapper/types | 新增纯 `identifySource(input)`，沿同一严格 URL parser 提取 provider/externalId。当前 /g 与 /s 链接均已含 gid，不需要请求 gtoken 后才知道身份。resolve 结果必须匹配原身份 |
| 解析 | `archive/resolver-executor.ts:58/137` | network resolve 前检查持久原证明；finalizeResolved 与 AUTO enqueue 再检查，不能在解析完成时首次 capture |
| 创建下载 | `archive/intake-enqueue.ts:20/149/204` | 复核 Intake 原证明并复制到 Import；已有 ENQUEUED、活动任务复用、enqueue race 恢复分支也不能跳过 |
| 下载开始与每批 | `archive/executor.ts:119/281/398/1129` | startArchiveImport 在 staging 文件或网络动作前复核；每个新媒体单元与媒体收据提交复核原证明。重试改变执行 token，不改变来源证明 |
| 阶段交接 | `archive/phase-handoff.ts:10` | 原证明仍由 Import 持有；DOWNLOAD→PUBLISH 或恢复 DOWNLOAD 之前复核，不把 successor job 当新来源意图 |
| 实体发布 | `archive/executor.ts:1257`，`archive/publisher.ts:28` | 在 beginExecutorMediaWrite/目录发布动作前早检查；最终 fenced DB publication 再按同一原证明检查。现有根、写 token、manifest、sealed/drained、替换目标 CAS 均保留 |
| 已落盘发布恢复 | `archive/media-content-publication.ts`；App `services/archive/archive-publication-retry.ts` | 重放使用 Import 原证明；文件已经存在不是换代发布的授权 |

当前 `publishArchiveImportInTransaction` 在 `publishExecutorMediaWrite` 的回调内才取得 creator catalog 锁，而后者已有根/作品协调。接入来源锁前需要核实并前置 catalog 取得点，遵守既定 catalog→root→source→Artwork 顺序；不在本轮改 observe/publish 或锁实现。

### 真正的 URL drain

DOWNLOAD 是独立 lane，BACKGROUND_WRITER 的隔离任务开始不代表下载停止。先在维护事务建立 HOLD，再请求现有 cancel/abort 控制并释放事务/让出 writer，等待真实退出证明；不新增第四 lane。待定最小 DB/控制接口为 `requestArtworkDedupArchiveDrain(tx,{execution})` 和 `inspect/assertArtworkDedupArchiveDrained(tx,{execution})`，返回聚合数量与阻断原因，不能把全库 Import/文件列表送入 JS。

匹配范围必须包含冻结 provider/externalId 对应的全部活动 Import/ImportExecution 和未证明退出的 staging generation，包含旧 executionToken、失租约及启动后尚无 generation 行的执行。当前 `prepareDownloadGeneration` 先建 staging 目录再登记 generation；后续接线应先在原 fence/source 锁内登记该执行，再进行首次 staging FS 动作，复用已有表。只检查已存在 generation 行会漏掉启动窗口。

持久代次缺失时，原运行时租约/控制处理及取消、失败、drain 回执同样允许继续，始终保留原 fence/token；这不允许媒体成功收据、来源重绑定或重新捕获。可复用的正常退出链是 `runConcurrentRound:939` 等待所有 workers settled、关闭 transfer reporter 后，由 `markDownloadDrained:1116` 或 `finalizeRequestedArchiveControl:807` 以原 token 写 drainedAt。发送 abort、状态 CANCEL_REQUESTED、job FAILED 或 lease 过期都不是退出证明。无法提交原 token 回执的 orphan 必须保留不确定状态并沿已有恢复入口处理。

HOLD 后拒绝新媒体结果与发布，但仍允许原执行提交取消/失败/drain 控制回执；不能把 OPEN 前置检查加到回执事务使其永远无法退出。是否已 drain 的判断必须在首个原媒体动作前再次核验。取消意图与 drainedAt 之间崩溃、旧 token 迟到写入、活跃执行没有 generation 行均是新增必测边界。

## 普通回收、恢复和到期清理

普通维护使用固定 Artwork/Revision 与现有生命周期意图，不把普通恢复当去重恢复入口。共享 `assertNoArtworkDedupUrlHold` 需要在下列真实写边界调用；年龄超过七天、普通 purgeAfter 到期、已有排队任务均无豁免。

| 位置 | 守卫点 |
| --- | --- |
| App `archive/archive-maintenance-service.ts:86` | TRASH/RESTORE 意图、复用任务返回之前检查持久 hold；已有来源活动导入检查保留 |
| App `archive/archive-trash-service.ts:98/129` | canRestore/动作可用性与服务端一致；展示结果不能代替事务守卫 |
| Executor `archive/maintenance-executor.ts:105/239` | RECONCILE 候选查询排除 hold；物化子任务前锁定重查，不因候选查询通过而放行 |
| 同文件 `executeArtworkMaintenance` | 初始状态校验、beginMaintenanceMediaWrite 首个 FS 动作前、最终 publishMaintenanceMediaWrite 三处覆盖；queued TRASH/RESTORE 同样拒绝 |
| 同文件 `executeArchivePurge:328` | 同样三处覆盖，最终 Image/Artwork 删除前重查，不使用普通 purge 绕过去重清理协议 |
| 同文件 staging cleanup 分支 | 来源 HOLD/TOMBSTONE 及去重领域保留证明覆盖无当前 Artwork 的旧 Import；只清已 drained 且允许清理的 generation，不因 retainUntil 过期清 orphan |

已有路径写声明和 Artwork Claim 互斥能阻止一部分并发，但 URL hold 可超出活跃 Claim 生命周期，不能仅调用底层 begin 写声明来替代它。来源释放后的旧普通维护任务还须通过原 Artwork/Revision 生命周期与意图校验，不能在 RECONCILE 中把被阻断任务重解释成去重授权。是否需要扩展普通维护 payload 的原意图证明，留给该小批按实际恢复终态验证后决定；当前不新增第六个 schema 字段。

## 分批建议与尚未证明项

1. 数据线固定五个可空字段、共享有界证明及统一锁排序 helper；先测试 null/旧代次拒绝和目录释放传播契约。目录实际 release 仍保持未实现。
2. Executor/App 同时接扫描输入冻结→原证明发布链，测试平铺 Pixiv 不影响其他作品、LOCAL_DIRECTORY 原代次、审计 Apply、存量 null 拒绝。先处理明确身份分支，未知历史来源不放宽。
3. 接 Intake→RESOLVE→DOWNLOAD→PUBLISH 的原证明传递；覆盖 /g、/s、AUTO/MANUAL、任务复用、重试、phase handoff 与已落盘恢复。不需要重跑阶段二全量 hash。
4. 接 URL hold、真实 download drain、普通 trash/restore/purge/reconcile/staging cleanup。用合成流验证取消未 settled、失租约 orphan、旧执行迟到、超过七天 hold、首个 FS 动作前拒绝。
5. 只有文件写基础独立复审及上述接线验收完成后，才进入实际 ISOLATE/RESTORE/PURGE 授权批。

本轮覆盖的是指定模块的调用链和 schema 静态盘点，不等于全项目所有写入口审计，也没有证明实现后的锁时序、迁移兼容或运行时行为。未新增测试或运行构建。没有访问规模库、改变样本、启动 App 或浏览器，也未再次运行图示检查。
