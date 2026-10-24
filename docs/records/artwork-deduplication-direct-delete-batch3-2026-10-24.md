---
status: historical
scope: 第三批正式直接删除 UI、必要展示 DTO、定向组件验证与后续验收交接
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/ui-design.md
  - docs/design/artwork-deduplication/direct-delete.md
  - docs/records/artwork-deduplication-direct-delete-batch2-2026-10-24.md
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-workspace.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-actions.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-preview.tsx
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-display.test.ts
  - packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts
---

# 第三批页面与最终验收

2026-10-24，GPT-6.1 Sol / xhigh 在 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication`、HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 加既存 WIP 上实施。此节只证明正式 UI 与展示投影的定向验证，**等待独立审查、真实 PostgreSQL 展示查询核验、最终全量检查和浏览器验收**。本实施未改 `ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=false` 或 release stage3；后续候选门禁及最终开放决定由主任务登记。

遵循 frontend-design、shadcn 指南及已批准原型，保留现有字体、蓝色语义主题和留白。没有另起视觉方案。worktree 在默认可写根之外，写入和 pnpm 临时文件通过工具正规提升权限完成；没有访问主工作区、暂存、提交、重置、真实库/媒体或用户 App/Worker。

## 最新集成状态

**第三批已完成并收口暂停。** UI、展示 SQL 与隔离候选门禁已完成独立审查，两项 P2（隐私遮蔽与审核后旧分页游标）及浏览器发现的 320px P3 均已修复复审，见[审查结论](./artwork-deduplication-direct-delete-batch3-review-2026-10-24.md)。[真实浏览器验收](./artwork-deduplication-direct-delete-batch3-browser-2026-10-24.md)覆盖实际删除、分页、隐私、账户切换及生产构建产物复查。下方“未执行/等待”表述保留各实施交接当时语境；最终结果以本节及最终验收段落为准。

主任务只运行一次全量 App lint/unit、Worker 依赖链单元和类型检查；出现的旧 fixture 契约缺口修正后仅重跑对应文件，没有重跑全量或 50 万性能样本。代码和隔离测试尚未部署到真实图库。

## 本次改动

| 范围                   | 实施内容                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 检查结果 / 删除记录    | `duplicate-workspace.tsx`、`duplicate-operations.tsx` 改为两 tab，按服务器分页展示记录、实际组/副本数、已完成/未完成和已删文件。继续以 URL 稳定 operationId 续看；艺术家现有“检查重复”入口补 `entry=direct`。                                                                                                                                                                                                            |
| 审核和准备             | `duplicate-review.tsx` 保留 keeper radio 与独立删除组选择、20 组分页及跨页 ALL_RECOMMENDED/exclusions；新 PREPARE 显式提交 `purpose=DIRECT_DELETE, protocolVersion=1`。`listGroups` 的 SAVE_REVIEW 沿用 stage3，PREPARE_CLEANUP 仅按新目的独立 gate 返回。另投影 keeper 摘要，让保留者在前3名以外时仍能显示具体作品；成员20条分页沿用。                                                                                  |
| 一次删除确认           | 新 `duplicate-delete-consent.tsx` 在同一 Sheet 的冻结清单后展示不可恢复/不合并后果和持续外部停写声明，两项勾选共同授权三个 literal true。`duplicate-operation-actions.tsx` 只调用 directDelete/retry/cancel/新目的 reprepare；没有口令、备份表单或第二个删除确认弹窗。必须是新目的/协议、READY、无阻断且清单已载入，并有服务器 DIRECT_DELETE allowedAction。旧目的记录只读，提示返回检查结果重新准备，不能补签旧 READY。 |
| 幂等与账户             | 复用既有 `useDuplicateIntent` 的同步请求锁与原规范输入幂等键；未知响应刷新同 operation，原意图重试仍用原键。操作状态按账户、operation、版本与 scopeDigest 重新挂载确认；账户替换后的迟到响应被忽略。没有新增 client/env 门禁绕过。                                                                                                                                                                                       |
| 取消 / 安全停止 / 续行 | 展示 DTO 新增持久 deleteStartedAt、stopRequested 和按 DELETE receipts 的 distinct fileId 统计。动作投影在首意图前给 CANCEL，之后给 STOP；不按 DELETING 阶段推测。PREPARE BUILDING 的 reader 活跃时仍可请求取消，不谎称已退出。部分失败/STOPPED 仅给“复核并继续原删除”，不提供换 keeper、扩围、恢复或再次授权；已终结停止不继续显示“等待退出”。                                                                           |
| 冻结影响和来源         | `duplicate-operation-preview.tsx` 分页读取作品/原件附属清单，展示 keeper/copy、登记原媒体/文件数、章节/来源文件角色、具体文件名及来源保护。文件 DTO 加冻结 artworkRole/artworkTitle，明确保留文件不删除。标题/来源/创建时间始终取持久快照；来源只返回可读末级名称/provider类型及当前保护代次，不暴露绝对路径或原始哈希。                                                                                                 |
| 删除后与隐私           | 当前账户的实时整理说明执行前复核；已业务删除的副本标 REMOVED，显示“已随副本删除”，不把缺失历史伪装成零评分/未阅读。其他账户仍只有保护资格布尔。真实墓碑可另行选择来源解除，只允许未来新输入，不恢复文件、不复活旧任务；没有真实可发现来源时不生成虚假 LOCAL_CREATED provider 行。                                                                                                                                        |
| 窄屏与诊断             | 沿用 Radix Sheet 的可访问名称、焦点围栏和关闭后焦点归还；手机全宽、44px主要操作、底部安全区、跨页栏导航偏移。新文件/操作诊断折叠，仅展示受限错误码；未知原始原因不直接铺出路径。jsdom 不证明真实视口布局或键盘行为。                                                                                                                                                                                                     |

必要展示精度约束已先补入 [UI 设计](../design/artwork-deduplication/ui-design.md)。DB 已冻结的 impactSignature / organizationSignature 是校验摘要，未保存历史标签、系列、派生指针或私有整理明细；本批不新增 JSON 快照、迁移或删除业务。页面只说明这些影响随副本删除、不合并，不虚构冻结细节。普通 archive 回收与恢复未改；旧去重 consent 文件作为既存 WIP 保留，但现行页面不导入或调用旧隔离/恢复/PURGE 动作。

## 定向验证

全部命令在上述 worktree 执行，仅 node/jsdom/mock，不连接数据库，不启动服务。

```bash
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components --reporter=dot
pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-display.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts app/admin/duplicates/_components/__tests__/duplicate-intent.test.tsx app/admin/duplicates/_components/__tests__/duplicate-operation-preview.test.tsx --reporter=dot
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components services/__tests__/artwork-dedup-display.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts --reporter=dot
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-workspace.test.tsx --reporter=dot
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-operation-actions.test.tsx --reporter=dot
pnpm --filter @pixishelf/job-contracts exec vitest run src/__tests__/artwork-dedup-maintenance.test.ts --reporter=dot
pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false
pnpm exec oxlint packages/pixishelf/app/admin/duplicates packages/pixishelf/services/artwork-dedup-review-service.ts packages/pixishelf/services/__tests__/artwork-dedup-display.test.ts packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts 'packages/pixishelf/app/artists/[id]/_components/head-info.tsx'
git diff --check
rg --files packages/pixishelf | rg '[A-Z]'
```

结果及故障透明记录：

- 第一次 UI 运行 52 通过、1 失败：新 consent 直接转发 click event，测试期望无参数回调。修为显式无参数回调后，组件目录 **8 文件 / 57 项通过**。
- 展示 DTO、真实 gate、预览/确认子集 **4 文件 / 12 项通过**；contracts 维护契约 **1 文件 / 3 项通过**。子集含重复，不累计成额外覆盖。
- 随最终文件角色展示修改进行的最小合并检查为 **9 文件 / 61 项通过、1 文件 / 1 项失败**。失败为旧 Nuqs memory adapter 在重新渲染中 reset 全局队列，丢失关闭后快速打开的 URL 更新并触发 React render-time setState 告警。仅在该测试关闭 `resetUrlUpdateQueueOnMount`，原精确 URL/操作恢复断言保留；单项复跑 **1 通过、无该告警**。没有重跑其余已通过项。
- 最后仅调整停止终态文案的 actions 专项结果见下方最终核对。App tsc 已通过；早期只发现旧测试新 props/fields 缺失和新 mock 的 tuple 类型，均修复。未运行 Next typegen，不能将此 tsc 结果写成完整主应用 typecheck 流程。
- 定向 lint 最初有新增两处 curly、一个测试 mock 未使用参数；修后 **35 文件 / 0 warning / 0 error**。未扩大到全量 lint。
- 主应用大写路径 0 匹配。最终 diff/最后 actions 结果登记于下方；文档及图示统一检查归主任务，不在本实施重复运行。

测试实质覆盖：新目的/摘要/版本及三个 true 的请求形状、同面板两勾确认、快速双击禁重、未知响应复用原意图、账户/版本重置及迟到结果隔离、旧READY/失败/过期/阻断不授权、不同阶段在真实首意图前取消、部分失败仅原范围继续、来源代次选择、无伪造来源、作品/文件独立游标、keeper在摘要之外、删除后的 REMOVED 展示及当前账户查询条件/路径脱敏。

## 后续真实查询与浏览器验收

尚未执行、不能由 mock 或 tsc 替代的展示证据：`getOperation` 新增 distinct DELETE receipt 文件计数 SQL（含跨 execution 重放仍按文件去重）、FILES 关联冻结 artworkRole/title、结果 keeper 不在前3成员时的投影，以及业务行删除后标题/来源/时间和 REMOVED/真实墓碑代次投影。由主任务后续隔离 PostgreSQL/API/浏览器样本补齐；本批不重跑 B1/B2 的文件删除、native、四来源或规模矩阵。

最终浏览器使用隔离 App/Worker、合成根、`entry=direct`；集中核对25组跨页和>20成员、四来源混合、真实一次删除及删除记录、未知附件阻断、旧READY不兼容、同operation超时与账户切换、首意图前取消/之后停止、部分失败续原范围、删除后的来源解除。桌面/320与390px/深浅色、长标题、无封面、Tab方向键、Sheet Esc/Tab围栏/焦点归还、44px与安全区按真实浏览器记录；真机限制另记。未把原型或jsdom作为浏览器验收。

门禁固定 false 的既有断言位于 `packages/pixishelf/services/__tests__/artwork-dedup-direct-delete-disabled.test.ts` 的 real gate 用例，以及 `packages/pixishelf-job-contracts/src/__tests__/artwork-dedup-maintenance.test.ts` 的 DIRECT_DELETE / DIRECT_DELETE目的 PREPARE 断言。它们本轮保持通过；后续发布候选 gate 修改需同步调整这些测试的预期和独立审查，不能临时 client/env 绕过。

未执行全量 lint/test/build、Worker链、PostgreSQL后端矩阵、50万样本、图示或浏览器；未操作生产或用户服务。以上均交主任务按最终一次检查计划完成。

## 实施者最终核对

停止终态文案 actions 专项 **1 文件 / 18 项通过**；URL专项 **1 / 1通过**。最后定向 lint 与 diff 检查通过，大写路径0匹配。所有本实施启动的命令已结束，没有启动 App/Worker 或连接真实服务。实施冻结后不再修改代码，等待主任务安排独立审查及后续真实查询/浏览器证据；此处不是最终产品开放结论。

## PostgreSQL 展示补证与隔离候选交接

本节是上述 UI 冻结之后的补证，使用同一 worktree、既存合成 `dedup_executor_next` 与新建合成 `dedup_b3_browser`，均只在 `127.0.0.1:55432`。不重做 B1/B2 独立审查、文件核心矩阵或规模测试。没有连接用户库、真实媒体或 5430，也没有改主目录的环境文件。

### 实际展示查询

新增 `packages/pixishelf/services/__tests__/artwork-dedup-display.postgres.test.ts`，通过现有最小 DB fixture 调用真实 review service / Prisma 查询，最后只清理本测试创建的 receipt、source binding/source、root 和原 fixture ID：

| 真实查询                    | 断言结果                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `getOperation` 文件收据计数 | 5 条收据包括跨 execution 重复 DELETE 与非 DELETE；按 DELETE 的 distinct fileId 返回 3，不按收据条数计文件。                             |
| FILES 冻结关联              | 业务 Artwork/Image 行删除后，文件仍返回冻结 Artwork role/title。                                                                        |
| 组 keeper 摘要              | 同组 4 成员、keeper 位于第 4 个，前三成员摘要之外仍返回正确 keeper。                                                                    |
| 业务删除后的作品            | copy 使用冻结 title/source/time，`personalRecords=REMOVED`；keeper 保持 CURRENT，未将消失的私人整理伪装为零，也不返回其他账户私有记录。 |
| 来源保护代次                | 绑定快照为 generation 0、当前实际 source 为 TOMBSTONE/generation 17，DTO 返回当前 17。                                                  |

测试直接建立合法持久展示行以隔离 SQL 投影，不把这些样本状态当作真实 unlink/业务删除执行证据；真实执行证据仍沿 B2，浏览器删除另行验收。

精确命令（连接值使用合成库占位；不从 App 环境读取）：

```bash
QUEUE_KERNEL_TEST_DATABASE_URL='<dedup_executor_next fixture URL>' pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-display.postgres.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts --no-file-parallelism --reporter=dot
```

结果 **2 文件 / 3 项通过**。当时 App `tsc --noEmit --incremental false`、executor typecheck 通过，新增相关文件定向 lint 通过。

### 门禁候选及拒绝记录

首次变更常量的正规提升权限请求被自动审批拒绝：它认为持久启用直接删除能力的具体授权尚不明确。实施者没有重试绕过、替换 dist 或用 mock 给浏览器开放。主任务随后向用户提出精确授权问题：“是否授权在独立去重 worktree 中，将 ARTWORK_DEDUP_DIRECT_DELETE_ENABLED 从 false 改为 true，仅连接新建的合成测试库和媒体目录做第三批真实删除验收？不部署或操作你的真实图库；验收失败就恢复关闭。自动审批要求你明确批准这个具体开关变更。”用户直接回复 **“授权，仅用于隔离候选验收”**，随后同一常量变更通过正规审批落盘。

独立审查须明确核对的发布差异：`packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts` 的 `ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=true`，release stage 仍为 3。ISOLATE/RESTORE/PURGE 与 PURGE 目的 PREPARE 仍关闭；没有客户端参数、环境变量或新旁路。候选只用于本节新隔离 App/Worker/DB/媒体，未宣称生产开放；独立审查或最终验收不通过时应恢复 false。

| 验证文件                                                               | 证据                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts `src/__tests__/artwork-dedup-maintenance.test.ts`            | 真实候选 true/stage3 与旧模式关闭，3/3 通过；后续主任务 contracts 全量 169 通过包含本项。                                                                                                          |
| App `services/__tests__/artwork-dedup-direct-delete-candidate.test.ts` | 不 mock contracts；真实候选合法输入仍需兼容 Worker，离线时 PRECONDITION_FAILED。旧 purpose/protocol、空 scope、任一确认 false、路径/userId 注入 BAD_REQUEST；匿名/账户切换在事务前拒绝，2/2 通过。 |
| App `services/__tests__/artwork-dedup-direct-delete-disabled.test.ts`  | 改为可信测试模块显式关闭 gate，仍证明关闭时新入口不创建工作，2/2 通过。                                                                                                                            |
| executor `src/artwork-dedup/__tests__/direct-delete.postgres.test.ts`  | 同样显式关闭测试模块，保留 Worker 的 independent API/gate 关闭分支；只选该项运行，1 通过、29 跳过。                                                                                                |

### 隔离真实 App / Worker

新目录 `/private/tmp/pixishelf-dedup-b3` 为 0700。`runtime.env`、`manifest.json`、`seed.mts` 为 0600，账号和合成密码只留在该受限文件，不写入此记录。DB 为正式迁移至 115 的 `dedup_b3_browser`；显式环境覆盖所有媒体、派生和 pixiv-data 路径为此目录下的新子目录。应用 `.env.local` 未改。

种子前缀 `b3-1792835173941-72120fee`，新增 2 个实际 Better Auth credential 账号、3 位艺术家、75 件作品；账号、具体样本 ID 和允许浏览器删除范围以 `manifest.json` 为准。样本包括四来源 manual/local/pixiv/URL 混合一组，25 组与一组 21 成员的分页场景、当前/其他账户整理记录，以及未登记附件阻断场景。URL 样本通过实际 archive download/publish executor 与 fenced queue context 登记，使用内存 PNG provider，不访问网络；未伪造完成状态。没有为视觉展示制造部分失败或删除成功数据，旧预览只读场景未额外造复杂样本。

| 服务     | 交接时实际状态                                                                                     | 启停与日志                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| App      | `127.0.0.1:5440`，PID 196，工具 session 91066；`/login?entry=direct` HTTP 200。                    | `start-app.sh`；`app.log`。实际入口 `http://127.0.0.1:5440/admin/duplicates?artistId=1&entry=direct`。 |
| Worker   | 健康口 `127.0.0.1:55412`，PID 131，工具 session 33735，workerId `dedup-b3-browser-worker`；READY。 | `start-worker.sh`；`worker.log`；运行真实当前源码 bundle `dist/main.cjs`。                             |
| ImgProxy | 主任务新建 `pixishelf-dedup-b3-imgproxy`，仅 `127.0.0.1:55433`，新媒体/派生只读挂载。              | App 显式 `NEXT_PUBLIC_IMGPROXY_URL=http://127.0.0.1:55433`；主任务负责只停删此新容器。                 |

脚本、日志与 `runtime.json` 均位于上述临时根。停止 App/Worker 使用 `/private/tmp/pixishelf-dedup-b3/stop-services.sh`，脚本先核对精确 PID 在对应端口监听才 TERM，不操作进程组或旧服务；服务重启后须更新交接 PID，不能复用旧号码。交接保持这两项验收服务运行，所有测试/类型/build 命令均已结束。

直接源码 `tsx src/main.ts` 启动遇既有 ESM `require.main` 不兼容，未修改生产入口；按主任务许可仅执行 Worker 的 `node scripts/build.mjs`，真实 bundle 启动成功。候选常量落盘后因源码变化必要重建并重启一次，计入最终 Worker 产物检查，不再重复。build 有 3 条既有 CJS `import.meta` 空值警告，正常 fallback 可启动，无错误。最后以显式隔离环境运行 `healthcheck.cjs --mode=ready`、`capability-audit.cjs`，能力审计 **1 READY Worker / 39 job types / 48 versions**，含 `ARTWORK_DEDUP_MAINTENANCE [1,2]`。没有使用自写假 Worker，没有进行浏览器操作。

## 最终首轮失败的有限收口

主任务执行本批唯一一次 App 全量 lint/unit 及 Worker 链 unit/types，实施者只根据首次日志修复所列文件、做定向复验，没有重复全量任务。

| 首次结果及日志                                                                                                   | 最小修复与定向结果                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App lint：3 warning / 11 error，`/private/tmp/dedup-b3-final-app-lint.log`                                       | 仅 logged 文件补 curly、两个 GET 导入别名、等价 NUL `.includes` 检查。`archive-task-service.postgres.test.ts` 现有 7 个 helper 提取为同目录 `archive-task-service-fixture.ts`，保留全部断言并满足 1200 行限制。18 个修改文件定向 lint 0 warning/0 error。                                                                                                                                                |
| App unit：434 文件 / 3131 通过，47 文件 / 320 跳过，4 文件 / 18 失败，`/private/tmp/dedup-b3-final-app-test.log` | auth、archive-module、merged-artist-create、update-artwork-tags 均为旧 mock 缺新服务归属、来源证明/锁/claim 模型。auth mock 调真实账户检查；最大 limit 负例改为真实上限外 101，并保留 userId 注入拒绝；archive 用真实原证明、精确 SQL mock，新增缺证明/HOLD 零业务写负例。四文件原业务断言保留，定向累计覆盖 35 项全过（含新增 2 项，重跑不重复计）。未发现生产逻辑缺陷。                                |
| helper 提取的必要 PG 复验                                                                                        | 只选 archive-task-service 的 `uses a createdAt/id keyset`，真实 `dedup_executor_next`，1 通过 / 43 跳过。                                                                                                                                                                                                                                                                                                |
| executor 全量首次：821 通过 / 291 跳过，5 文件 / 53 失败，`/private/tmp/dedup-b3-final-worker-test.log`          | 仅 `archive/__tests__/{executor,intake-deletion,maintenance-executor,metadata-comparison,resolver-executor}.test.ts` 与新增 `dedup-guard-fixture.ts`。加入原始序列化来源证明、严格对应 identity/key/Artwork 锁 SQL 与 claim 模型，真实 guard 继续执行。初次局部 73 通过 / 10 失败，补齐代次/检查点后五文件 **83/83 通过**；另加 resolver 缺证明/HOLD 两项负例，单文件 **16/16 通过**，总独立用例 85 项。 |
| Worker package 首次：110 通过 / 11 跳过，仅 config 1 失败，`/private/tmp/dedup-b3-final-worker-package-test.log` | 仅更新正确默认保护目录 `.pixishelf-upload-recovery` 的顺序断言；config 单文件 **5/5 通过**，生产配置未改。                                                                                                                                                                                                                                                                                               |

executor 收口没有改生产逻辑：重启测试使用新的 execution token，避免复用已退出代次；e-hentai 元数据夹具的 provider 与原证明保持一致；CLEAN 正例使用实际持久 generation/drained、实际 manifest SHA、通过正常事务回调创建 checkpoint，真实检查目录身份与 declaration。原越界/根目录负例改在更早的 generation 身份校验处预期 `STATE_CONFLICT`，仍逐字验证外部/根文件保留，并补 begin 未调用。没有 mock 掉新增保护或用 legacy 目的规避。

最后 executor/Worker 两包 typecheck 通过，七个 executor/Worker 测试夹具文件 lint **0 warning / 0 error**。过程中的测试 `$queryRaw` spread 重复覆盖类型错误已修复；最后只对该文件和 mock 签名修改文件再复验，**2 文件 / 45 项通过**，不重跑五文件或整链。App 最后 `tsc --noEmit --incremental false` 已通过。差异空白检查通过，主应用大写路径 0 匹配；图源未改，文档/图示最终统一检查归主任务。

精确有限命令（上述 DB URL 占位只指合成专库）：

```bash
pnpm --filter @pixishelf/next exec vitest run server/routers/__tests__/artwork-dedup-auth.test.ts services/archive/__tests__/archive-module.test.ts services/artwork-service/__tests__/merged-artist-create.test.ts services/artwork-service/__tests__/update-artwork-tags.test.ts --reporter=dot
pnpm --filter @pixishelf/next exec vitest run services/archive/__tests__/archive-module.test.ts services/__tests__/artwork-dedup-direct-delete-candidate.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts --reporter=dot
DATABASE_URL='<dedup_executor_next fixture URL>' PIXISHELF_TEST_DATABASE_URL='<same fixture URL>' pnpm --filter @pixishelf/next exec vitest run services/archive/__tests__/archive-task-service.postgres.test.ts -t 'uses a createdAt/id keyset' --reporter=dot
pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/executor.test.ts src/archive/__tests__/intake-deletion.test.ts src/archive/__tests__/maintenance-executor.test.ts src/archive/__tests__/metadata-comparison.test.ts src/archive/__tests__/resolver-executor.test.ts --reporter=dot
pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/resolver-executor.test.ts --reporter=dot
pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/executor.test.ts src/archive/__tests__/metadata-comparison.test.ts --reporter=dot
pnpm --filter @pixishelf/worker exec vitest run src/__tests__/config.test.ts --reporter=dot
pnpm --filter @pixishelf/job-executors typecheck
pnpm --filter @pixishelf/worker typecheck
```

至本节只冻结实施与自测证据，不作为独立审查通过。实际一次浏览器删除、浏览器窄屏/键盘/焦点、旧预览/停止/部分失败的可达性及最终 App build 仍由主任务安排；不以 mock、种子或 READY 替代这些验收。

## B3 独立审查两项 P2 的限定修复

2026-10-24，原 UI 实施 GPT-6.1 Sol / xhigh 按[第三批独立审查](./artwork-deduplication-direct-delete-batch3-review-2026-10-24.md)只修 P2-01/P2-02。仍在同一 worktree / 分支 / HEAD 加既存 WIP，保留 App Sol 已落盘的真实 PG 展示、候选 gate=true、关闭负例及旧夹具适配；没有改后端、契约、门禁、数据库或运行中的隔离 App5440/Worker55412，也没有接触真实服务、主工作区或 Git 暂存提交。本节是实施与自测，等待原 reviewer 差异复审，未自行关闭审查项。

| 审查项                      | 限定修复                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-01：文件和来源名称未遮蔽 | `duplicate-operation-preview.tsx` 的 relativeName、冻结 artworkTitle、sources displayName，以及 `duplicate-reimport.tsx` 的来源名称统一使用既有 PrivacySensitiveText。实际渲染节点带 data-privacy-sensitive；角色、文件数、状态和动作位于标记外继续可读。保留原文本与 label 关联，来源 checkbox 可访问名称不变，没有新增遮蔽机制或改变复制/辅助技术语义。                                                                                    |
| P2-02：保存后旧审核游标失效 | `duplicate-review.tsx` 保存成功或未知响应刷新时回组首页，只将旧查询标 stale、不主动 refetch 旧 opaque cursor；只精确刷新不携带游标的组/该组成员首页。已选删除组、saved review、draft 与原幂等意图均保留。向成员面板传递当前 reviewRevision；`duplicate-members-sheet.tsx` 在 revision 变化的首次 render 就改用无 memberCursor 查询，再同步复位分页状态，因此不在 effect 前发出旧游标。错误页手动重新加载也先回首页，避免对失效游标原地重试。 |

新增有限证据：在原组件测试内断言真实文件名、冻结作品名、来源显示和来源 checkbox label 的隐私 marker；同时确认角色/来源状态不被标记。两条严格 revision fixture 都通过真实组件的 React Query mutationFn 推进服务端模拟 reviewRevision，游标严格绑定原 revision，旧游标会直接抛 INVALID_CURSOR，未放宽服务版本校验：

- 结果第2页保存 keeper 后，后续查询均无旧 cursor；返回首页后仍保留跨页两组选中范围，重新翻页拿到新 revision 的 cursor、正确 keeper，预览提交仍含两组与新审核版本。
- 21成员组第2页保存第21部 keeper 后，成员页回首页并显示该具体保留者；再翻页使用新 memberCursor，可回首页再保存第20部，第二次 mutation 使用正确 expectedReviewVersion。全过程没有发出旧 memberCursor、没有 INVALID_CURSOR 重试循环，原删除组选择保留。

精确验证命令：

```bash
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-review.test.tsx app/admin/duplicates/_components/__tests__/duplicate-members-sheet.test.tsx app/admin/duplicates/_components/__tests__/duplicate-operation-preview.test.tsx app/admin/duplicates/_components/__tests__/duplicate-operation-actions.test.tsx --reporter=dot
pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false
pnpm exec oxlint packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-preview.tsx packages/pixishelf/app/admin/duplicates/_components/duplicate-reimport.tsx packages/pixishelf/app/admin/duplicates/_components/duplicate-review.tsx packages/pixishelf/app/admin/duplicates/_components/duplicate-members-sheet.tsx packages/pixishelf/app/admin/duplicates/_components/__tests__/duplicate-review.test.tsx packages/pixishelf/app/admin/duplicates/_components/__tests__/duplicate-operation-preview.test.tsx packages/pixishelf/app/admin/duplicates/_components/__tests__/duplicate-operation-actions.test.tsx
git diff --check
```

结果：组件 **4文件 / 32项全部通过**，没有跳过；App tsc通过。定向 lint 首次仅新 fixture 的一处多行 if 缺花括号，补齐后 **7文件 / 0 warning / 0 error**；此格式修复没有改 fixture 行为，不重跑已通过组件。diff空白检查通过。既有 Nuqs adapter 修正保留，未扩大测试或重跑全量 App/Worker/DB/native/图示。

本轮未操作浏览器、未重启服务。待原 reviewer 差异复审后，主任务使用现有隔离25组/21成员样本，实际核验非首页保存、privacy FILES/来源选择与键盘/窄屏行为；jsdom marker及严格fixture不替代真实浏览器遮蔽或布局验收。修复现已冻结，所有本轮命令结束。

## 最终集成静态与依赖证据

首次全量失败及定向修复沿用上方“最终首轮失败的有限收口”表，不重复累计。另有以下主任务证据：

- App `pnpm typecheck`（Next typegen + tsc）通过；后续 UI P2 的 App tsc 通过。
- Worker 链 DB/contracts/runtime/executors/worker typecheck 通过，依赖 build 与候选 Worker bundle 通过，实际隔离 Worker READY、维护 v1/v2 能力已登记。
- Worker 链单元的 DB 170、contracts 169、runtime 29 项通过；最终 executor 单元包含直接删除 native 7 项通过。B3 展示真实 PG 已通过，B1/B2 四来源、故障、空/非空升级证据沿用。

Worker 单元明确排除已取消隔离/移动方案的 `artwork-dedup/__tests__/maintenance-*.test.ts`，不把旧方案曾被阻断的检查写为通过。没有配置 PG 环境的全量单元中数据库套件仍跳过；它们不被单位测试数量替代。原始日志位于 `/private/tmp/dedup-b3-final-app-{lint,test,typecheck}.log`、`/private/tmp/dedup-b3-final-worker-{test,package-test,typecheck,dependency-build}.log`。

初始子 agent 会话结束后其 App/Worker 退出，浏览器因此遇到连接拒绝；主任务重启独立父会话 App 5440、Worker 55412，不属于产品缺陷。种子账号改用符合既有用户名规则的 `b3a/b3b` 对应邮箱；manifest/seed 同步，未修改认证代码。初始服务表 PID 仅为交接当时记录，后续启动信息以 `/private/tmp/pixishelf-dedup-b3/runtime.json` 为准，终态见最终收口段落。

## 320px fieldset 最小宽度修复

2026-10-24，GPT-6.1 Sol / xhigh 按最终浏览器反馈做一处低影响 CSS 修复。浏览器已定位320px结果页 document.scrollWidth=326，原因是 `duplicate-group-row.tsx` 的 keeper fieldset 保留浏览器默认 min-width:min-content；其成员行已有 min-w-0。仅给该 fieldset 增加 `className="min-w-0"`，允许它随父级收缩，不改交互、成员布局或其他组件。

本轮只运行该组件单文件 oxlint 与 git diff --check，均通过；未新增测试、未运行 tsc/build/全量检查、未操作隔离服务或浏览器。真实320px宽度修复结果交主任务定向复查，本节不将静态CSS改动等同浏览器验收。

## 最终交付与暂停

- 最后一次主应用 `pnpm build` 以隔离环境执行并 **exit 0**，日志 `/private/tmp/dedup-b3-final-app-build.log`；没有重复全量测试。随后以 `next start` 运行此产物完成窄屏及账户复查；该方式有 standalone 启动提示，不能将它冒称 Docker/standalone 镜像部署验收。
- 浏览器实际通过：四来源混合1组，保留1部、删除3副本/5文件；keeper仍可浏览；单个已批准合成目录来源解除；25组与21成员非首页保存；未知附件阻断；名称隐私；320/390px；A/B正常登录切换且不继承选择/删除确认。origin是隔离配置缺项，修正仅限 `/private/tmp` 环境文件，没有改生产认证。
- 用户对门禁和单来源解除均给出精确授权；相应自动审批阻断已通过正常授权解决，没有绕过。`ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=true` 仅留在本隔离候选分支，旧隔离/恢复/PURGE仍关闭；**未合入主目录、未部署真实实例、未操作真实媒体**。合入前仍须核对当时主线变化，部署按运维手册执行。
- 验收后只读确认合成库活动任务 **0**，停止本任务 App5440/PID9953、Worker55412/PID6368，并删除本任务新建 `pixishelf-dedup-b3-imgproxy` 容器；端口无监听。用户5430服务、既存数据库/容器不在停止目标内。
- 合成库 `dedup_b3_browser` / `dedup_b3_verify` 及 `/private/tmp/pixishelf-dedup-b3` 证据保留；最后一条READY预览仅用于确认态隔离，没有执行删除。没有留下自动继续开发安排，自动化80保持既有暂停状态。所有子agent本批均已结束。
- 复现命令在受限临时根：`start-production-app.sh`、`start-worker.sh`；复现需同时按原只读挂载重新启动合成 imgproxy55433，不能改用用户媒体代理。密码与连接值只在受限 manifest/runtime，不进入Git。`runtime.json`登记最终已停止状态，不把历史PID当活动进程。

### 验收限制与手机真机项

浏览器没有人为制造首删中断、部分失败、未知网络响应或迟到响应；这些沿用B2真实PG/native与B3组件证据，未声称浏览器通过。深色模式、无封面独立样本、全部键盘矩阵、超过20文件游标及物理iOS/Android未覆盖；细项以浏览器记录为准。工具已实际展示截图，但未提供文档化落盘API，无虚构截图文件。已有50万检测性能沿用，未重新运行，也未补称50万完整PREPARE通过。

仍需手机真机确认（仅查看和预览即可，不要求再次删除）：

1. 在重复组列表/成员面板上下滑动、翻页并切换横竖屏，确认无横向溢出和滚动锁死。
2. 打开删除预览、点击两项确认后取消，确认控件易点、底部按钮不被导航或设备安全区遮挡。
3. 在iOS Safari/Android Chrome关闭面板、返回页面及切换账户，确认浏览器返回手势、焦点与软键盘无异常。

最终文档检查：首次 `docs:check` 发现审查记录的一条技能相对链接多一层父目录，仅修正该链接后重跑通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（33个图源、23个内嵌Mermaid），无图源重生成。主应用路径大写0匹配，diff空白检查通过。主目录最终只读Git状态为空，未被本任务修改。文档日志 `/private/tmp/dedup-b3-final-docs.log`、图示日志 `/private/tmp/dedup-b3-final-diagrams.log`。
