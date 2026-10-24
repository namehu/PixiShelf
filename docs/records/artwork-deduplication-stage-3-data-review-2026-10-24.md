---
status: historical
scope: 去重阶段三数据收口批的独立审查；鉴权ID封面、维护reader恢复与继续、归属集合聚合
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-stage-3-data-closure-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/security/access-control.md
  - packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts
  - packages/pixishelf-db/src/artwork-dedup-ownership.ts
  - packages/pixishelf/services/artwork-dedup-cover.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# 阶段三数据收口批独立审查

2026-10-24，在 `codex/artwork-deduplication` 工作树审查 HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 及本批未提交实现。范围以[数据收口记录](./artwork-deduplication-stage-3-data-closure-2026-10-24.md)的冻结文件为准，仅追踪必要的直接调用链。审查者未修改产品代码，保留工作树内其他协作改动。

## 结论与发现

本批产品代码未发现需要阻断交付的 P1/P2。鉴权 ID 封面与 DTO、operation reader 离线恢复及 PREPARE 暂停继续、归属引用集合聚合在本次核对范围内符合约定。结论仅覆盖本批数据接口，不代替阶段三集成、浏览器或后续文件动作验收；发布阶段常量仍为 2。

发现一项 P3 文档冲突：`phase-3-contracts.md:51` 的 retryOperation 表格原文仍称“阶段三仅允许 FAILED 的原 PREPARE 重试”，而本批新增的恢复段及共享谓词已允许 BUILDING/PAUSED 继续。触发条件为读者已确认退出、原业务操作为 BUILDING 且原任务为 PAUSED；旧表格会使调用者误以为必须先将暂停改写为失败。代码不会依赖这段文字越过门禁。已交由实施者将该表格指向同文“PREPARE reader 恢复与继续”的唯一规则段；实施者已将该表格改为同文锚点链接，审查者窄复核确认旧冲突规则已移除，目标段仍与共享谓词一致；P3 已关闭。

## 核对依据

| 边界                 | 独立核对内容及代码位置                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 鉴权封面             | `cover/[artwork-id]/route.ts:13` 独立取得 Session，随后核对 expectedUserId 和安全整数 ID；错误统一不带路径。成功及失败响应均 private/no-store、Vary Cookie。                                                                                                                                                                                      |
| 媒体可见性与文件读取 | `services/artwork-dedup-cover.ts:52` 仅取当前作品第一登记媒体，拒绝删除、非 ACTIVE 或 COPY 声明；复用已有视频 poster，拒绝 SVG、隐藏相对路径及解析后的隐藏路径，校验根边界及普通文件后流式读取。                                                                                                                                                  |
| DTO 与查询有界性     | 同文件 `:23` 的一次 LATERAL 查询仅面向当前有界作品集合；`artwork-dedup-review-service.ts:103` 只将作品 ID 路由放进 DTO，评分/标记/阅读按实际读取账户查询，他人仅布尔提示。                                                                                                                                                                        |
| 离线 inspect/recover | `artwork-dedup-operation-reader-recovery.ts:43` 沿 dispatcher 协调锁、writer lane/job、run/operation 顺序核验；沿既有停止检查拒绝活动任务、有效资源租约及活跃 Worker。`:64` 摘要绑定业务版本、执行版本、任务 attempt/status、原 token/state/owner；`:104` 在同事务重新检查摘要与 token，再清占用、递增 version 并审计，不改变冻结范围或业务状态。 |
| PREPARE 暂停继续     | 同文件 `:24` 为 DTO 与 mutation 共用谓词，限制原 PREPARE/ISOLATION、无取消意图、reader IDLE/null、匹配的原 job/payload/执行版本及失效租约。`artwork-dedup-review-service.ts:587` 锁原任务与 operation 后做版本 CAS，保留 operationId/冻结行，仅提升执行版本并入队；幂等重放先于 CAS。                                                             |
| 公共入口与 CLI       | router 的 retryOperation 进入同一领域控制；控制入口先检查阶段门禁。Worker recovery CLI 严格互斥 run/operation，执行时使用本批 DB helper，不提供直接清 token 分支。共享发布常量仍为 2。                                                                                                                                                            |
| 归属聚合             | `artwork-dedup-ownership.ts:36` 先将当前页/最终清单按根及路径归成 addresses，再按引用地址统计 refs；只有唯一引用才比较作品、角色和来源键。重复清单路径独立聚合后阻断，没有相同路径两两展开；页提交与最终完成继续调用同一 helper。                                                                                                                 |
| 专项证明             | 阅读 DB 6 项边界、1 项归档封印、App 15 项专项源码及原始结果。跨 CHAPTER/metaSource/Revision 引用不能由调用方 VERIFIED 声明绕过；重复 COPY 不抬高 logicalBytes。归档 fixture 明确只证明数据库封印/映射，未据此推断真实生产下载发布链。                                                                                                             |

## 执行与证据

本轮仅独立执行以下最小验证，不连接数据库、不读取真实媒体；文件样本由用例在 `/tmp` 创建并清理：

```bash
cd packages/pixishelf
pnpm exec vitest run 'app/api/artwork-dedup/cover/[artwork-id]/__tests__/route.test.ts'
```

01:57:52 的工具原始输出为 1 个测试文件、10/10 通过，用例执行 26 ms，总耗时 661 ms；覆盖匿名/账户切换、不可见作品、COPY 声明、无效 ID、隐藏路径及可见符号链接别名、越界路径、有效图片与已有视频 poster。未用浏览器或真实媒体替代这些隔离样本。

已读取并核对实施者原始日志：

- `/tmp/dedup-stage3-data-boundaries-final.log`：DB 6/6；
- `/tmp/dedup-stage3-archive-evidence-retry.log`：归档证据 1/1；
- `/tmp/dedup-stage3-cover-resume.log`：App 15/15，其中暂停继续 1 项使用真实专库并仅在测试内模拟阶段 3；
- `/tmp/dedup-stage3-data-tsc.log`、`/tmp/dedup-stage3-app-tsc-final.log` 及实施记录：DB/App 类型检查通过的交付证据；
- `/tmp/dedup-stage3-docs-check.log`：实施时 220 份 Markdown 检查通过。

本轮全小写应用路径检查无输出。审查记录落盘后的 `pnpm docs:check` 通过，原始日志为 `/tmp/dedup-stage3-data-review-docs-check.log`；本记录与修订契约的定向 whitespace 检查无错误。

## 限制与交接

未重复阶段一/二或首批已关闭的三项 P2，未运行全量 build/test、规模基准或数据库专项重跑；未连接 `dedup_data_next`、真实数据库或 scale 库。执行器报告的真实归档生产链 2 项证据由统筹单独核验，本记录不将人工构造 DB fixture 冒称为该生产链证据。

原生文件写基础复审被平台阻断的事项完全不在本次范围，未重试，本次结论不替代其门禁。第四/第五阶段写入 guard、声明/hold/drain、隔离/恢复/永久删除文件动作及最终统一浏览器/全量构建仍按统筹的独立门禁交付。本次没有图源改动，遵从统筹约束不重复图表渲染/检查，也未安装浏览器。

## 追加：阶段三门禁与串联窄差异复核

同日按统筹授权复用本审查，对[阶段三门禁与最小串联批](./artwork-deduplication-stage-3-integration-2026-10-24.md)做窄差异复核；不重开前述数据批或整阶段审查。适用版本仍为同一 HEAD 及未提交工作树，唯一产品差异是共享 `ARTWORK_DEDUP_RELEASE_STAGE` 从 2 到 3。上文“门禁仍为 2”保留首次审查时的历史状态，本次追加核对的当前值为 3。

未发现本批新增的 P1/P2/P3。开放范围止于查看、保存审核、PREPARE/ISOLATION 目的的清理准备和预览，以及已定义的 PREPARE 取消、继续与重准备；没有开放隔离、恢复、永久删除、PREPARE/PURGE 预检或显式重导。

| 核对点            | 窄复核结论                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享门禁          | `artwork-dedup-maintenance.ts:21` 只改变单一阶段常量；同文件 `:24` 的矩阵使 PREPARE/ISOLATION 在 3 开放，ISOLATE/RESTORE 仍须 4，PURGE 及任意 PURGE purpose 仍须 5。                                                                                                                                                                                                                |
| 实际 API          | `server/routers/artwork-dedup.ts:44` 起的 isolate、restore、preparePurge、purge、allowReimport 均进入 `artworkDedupAdvancedOperation`，先核账户与共享模式门禁，仍返回 FORBIDDEN。DTO 的高级 allowedActions 继续使用同一矩阵，通用后台入队/控制/重试仍拒绝维护类型，不能扩大入口。                                                                                                   |
| Worker 与文件边界 | `maintenance-executor.ts:91` 在认领 reader 或创建 child 前检查共享门禁，随后额外限定 PREPARE/ISOLATION。PREPARE 仅走 INVENTORY/INSPECT/VERIFY。原生绑定按需加载，`reader.probeFilesystem()` 在非测试生产代码中没有调用者；虽保留 maintenance-capability IPC 定义和 child 分派，当前公开 API/已注册执行器没有通往原生能力探测及文件移动/删除的执行分支。本次未执行或重试原生写基础。 |
| 真实串联          | 阅读新增集成用例：仅用显式专库的 plain PrismaClient 替换 App 默认 Prisma；共享门禁、tRPC authProcedure/router、service、队列 repository、执行器和 child 未 mock。先由 start→SCAN 产出检测证据，再由 prepareCleanup→SYSTEM/900/BACKGROUND_WRITER→真实维护 child 产出 READY；刷新 caller、列表和幂等仍定位原 operationId。                                                            |
| 阻断分支          | 集成用例向合成副本独占目录新增未登记附件，再执行 PREPARE，断言操作为 FAILED/INVENTORY_BLOCKED、文件为 requiresReview+BLOCKED、logicalBytes 未知且不能 ISOLATE；登记媒体字节不变。高级五个真实路由使用通过输入校验的请求，均断言 FORBIDDEN。                                                                                                                                         |

已直接读取本批实施日志：`/tmp/dedup-stage3-gate-integration.log`（1/1）、`/tmp/dedup-stage3-gate-contracts.log`（2/2）、`/tmp/dedup-stage3-gate-ui.log`（13/13）、`/tmp/dedup-stage3-gate-api.log`（2/2，另 3 项跳过），共 18 项；App 最终类型成功的交付证据为实施记录及 `/tmp/dedup-stage3-gate-app-tsc-final.log`。未重复运行这些数据库/组件用例或类型全集。执行器所有者的 production PURGE gate 用例源码已核对：operation/job/context 均使用 PURGE，调用真实共享门禁，断言 supervisor 不创建 reader、readerToken 为空、preparedFiles 为零；执行器所有者确认该单项原始工具输出为 1 项通过、10 项跳过，未另存独立日志；本次只复核源码并引用其确认，没有补造日志或重跑该数据库用例。

审查者仅独立运行共享契约 2 项，02:08:58 的结果为 2/2 通过（3 ms，用时 244 ms），原始日志 `/tmp/dedup-stage3-gate-review-contracts-retry.log`。首轮在用例启动前因沙箱不允许 Vitest 写工作树 `.vite-temp` 而失败，保留 `/tmp/dedup-stage3-gate-review-contracts.log`；对这两项纯契约测试提升权限后通过，不涉及 PostgreSQL、媒体或原生文件能力。追加记录格式及 docs:check 结果在 `/tmp/dedup-stage3-gate-review-docs-check.log`；应用路径大小写检查无输出。

本次接受证据仅证明共享门禁与合成样本的 API→队列→只读 PREPARE 串联。tRPC caller 注入的是合成已鉴权 Context，不能据此宣称真实 Cookie、HTTP proxy、浏览器登录或桌面/手机交互通过。D3-05 的有界 500k 测量正在执行器线独立进行，本次没有读取其库或运行规模任务，也不宣称全量规模、最终浏览器或最终全量 build/test 已通过。阶段四/五及被平台阻断的原生写基础复审继续保留原门禁；没有运行额外图表检查。

## 追加：PREPARE 最终成员查询的索引窄修复核

同日按统筹授权，对[PREPARE 最终成员查询](./artwork-deduplication-prepare-query-2026-10-24.md)的小批修复做窄差异复核。产品范围仅为 `artwork-dedup-review.ts:288` 最终 missing 统计中的 MEDIA、CHAPTER 两个 EXISTS 分别增加规范 referenceKey 条件；不重审 ownership、最终容量汇总或其他阶段，不修改产品代码。

未发现新增 P1/P2/P3。两个 EXISTS 的 operationId、artworkId、imageId 和 role 原条件全部保留；章节要求仍仅在登记 `chaptersPath IS NOT NULL` 时触发。新增的是 AND 条件，因此匹配集合只能缩小，不能将原本缺失的媒体或章节变为“已存在”。`maintenance-prepare.ts:105`、`:146` 的执行器写入点分别固定生成 `media:<Image.id>`、`chapter:<Image.id>`，与最终查询一致；规范清单的行为保持一致，非规范键即使其他身份字段吻合，现在也会明确触发 INCOMPLETE_INVENTORY。这是对既定键契约的落实，不是放松完整性判断。

已有 Schema 与正式迁移中的 `(operationId,referenceKey)` 唯一索引使每个登记成员最多定位一行，随后仍核对作品、图片和角色，不能把“键相同”当作身份已经核验。没有新增迁移、改变锁序或绕过后续 ownership/status/inspection 与容量检查。

新增 6 项 PG 回归与原始日志已核对：一项正确 MEDIA+CHAPTER 清单发布 READY；四项分别破坏 MEDIA 的 referenceKey、imageId、artworkId、role，均要求 INCOMPLETE_INVENTORY 并保持 BUILDING/version1；一项保留完整媒体但删除登记章节，要求拒绝完成。这些覆盖对本次两个键条件的窄改足够。CHAPTER 的四类字段错配没有逐项穷举；本次通过查询中对称且完整保留的身份条件作静态核对，不将 6 项说成所有完整性分支全覆盖，也不因此重复执行数据库测试。

已直接阅读 `/private/tmp/dedup-prepare-completeness-tests.log`（6/6）和 `/private/tmp/dedup-prepare-completeness-types.log`（DB tsc）的实施证据。审查者另做纯文本小型证明：旧、新 EXPLAIN SQL 文件的差异精确为两个 referenceKey 合取条件；新 SQL 在替换固定 operationId 和归一化空白后，与产品 missing 查询一致。两项静态断言通过，日志 `/tmp/dedup-prepare-query-review-static.log`；没有连接 PostgreSQL。

性能结论只引用已保存的两份只读 EXPLAIN 输出：正常统计后的旧查询为 17,461.092 ms，MEDIA 子计划循环 500,000 次、每次平均过滤 250 行；改后为 2,273.583 ms，使用既有唯一索引，MEDIA 同样循环 500,000 次、每次过滤 0 行。两份计划的媒体/章节来源条件与产品一致。规模 fixture 没有章节，计划中的章节分支 Actual Loops 为 0，其正确性由上述小规模 PG 正例与缺失章节例支持。不同缓存状态下的耗时不构成固定倍数保证；消除作品内重复过滤才是本次已证实的改进。

本次未运行 PG、500k、全量测试、构建或额外图表检查。追加记录的格式、定向 whitespace、应用路径大小写及 docs:check 完成，文档检查日志 `/tmp/dedup-prepare-query-review-docs-check.log`。发布阶段保持 3；executor 仍在续接完整 ownership/汇总测量，D3-05 尚未通过，最终浏览器与完整 50 万真实文件 PREPARE 验收仍不在本次结论内。

## 追加：最终归属复核有界回写与 STALE 生命周期

同日按统筹授权独立复核[最终归属复核与失效批](./artwork-deduplication-prepare-ownership-2026-10-24.md)。本次按生命周期变化审查，不将其描述为只有索引优化。产品仍由数据线维护；审查者只读产品代码，并将结论追加在本记录。

未发现新增 P1/P2/P3，可进入该批约定的下一次生产预算最终事务测量；本次没有执行该测量，不据此认定 D3-05 已通过。

| 边界               | 窄复核结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整判断与计数     | `artwork-dedup-ownership.ts:39` 的 files 在最终调用中不带页过滤，完整覆盖当前 operation；addresses、ref_counts、duplicate_paths 仍按唯一地址聚合，decisions 对每个 fileId 生成一个原归属决策。`:59` 的 changes 以 null 安全的 ROW IS DISTINCT FROM 比较最终 ownershipStatus/status/blockReason；没有把未变化行算作待回写，也没有将重复引用展开成重复文件计数。最终 SELECT 对全部 changes、实际 updated、全部 files 分别计数，不以 LIMIT 后的行数冒称完整变化总数。                                        |
| 回写上限与正常页   | 100 条 LIMIT 仅在 `:67` 的 updated 输入，不在 files/decisions/changes 中；因此它限制实际回写，不限制被判断的范围。页保存已有最多 100 个 entry，helper 又拒绝超过 100 个 referenceKey，配合 `(operationId,referenceKey)` 唯一约束，每个正常页最多产生 100 个文件决策，所有页内变化都能落盘。跨页同路径引用仍由同一操作完整 duplicate_paths 集合判断，最终调用会再次覆盖全部行。                                                                                                                            |
| 防止误 READY       | `artwork-dedup-review.ts:294` 在原完整性检查之后调用 helper。changedFiles 大于 updatedFiles 时直接返回 STALE/DONE/OWNERSHIP_CHANGED、logicalBytes=null、preparedFiles=totalFiles，递增业务 version；不进入 READY/FAILED 汇总分支。全部 Artwork/File 与 executionVersion 保留，未回写的旧 VERIFIED 行仍属于失效快照。变化不超过上限时全部已落盘，后续仍对所有文件的 requiresReview/blockReason/status/ownershipStatus/inspectionStatus 及 Artwork 错误做既有 FAILED/READY 判断，不因未变化行被跳过就免检。 |
| 同事务与围栏       | 正式路径 `maintenance-executor.ts:270` 在同一 finalizeInTransaction 中调用 completeArtworkDedupPrepare，再调用 scope.complete；不是分开提交的两个事务。队列 `withFencedExecutionTransaction` 先锁定并核验租约/任务，在提交前再次核验围栏，随后提交终态。超时、围栏失效或提交失败会一起回滚 100 条诊断、operation 状态和 job 终态；成功时 job COMPLETED，不走 slice 的 retry 分支。                                                                                                                        |
| 防止旧清单循环续跑 | DTO 与真实 RETRY 共用的谓词只接受 FAILED/FAILED 或 BUILDING/PAUSED，STALE 无法重试。成功提交的新 STALE operation 在 stage 3 只给 REPREPARE；通用任务重试继续拒绝维护任务。原范围重准备使用 sourceOperationId/version，由服务端原 OperationGroup 的 SELECTED 集合创建新 operationId，并从当前审核及证据逐页生成新清单，不在旧操作上继续回写下一批。                                                                                                                                                        |
| 交互与契约         | phase-3-contracts 已明确该大范围变化失效分支、未回写行的历史性质及重新 PREPARE 要求。UI 的批次标题显示“预览已过期”，在清单前显示 STALE 提示及“重新预览原范围”；操作依据 server allowedActions。logicalBytes=null 不显示容量数字，文件行仍是保留的局部诊断，不能当作整批当前授权。operation.version 递增也使旧文件游标和迟到预览失效。                                                                                                                                                                     |

已核对新 DB 3 项、既有边界 4 项及真实 App 服务 1 项的源码与日志，共 8 项通过：0 变化路径保持全部文件旧 updatedAt 且可 READY；100 条迟到跨角色引用完整回写后 FAILED；104 条变化只保存按 fileId 排序的前 100 条真实 SHARED/BLOCKED 诊断并 STALE。两种规模均先在事务中验证 changed/updated/total 后主动回滚，确认未残留诊断，再通过 complete helper 提交，并核对全部冻结范围、空容量、原执行版本及没有创建 claim。App 用例验证真实服务的 STALE DTO 仅 REPREPARE，旧 RETRY 拒绝且原范围/版本不变；该用例合成 STALE 状态，完整 Worker 原子完成路径以既有围栏代码的直接调用链核对，不把它说成新跑的整链故障测试。

实施证据为 `/private/tmp/dedup-ownership-finalize-tests.log`（3/3）、`/private/tmp/dedup-ownership-existing-tests.log`（4/4，2 项未选）、`/private/tmp/dedup-ownership-stale-service-tests.log`（1/1，1 项未选）、`/private/tmp/dedup-ownership-types.log`（DB tsc）。本轮没有重跑 PG、500k、全量测试、构建、浏览器或图表，也没有执行原生文件操作。追加记录格式、定向 whitespace、应用路径大小写与 docs:check 已核对，文档日志 `/tmp/dedup-ownership-review-docs-check.log`。

本次只认可完整判断、有界诊断回写和失效终态的代码/定向证明。数据线记录的只读归属计数计划不能代替实际有界 UPDATE 加终态提交；executor 尚需按生产 30 秒围栏事务对保留 fixture 仅续一次完整 finalize。有效 50 万唯一路径清单的 READY/容量汇总、50 万真实文件 PREPARE、最终浏览器与其他阶段门禁仍未由本次复核证明；发布阶段仍为 3。
