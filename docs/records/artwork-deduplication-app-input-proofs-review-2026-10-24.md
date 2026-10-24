---
status: historical
scope: App 新扫描输入、审计 Apply 证明转发、URL 收件意图与原项重试接线的独立差异审查；门禁保持3
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/records/artwork-deduplication-app-input-proofs-2026-10-24.md
  - packages/pixishelf/services/media-root-central-service.ts
  - packages/pixishelf/services/archive-intake/archive-intake-source-proof.ts
---

# App 输入来源证明独立审查

2026-10-24，在独立工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication`、基线 `6e8d4f4c98514c96233404e02acb241f0a1be20f` 上审查冻结未提交小批。审查者未参与实现，仅维护本记录。初审发现一项 P2，原实施者窄修后已独立复核关闭，本批限定范围通过；未发现本范围内的来源重新捕获、原证明覆盖、事务部分提交或新增锁序反转。发布门禁保持3，隔离、恢复和永久清理仍关闭。

## 范围与证据

按[第三小批接线契约](../design/artwork-deduplication/app-write-guards.md#第三小批新输入冻结与收件意图)与[声明契约](../design/artwork-deduplication/claims-contracts.md)核对以下文件。`job-command-service.ts` 只审查新增 `ARCHIVE_RESOLVE_ITEM` 原证明 retry guard；此前去重任务通用控制禁用变动不重复审查。执行器侧只审查 Provider 接口、E-Hentai 共享解析与其测试；扫描、其他归档执行器、DB helper 性能修复和 native 文件基础均不属于本批。

初审冻结内容 SHA-256 如下，P2 修复后的三个文件及复核结果另记下节，不能把本次结论套用于不同内容：

| 文件                                                                            | SHA-256                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/pixishelf/services/media-root-central-service.ts`                     | `ba1a34af23f05025eb5157b626f58d6589e1f56275a6008969fd87b90b479d03` |
| `packages/pixishelf/services/source-audit/source-audit-apply-service.ts`        | `5f08ba0a4aa7fd17ee96caf6877012d9c10f6916d4cda9504486327552f940db` |
| `packages/pixishelf/services/archive-intake/archive-intake-service.ts`          | `7d67b1f4c8762dfee79a62a3ddbd6c6a4d5397e0ebfd0b7832e449a50da7e021` |
| `packages/pixishelf/services/archive-intake/archive-intake-source-proof.ts`     | `c9045c80a8ad7e793ef97d6d81ae1a4c82fea8aabd52ab65ec62ec700075abad` |
| `packages/pixishelf/services/background-task/job-command-service.ts`            | `26e54d57e500d5d53d784793ea4ba60b21b32cc1387d5ce0219ec6dccb2be097` |
| `packages/pixishelf/services/archive/types.ts`                                  | `4d92ccde2eaed9ae5478a17006750c53fe616601f5d6b9ba05a283d8ff6ef13f` |
| `packages/pixishelf/services/archive/providers/e-hentai.ts`                     | `df7e3abf9b6e5d3cc7539707bd06750969d1a72854a3b6dff05438b60b646862` |
| `packages/pixishelf/app/admin/archive/_components/archive-intake-view-state.ts` | `5421e25a7e14318644a81c821ec5235706337a1cafd4af08304daa81cab9795c` |
| `packages/pixishelf-job-executors/src/archive/types.ts`                         | `db9391266ae3235b663c4f2988246402faed9b0f51c04ccb1dc51ea0538ca15f` |
| `packages/pixishelf-job-executors/src/archive/providers/e-hentai.ts`            | `3b3bb1546228ea9b3b46bd1b548b5b97a8fbdb18147ef19513c72393851b6400` |
| `packages/pixishelf-job-executors/src/archive/providers/e-hentai-url.ts`        | `0051c88a09c5f3bba912e0042de4a3ea41bb2e78637c0f198fb367017e78f1d5` |
| `packages/pixishelf-job-executors/src/archive/__tests__/e-hentai.test.ts`       | `18af898762fb33c8d9fee8251afd04b22aa73d6e331579327984b9b4330565dd` |

同时定向读取原入队事务、HTTP/tRPC 错误传输、Session 入口、Uploader 复用入口和本批测试。实现者[验证记录](./artwork-deduplication-app-input-proofs-2026-10-24.md)报告 App 五组100项、Provider 49项、新 PG 3+6项以及 App TypeScript/定向 lint 通过；本审查阅读测试及该记录，未独立重跑这些套件。读取 `/private/tmp/dedup-app-inputs112-migrate.log` 确认日志以正式迁移成功结束，未自行连接数据库。

## 初审发现：P2 扫描来源冲突缺少 App 错误适配（已关闭）

位置：[media-root-central-service.ts](../../packages/pixishelf/services/media-root-central-service.ts) 第609行，以及第633–637、652–660行。

初审冻结版本的 capture/assert 直接向外抛出 `ArtworkDedupOperationError`。当新 CLIENT_LIST、本地导入或作品重扫遇到 HOLD/TOMBSTONE，或活动任务复用遇到来源代次/身份失效时，分别产生 `SOURCE_HELD`、`SOURCE_GENERATION_CHANGED`、`SOURCE_IDENTITY_CHANGED`。[transport-error.ts](../../packages/pixishelf/services/background-task/transport-error.ts) 只识别既有 `BackgroundTaskError`、部分输入错误和 `STATE_CONFLICT`，不识别上述三个来源错误。

因此 [runBackgroundTaskApi](../../packages/pixishelf/services/background-task/api-error-mapping.ts) 会原样上抛，扫描、重扫及 Webhook 由 [apiHandler](../../packages/pixishelf/lib/api-handler.ts) 返回500与固定 `Internal Server Error`；`localImport.start` 也会经 tRPC 内部错误脱敏，用户无法区分维护占用、历史证明失效与服务故障。这是新增正常拒绝路径的可操作性缺口，违反[扫描 HTTP 契约](../security/http-response-contract.md)对冲突的409语义；底层回滚及来源保护本身仍有效。

独立最小复现使用真实导出的错误类，没有 DB、网络或媒体 I/O。在 `packages/pixishelf` 运行：

```bash
pnpm exec node --import tsx -e 'const { classifyBackgroundTaskTransportError } = require("./services/background-task/transport-error.ts"); const { ArtworkDedupOperationError } = require("@pixishelf/db"); for (const code of ["SOURCE_HELD", "SOURCE_GENERATION_CHANGED", "SOURCE_IDENTITY_CHANGED"]) console.log(JSON.stringify({ code, classified: classifyBackgroundTaskTransportError(new ArtworkDedupOperationError(code)) }));'
```

三个结果均为 `classified:null`，完整输出保存在 `/private/tmp/dedup-app-input-proofs-review-transport.log`。首次尝试 `tsx -e` 被沙箱的 IPC listen 权限阻止，改用 `node --import tsx` 完成同一只读检查，没有提升权限或改动运行环境。

初审修复建议：在中央扫描服务做窄适配，把这几个预期来源拒绝转换为已有 `BackgroundTaskError`，提供固定的维护中或保留旧输入、复核后新提交提示；未知 DB/文件异常继续向外抛出。添加最小 transport 回归证明预期拒绝得到400/409、未知错误仍是500，并保留现有零残留断言。原实施者按此窄修，独立复核见下节。

## P2 窄修复核与关闭

复核范围仅为私有 `rethrowScanSourceConflict`、三处 groups capture/assert 的 catch 接点、新增七项传输回归及 PG 期望码调整。三个文件的实际 SHA-256 与实现记录一致：

| 文件                                                                             | SHA-256                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/pixishelf/services/media-root-central-service.ts`                      | `2d2535c8fb1b65f8b6f82ae9a254bcdb4512b93a707f9361f18cdb3f782c7424` |
| `packages/pixishelf/services/__tests__/media-root-central-service.test.ts`       | `bdbe06c76e0d3969768d0d3894d0728a721e01cf52295dadbfd45b1a65d96825` |
| `packages/pixishelf/services/__tests__/media-root-source-proof.postgres.test.ts` | `27f2d7ca3765838ae8dd78eab8b2a60c7b4ac9ba8529937ebe527e82ae094c64` |

第697–709行 adapter 只处理真实 `ArtworkDedupOperationError` 的三种预期源码，转换为既有 `BackgroundTaskError('CONCURRENT_MODIFICATION')`：HOLD 给维护中提示，generation/identity 失效提示保留旧任务并在复核来源后新提交。未知 Error、伪同名错误和其他领域码均由末尾 `throw error` 原样抛出，不把数据库故障统一伪装成业务冲突。

第616、645、669行分别接入复用 assert、metadata capture、本地 capture；CLIENT_LIST、Pixiv/本地定点重扫、目录导入与这些入口的活动任务复用均经过该适配。调用仍在原事务内 reject，没有捕获后继续提交、修改证明、重捕获代次或改变锁序。原 HTTP/tRPC classifier 保持不变，适配后的预期错误通过已有分类获得 HTTP409 与 tRPC CONFLICT；未知错误保持500脱敏。初审直接对 DB 错误调用 classifier 得到 null 的复现仍成立，但修复后的 service 已先适配预期错误，不再把它直接送入传输层。

独立在 `packages/pixishelf` 执行：

```bash
pnpm exec vitest run services/__tests__/media-root-central-service.test.ts -t 'maps .*capture HOLD|maps reused input|keeps unknown source-helper errors'
```

结果7项通过、10项因名称筛选未运行，测试时间14ms，总时长2.14s。七项真实调用 service→runBackgroundTaskApi→apiHandler：两种 capture HOLD 与三种 reuse 拒绝得到409并核对 tRPC 分类；复用拒绝未调用 capture。普通 Error 与领域 STALE 验证为同一错误引用向外抛出、classifier 返回 null、最终固定500响应。仅 DB helper/事务与文件读取按原测试夹具 mock，传输层未 mock；本次不宣称真实 PostgreSQL 事务重新验收。

实现者报告完整中央单测17项、三文件定向 lint、App TypeScript 通过，本复核未重复这些完整检查，也未重跑 PG。PG 只将原 HOLD 拒绝码期望改为 CONCURRENT_MODIFICATION，原事务零残留断言保留。结论：P2 关闭，窄修未发现新增问题；不扩大本批既有执行器、native 和文件生命周期边界。

## 已核对的不变量

| 范围            | 本批核对结果                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新扫描冻结      | CLIENT_LIST、本地目录导入和定点重扫在原 `afterEnqueue` 事务内一次调用完整 groups capture，再保存已序列化证明；每输入一至两项，预算沿原最多10000项。没有逐行 capture 或新增 hash。任务、ScanRun、输入与来源行任一失败均随原事务回滚。                                                                                         |
| 来源可信性      | Pixiv 用路径解析出的 provider/externalId 加 metadata 精确 PATH；不捕获 artist 父目录。受信根使用现有 `resolveMediaContentRoots` 和 inventory 根绑定。本地重扫新增 `createdVia === LOCAL_DIRECTORY` 检查，并在原事务重读比对；历史 LOCAL_IMPORT/LOCAL_CREATED 标签不单独授权 DIRECTORY。明确的新目录导入可冻结选中目录证明。  |
| 活动任务复用    | `validateReusedScanRun` 先保留原输入、摘要与请求语义核验，再严格 parse 原证明并一次 groups assert；没有覆盖既有输入、补 null、默认0或重捕获当前代次。                                                                                                                                                                        |
| 审计 Apply      | 同时严格解析观察与原冻结输入，核对路径、externalId 和完整 identity/sourceId/generation 相同后原样复制。缺失或不一致返回 ITEMS_NOT_ELIGIBLE；证明不进入 metadata/audit 摘要。本处允许仅产生队列意图，不提前检查 DB OPEN/当前代次；Executor 首次读取与实际发布前必须断言原证明，此边界经主线程确认，执行器验证不属于本批结论。 |
| 新 URL 意图     | 新 submission、RESOLVE 排队及 Provider 证明在同一事务；先原 creator catalog，再统一来源锁。Uploader 复用该入口，修正链接的新项也在事务中捕获；DUPLICATE/容量失败审计项无执行证明。                                                                                                                                           |
| 原项重试        | 收件箱和通用 `ARCHIVE_RESOLVE_ITEM` retry 均 parse 原证明、按提交 URL 核对 provider 身份，再 assert 原 identity/sourceId/bigint generation；拒绝发生在子任务创建和原项重置之前。既有状态/CAS、容量/重复检查、操作者及幂等约束保留，证明没有写回或重捕获路径。                                                                |
| URL 纯解析      | `/g` 与 `/s` 的 gid 从共享纯 parser 获得，`/s` 不需 gtoken 网络请求即可冻结身份；协议、主机、凭据、非默认端口及完整路径受限，gid/页号为正安全整数。App wrapper 保留本地 ArchiveError 边界。最终 resolve 与冻结身份一致性须由后续 Executor 批验证。                                                                           |
| 账户、锁与控制  | 本批未新增客户端 proof 参数；操作者继续由既有 Session/Token 入口提供，没有引入任意 userId 或新增 expectedUserId 契约。capture/assert 在原 queue/submission fence 与 catalog 后、Artwork/内容写锁前调用；未发现反向取得根或来源锁。取消与失败控制未增加 OPEN 前置条件。                                                       |
| wire 与旧 READY | 服务从 wire 中移除原 proof，只返回结构与提交 URL 身份是否有效的 `sourceIntentValid`，不声称该布尔值证明来源仍 OPEN。旧 READY/无证明项不能通过本批 UI 直接下载或重试，仍可选择取消。后端 READY→Import 和下载/发布拒绝需由独立 Executor 接线证明，UI 限制不能替代该验收。                                                      |

独立执行 UI 纯函数检查，真实调用 `isSelectableIntakeItem`、`isEnqueueableIntakeItem`、`isRetryableIntakeItem` 与 `countArchiveIntakeActions`，断言旧 READY/`sourceIntentValid:false` 得到 `selectable:true`、`enqueueable:false`、`retryable:false`、计数 `{enqueue:0,cancel:1,retry:0}`；通过，输出在 `/private/tmp/dedup-app-input-proofs-review-ready.log`。

## 限制与后续

本审查未连接专库、主目录、用户5430服务或真实媒体，没有运行全量 build/test、500k规模、native、网络下载或真实浏览器。未重审已独立审查的 DB helper，已知批量 path overlap 性能修复不重复列项。原实现记录已说明旧大型 Uploader/Archive fixture 尚需按 null proof 与真实可解析 gid 语义迁移，不能据本批定向测试数量声称长期流水线通过。

本记录及路径大小写/空白检查由本审查完成；全量文档和图示检查由主线程汇总，本审查未运行。P2 已在上述冻结内容上关闭；扫描/归档 Executor 消费与最终发布、URL hold/drain、来源 release 和全 App 写入口仍各自验收，不能据本次窄审提高 gate 3。
