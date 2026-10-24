---
status: record
scope: B2 直接删除后端、正式迁移及 App/Worker 接线完成，独立审查通过后暂停
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/direct-delete.md
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - packages/pixishelf-db/src/artwork-dedup-direct-delete.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/direct-delete.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf-worker/src/production-capabilities.ts
  - packages/pixishelf-db/prisma/migrations/20261024001800_artwork_dedup_maintenance_v2/migration.sql
---

# 第二批完成与暂停交接

**当前状态：第二批完成，独立审查及 P2-01 差异复审通过，按用户要求暂停。**最终结论见[独立审查记录](./artwork-deduplication-direct-delete-batch2-review-2026-10-24.md)。后文保留核心交接、自测、初审及修复过程的当时状态，不代表当前仍待审。删除能力保持关闭，第三批未开始。

**核心已冻结交 Sol；不是 B2 整批验收，不开放能力。**工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，原基线 `6e8d4f4c` 与既存多人 WIP；未提交、未重置、未改主工作区、真实库/媒体或5430，未恢复自动化80。独立 `ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=false`，release stage仍3。没有正式UI改动。

## 交接接口

所有 DB 方法接现有 `Prisma.TransactionClient`，App 必须同事务入队/绑定job，操作者取Session，不能允许客户端传入userId。新协议schema位于 `packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts`。

| 入口 | 输入和返回；接线责任 |
| --- | --- |
| `artworkDedupPrepareDirectDeleteInputSchema` | 严格 `purpose=DIRECT_DELETE, protocolVersion=1, expectedUserId`，加原run/审核版本/selection/idempotencyKey或sourceOperationId/expectedOperationVersion。App独立gate后映射 `freezeArtworkDedupOperation(... preparePurpose:'DIRECT_DELETE')`，复用原PREPARE入队；旧预览不能转换成授权。 |
| `artworkDedupDirectDeleteInputSchema` → `authorizeArtworkDedupDirectDelete` | 输入 `operationId, expectedVersion, expectedUserId, idempotencyKey, purpose:DIRECT_DELETE, protocolVersion:1, scopeDigest` 和三个literal true：`externalWritesStopped, permanentDeleteConfirmed, organizationImpactConfirmed`。DB额外接Session `userId`；返回 `{operation,created}`。created=true才在同事务创建maintenance job，payload为 `{operationId,executionVersion:operation.executionVersion,mode:'DIRECT_DELETE'}`，写回jobId；重放不能重复入队。 |
| `artworkDedupDirectDeleteRetryInputSchema` → `retryArtworkDedupDirectDelete` | 仅command五项（DB加Session userId），不接受itemIds/新路径/组/keeper。返回同上；reader必须IDLE/token=null，推进原operation执行版本及Claim，再按原范围入队。 |
| `requestArtworkDedupDirectDeleteStop` | 同command。返回operation；活跃job只设持久stop请求，**不要走通用queue取消**。旧job终态/暂停且reader已退出时返回jobId=null及新执行版本，App须同事务入队执行停止收口。首intent后保持STOPPED/保护；首intent前恢复可见性并release。 |
| `allowArtworkDedupDirectDeleteReimport` | 同command，加选中 `sources:[{sourceId,expectedGeneration:bigint}]`（App严格schema字符串转bigint）。仅本操作已完成COPY的TOMBSTONE，CAS并推进双向重叠generation；返回operation。旧PURGE占位必须替换。 |
| 查询/DTO | Sol补 `preparePurpose:DIRECT_DELETE, protocolVersion, scopeDigest` 及DRAINING/VERIFYING/DELETING/DELETED/STOPPED状态、可用动作、计数、脱敏错误。不返回绝对路径/原始hash/其他用户私有数据；源generation仍从实时来源读取。 |

内部Worker入口已在 `executeArtworkDedupMaintenance` 接独立gate；核心 `executeArtworkDedupDirectDelete` 导出用于合成内部测试，不能给外部路由直接绕gate调用。其依赖沿用原database/reader/supervisor；`onDirectDeleteBoundary`仅可信依赖注入，生产不接客户端输入。

## 已落盘行为与文件

- DB新增 `src/artwork-dedup-direct-delete.ts`；增量改 `artwork-dedup-review.ts`、`artwork-dedup-operation.ts`、`artwork-dedup-claims.ts` 和 `index.ts`。复用B1 Claim/reopen/drain，未重写写守卫。
- `schema.prisma`增加operation五个nullable字段：protocolVersion、scopeDigest、directDeleteConfirmedAt、freshVerifiedExecutionVersion、deleteStartedAt；operationArtwork增加nullable impactSignature。正式增量迁移015/016/017；旧记录保持NULL和旧语义。016冻结标题/标签/系列/海报和章节预览指针；不在终结时扩大物理文件删除范围。
- executor新增 `artwork-dedup/direct-delete.ts`、`direct-delete-verification.ts`，增量改maintenance-executor/files、reader/protocol/child。PREPARE原分页、归档封印、ownership继续复用，URL和手工独占目录补只读检查；Pixiv不扩大平铺父目录。
- FRESH用既有afterArtworkId/afterFileId持久游标，100行文件页，正常yield同执行版本续页；故障retry新执行版本重读keeper和原剩余范围。全部组fresh后才隐藏COPY（Artwork.deletedAt；archiveLifecycleState保持ACTIVE）并允许第一条意图。删除slice预算从fresh屏障后开始。
- 精确意图→当前fence重验→reader native身份检查/unlinkat/父dir fsync→回执；旧未决意图在当前fence下对齐。全部文件收据后才同事务业务删除、墓碑、释放Claim。来源release使用有界页，操作清单不一次载入JS。
- Worker native只增加 `checkedUnlinkAt`，文件为 `packages/pixishelf-worker/native/artwork-dedup-rename.c`；仅构建本次依赖addon。没有运行旧rename/no-replace探针、移动夹具或宣称旧移动基础通过复审。POSIX不是inode条件CAS，依赖既定外部持续停写前提，见文件执行契约。
- 测试新增 `direct-delete.postgres.test.ts`、`direct-delete-files.test.ts`；复用并扩展 `maintenance-executor-fixture.ts` 的新目的/四来源/多组/精确清理，补其旧归档夹具缺失的B1原来源证明。

## 实际验证

只用显式loopback `127.0.0.1:55432/dedup_executor_next`、fixture账号和临时合成目录，不读取App环境。PG套件目前23项；按新变化定向执行，不宣称最后一次全23同时运行。

| 证据 | 实际结果 |
| --- | --- |
| 四来源各自+MANUAL/URL混合、gate直调、INTENT/UNLINKED/RECEIPTED故障续行、全组最后成员变化零首删、keeper变化、开始后stop、generation CAS | 首轮11中9通过、2归档夹具缺旧proof失败；修夹具后2/2通过。追加用例后PG14/14加native4/4，共18/18通过。 |
| DB首intent事务回滚、hidden后零intent取消、queued旧执行停止并让writer槽、短slice、旧ISOLATION/PURGE拒绝、标题变化 | 扩展PG20首轮16通过；短slice被Vitest默认5秒超时，后续3项受活跃异步夹具影响；清理后确认operation/job/resource lease均0。短slice改30秒上限后仅失败4项复跑4/4通过。 |
| 分页来源释放、冻结后未知附件、目录重新核验后相关回归 | `-t 'unknown attachments\|tiny fresh\|rolls back\|sends old\|INTENT failure\|UNLINKED failure\|URL_ARCHIVE / URL_ARCHIVE\|LOCAL_DIRECTORY / LOCAL_DIRECTORY'`：8通过、13跳过。 |
| 持久intent后失lease零unlink、最终DB事务提交失败保留业务行/HOLD并续行、原未决intent对齐 | 最终 `-t 'losing the original\|final DB commit\|UNLINKED failure'`：3通过、20跳过。失lease测试只改变合成job租约，reader实际close后清理其合成排队资格，不是生产恢复方法。 |
| Native实际依赖 | 4/4通过：精确unlink/保留目录邻居/缺失重放、新占用及硬链接拒绝、祖先symlink拒绝、root marker变化拒绝。没有rename回退。 |
| 静态 | DB、job-contracts、executor三包最终typecheck均通过。新增核心/专项5文件oxlint为0warning/0error（随后仅测试泛型类型标注）；git diff --check通过，主应用大写路径0匹配。未跑全量build/test/lint或50万。 |

## 迁移与恢复依据

正式专库从111到114。原专库feature操作表/Artwork/job均0，Image有458条既存合成行，保留。升级前dump `/private/tmp/dedup-b2-before-112.dump`，SHA256 `e2873d6a26bdbaf905f20a51a3d134c79590ca1d79e23b11733fdfd8020c7142`。新 `dedup_b2_restore_20261024` 执行恢复；pg_restore唯一报告为客户端发出的server不支持 `SET transaction_timeout=0`，命令退出1；随后核对111迁移、Artwork0/Image458/job0一致。此为有兼容警告的限定恢复证据，不冒称生产完整演练。

首次015文本误截取旧FK，正式deploy失败；只读确认protocolVersion列不存在、旧contract仍在，整批原子回滚。修正尚未发布的015，正式 `migrate resolve --rolled-back` 后deploy成功；失败行保留审计，不删migration历史。随后016/017为独立正式增量，无db:push。

非空升级：在恢复专库111插入唯一 `b2-migration-legacy` 旧READY夹具，dump `/private/tmp/dedup-b2-nonempty-111.dump` 后正式升级到113，核对其READY/PREPARE/ISOLATION未变且全部新授权字段NULL。新空库 `dedup_b2_empty_20261024` 全链113迁移成功，日志 `/private/tmp/dedup-b2-empty-deploy.log`。017在执行器专库正式成功（另外两库保留113）；它只补SQL CHECK中NULL显式拒绝。另存 `/private/tmp/dedup-b2-before-113.dump`。这些库/dump保留供复核，不是用户业务备份。

## 核心交接时的Sol剩余与独立审查边界

此清单记录核心交接时的状态；普通接线和验证的最终收口见下方「Sol 普通接线与验证冻结」。独立审查仍未完成。

1. 完成上表App API/DTO/展示兼容和严格Session/expectedUserId/幂等；替换旧allowReimport占位、旧仅PREPARE retry/cancel。正式UI仍第三批；stage3不因此开放新PREPARE或DIRECT_DELETE。
2. 补剩余五对混合来源、动画全部物理原件/重复计数、未加载组selection及其接口投影、个人隐私、普通归档回收列表不展示ACTIVE+deletedAt副本。零intent取消后item状态投影需与operation CANCELLED一致（DB恢复deletedAt/Claim已验证）。
3. DD07文件边界补证见下节：真实unlink后fsync失败和父目录动作屏障已补。POSIX syscall之间同父目录内恶意换名仍不具备inode CAS保证；持续外部停写前提、gate关闭和独立审查要求不变。
4. DD02真实旧执行退出/HOLD原回执沿用B1已通过证据；B2新测试证明queued stop+让槽+后续drain，不声称重做了无generation/失lease孤儿活进程矩阵。DD11本批验证完成墓碑和CAS，实际重扫/迟到任务拒绝沿B1守卫，Sol补直接删除之后的整链路样本。
5. 独立Sol重点审scope摘要/impact范围、短slice fresh语义、当前fence对齐原intent、完成与release锁序、取消/终结原子性；不能根据通过数量开启gate。业务最终提交故障已实测，进程强杀与未确认reader退出阻断仍应结合已有supervisor/恢复证明审查。

没有自建App/Worker常驻进程。核心工具测试均有限任务；执行器最终类型检查已通过，最后退出/残留查询由交接消息补充。本记录不替代B2独立审查或整批结论。

## DD07限定补证与核心冻结

新增测试支持文件 `direct-delete-native-fixture.ts`，只在临时目录编译包含生产 `artwork-dedup-rename.c` 的 syscall 包装夹具；实际执行生产 `deleteMaintenanceFile` 和原 native 检查/unlink/fsync 主体。没有生产故障参数、客户端入口、通用故障框架或删除回退。

- **真实unlink后同步失败**：第一次父目录fsync真实成功，unlinkat真实删除冻结文件，第二次fsync返回EIO；生产文件函数传播EIO且无成功回执，实际lstat为ENOENT。确认旧测试reader退出后，以同一冻结身份和原意图缺失模式重放；即使已经缺失，第二次同步失败仍返回EIO而无回执，随后两次真实fsync成功才返回directoriesSynced。事件序列分别为`SF`、新reader的`SF`、续行后的`SFSS`。此处是文件原语故障证据，DB原意图持久/缺失对齐证据仍为前述PG专项，不冒称本次另跑了PG整链路。
- **父目录动作边界**：仅测试包装的unlinkat在生产fstatat已通过后，通过独立管道暂停。把合成原父目录改名保留在同一临时根内，并在原路径放新目录/文件或指向另一个临时根外目录的symlink，再恢复原syscall。两个样本都只删除原持有父fd中的冻结文件，保留原父目录、新占用内容和根外内容；实际事件为`SUS`。此为DIRECT_DELETE路径的调度屏障测试，未运行旧移动协议/旧rename探针。
- 限制不变：不具备同一父fd内fstatat与unlinkat之间的inode条件CAS，不抵御违反持续外部停写前提的恶意换名。目录fd固定证明不会经替换后的祖先重新解析到新路径，不能外推为无条件零竞态。

本次文件专项最终7/7通过（原4项加上述3项），executor typecheck通过；新增/修改两份测试文件oxlint为0warning/0error。此前DB与job-contracts最终typecheck也已通过。未改生产实现或迁移，未重跑PG、B1、全仓测试/build或50万样本。专库017剩余两库升级和普通App接线仍由Sol承接；独立gate继续关闭。所有测试子进程等待实际退出、临时夹具在测试清理中移除；没有常驻App/Worker。

文档检查：`pnpm docs:check`通过（253份Markdown），`git diff --check`通过。`pnpm docs:diagrams:check`受本机缺少Playwright `chromium_headless_shell-1194`可执行文件阻断；本次没有图源变化，未下载浏览器或扩大环境改动。最终7项文件测试及executor typecheck在最后测试输入清理后再次全部通过。

## Sol 普通接线与验证冻结

由 GPT-6.1 Sol / xhigh 完成普通实施与自测，**尚未经过独立审查，不表示第二批验收通过**。独立删除 gate 仍为真实常量 false、release stage 仍3；测试只在可信 fixture 模块 mock 启用分支，另有完全不 mock contracts 的关闭入口负例。未启动 App/Worker、未运行浏览器或第三批正式 UI，未恢复自动化80，未提交。

### 接口与文件

- `packages/pixishelf/server/routers/artwork-dedup.ts`、`services/artwork-dedup-review-service.ts`：新目的 PREPARE、directDelete、原范围 retry、持久 stop、墓碑 allowReimport。Session 传入实际 userId；expectedUserId、版本、scopeDigest、字面 true 和严格 schema 继续校验。DB 返回 created 后才在原事务入队并绑定；入队异常会回滚领域授权和命令。旧预览不能换目的重新签发。旧维护入口未开放。
- 新删除的 `cancelOperation` 仅调用领域停止请求，活跃任务保持原 PENDING/RUNNING 协议；旧任务终态且 reader IDLE 时在同事务创建停止收口任务。重试拒绝 itemIds 等扩围，沿原 executionVersion/Claim；相同规范命令重放不重复入队，Worker 后续离线也能重放既有意图。
- `packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts`：新增维护任务 v2、严格 v1/v2 parser、协议/scopeDigest、STOP、新状态及完成/剩余计数。原展示字段保留。`artwork-dedup/maintenance-executor.ts` 仅改 factory 版本/parser 与 v1 PREPARE→新目的拒绝；未改删除、reader/native 主体。
- `packages/pixishelf-worker/src/create-worker-executor-registry.ts`、`production-capabilities.ts`、`capability-audit.ts`：同 supervisor 注册维护 v1/v2；inventory 为39种任务/48个版本。App 领域创建前核对 READY、90秒 heartbeat 和 BACKGROUND_WRITER 维护 v2；旧 Worker 的实际领取被已有 queue capability definitionVersions 过滤。
- 查询按冻结作品标题/来源/创建时间回退，副本业务删除后仍可展示；来源 generation 从实时表读取，只返回 basename 文件名和脱敏失败信息。其他账户仅有资格布尔值，无私有评分/阅读/标记明细。零意图取消的 COPY 投影为 CANCELLED。`services/archive/archive-trash-service.ts` 最小排除 ACTIVE，避免隐藏 COPY 进入普通回收。
- 正式 UI 只补 `duplicate-operation-state.ts` 新状态标签/活动判断及旧测试 DTO 夹具必需字段，未接新按钮、确认流程或页面改版。新测试位于 App `services/__tests__/artwork-dedup-direct-delete*.test.ts`、`artwork-dedup-reimport-fixture.ts`，DB `src/__tests__/artwork-dedup-maintenance-v2.postgres.test.ts`；增量扩展 contracts/Worker 注册测试与 executor 原 direct-delete 测试/合成夹具。

### 实际定向证据

连接只使用127.0.0.1:55432的已授权 dedup_* 合成专库，媒体仅系统临时目录。下表各行按代码变化分别运行；没有将跳过计为通过，也没有声称最后一次完整重跑所有核心测试。

| 实际命令（连接以库名占位） | 结果与证明范围 |
| --- | --- |
| `pnpm --filter @pixishelf/job-contracts exec vitest run src/__tests__/artwork-dedup-maintenance.test.ts --reporter=dot` | 3/3：严格版本隔离、直接删除确认三项 literal true、禁止重试扩围、真实 gate=false/stage3。 |
| `pnpm --filter @pixishelf/worker exec vitest run src/__tests__/executor-registry.test.ts src/__tests__/capability-audit.test.ts --reporter=dot` | 16/16：v1不能resolve v2、各版本严格parser、共享supervisor、39/48完整能力清单及审计。实际 queue 领取隔离见App PG样本。 |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/direct-delete.postgres.test.ts -t 'MANUAL_CREATE / LOCAL_DIRECTORY\|MANUAL_CREATE / PIXIV_SCAN\|LOCAL_DIRECTORY / PIXIV_SCAN\|LOCAL_DIRECTORY / URL_ARCHIVE\|PIXIV_SCAN / URL_ARCHIVE\|registered animation\|duplicate occurrence' --reporter=dot` | 7通过、23跳过：剩余五对混合来源，加登记 APNG/MP4/WebP 三个物理原件全部准备/删除/回执；额外登记同字节重复项使真实新检测无重复组。动画样本验证登记文件/字节集合，不验证媒体解码。MANUAL/URL及四来源同种样本沿核心既有证据。 |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-direct-delete-disabled.test.ts services/__tests__/artwork-dedup-direct-delete.postgres.test.ts --no-file-parallelism --reporter=dot` | 真实关闭入口2/2：新PREPARE/directDelete/allowReimport在零事务前拒绝；匿名拒绝，false确认在transport拒绝。contracts没有启用mock；该次enabled分支失败另行修正并定向复跑，不能把命令整体记为通过。 |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-direct-delete.postgres.test.ts -t 'retains executable\|freezes unloaded' --reporter=dot` | 最终2通过、1跳过：v1旧ISOLATION仍实际READY；v1 PREPARE指向DIRECT_DELETE目的拒绝且零回执；旧READY授权拒绝；实际v1领取不到新v2；跨页ALL_RECOMMENDED冻结未加载两组及排除组精确范围；账户切换/过期版本/异输入幂等拒绝；重复确认仅一个任务；入队故障整事务回滚；无意图取消与部分失败stop/retry；COPY reader隐藏/KEEPER可读；完成/剩余收据计数、删除后快照、实时generation。 |
| 同一App文件先前完整3项，其中 `excludes hidden ACTIVE`；另运行 `services/__tests__/artwork-dedup-review-service.postgres.test.ts -t 'direct-delete App\|current account private'` | 普通回收正例1/1：TRASHING/TRASHED仍可见，ACTIVE+deletedAt隐藏。当前账户隐私1/1；旧cursor等3项未重跑。该次2文件合计4通过、3跳过；最终新增幂等/零意图断言仅复跑上一行2项。 |
| App的 `artwork-dedup-reimport-fixture.ts`，由上述实际API链路调用 | 删除前冻结旧SCAN任务/目录证明；删除后的实际Local rescan及扫描publisher事务因墓碑拒绝。allowReimport解除选中副本所有墓碑、推进重叠代次后，旧publisher证明仍拒绝；显式新文件和新持久输入捕获新证明后，实际scan publisher事务创建新Artwork。没有恢复已删文件；新发布样本覆盖生产发布事务，未另跑全量目录发现/解码器或B1并发矩阵。 |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_b2_empty_20261024 或 dedup_b2_restore_20261024> pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-maintenance-v2.postgres.test.ts --reporter=dot` | 两库各26/26，共52项：v1/SCAN兼容，新v2两种合法payload；错误版本/优先级/trigger/deadline拒绝；缺字段、JSON null、错误类型、旧purpose/协议/额外路径拒绝；先前sentinel写入同事务回滚；新DIRECT_DELETE目的缺协议、旧scope/旧purpose冒充、无确认执行拒绝。 |

App首轮真实入队发现原 `system_jobs_dedup_policy` 只允许v1并报23514，原事务零写；新增018后才通过，未放松parser或伪造capability。补离线幂等时曾误选无id字段的ArtworkDedupCommand，定向测试和tsc均明确失败；改为operationId投影后，上述两项最终通过。初次新测试类型的optional callback/数组索引问题已修正。未通过项没有当作成功数字。

### 迁移与恢复限定

两迁移库原113各在备份后正式 `db:deploy` 017→114，随后为维护v2新增 **018**；执行器专库114→115。三库最终已完成迁移均115，执行器专库无未解决失败迁移；原015 rolled-back审计行保留。没有db:push、删库、清空数据库或从头重复全链迁移。

018仅替换既有单个队列CHECK的维护v2分支，完整保留SCAN/v1的调度限制，不查跨表。v2精确字段/类型和NULL显式失败，独立删除协议仍1；这个差异应由独立审查重点核对。空库链路与非空旧schema在前述历史证据已完成，本轮只正式增量；两库三个相关CHECK均convalidated=true。非空库唯一旧 `b2-migration-legacy` 仍READY/PREPARE/ISOLATION，protocolVersion/scopeDigest/directDeleteConfirmedAt/freshVerifiedExecutionVersion/deleteStartedAt全部NULL，未获新授权。

本轮增量检查点（合成库，文件权限受限）：

| 文件 | SHA-256 |
| --- | --- |
| `/private/tmp/dedup-b2-empty-before-114.dump` | `8d1b66872ae13abb5fc26200bf9019e2e1163d6ff92017748165e68eab0307b1` |
| `/private/tmp/dedup-b2-restore-before-114.dump` | `a5d170087daf4a130fcdcfe0c2bb45d229da453dddb7385ca3a6fa011a3f455f` |
| `/private/tmp/dedup-b2-executor-before-115.dump` | `d43048c95ee05a7510d94d89e93027dd31d69c6a7cbf412e2f53a28ba5f3fed4` |

本轮没有另做恢复覆盖；前述111恢复的 `SET transaction_timeout=0` 兼容警告仍有效。这些仅是合成专库恢复依据，不能称为生产备份、媒体同点快照或生产完整恢复演练。

### 冻结与未覆盖

最终受影响DB/contracts/executor/Worker/App类型、20文件定向lint、文档/路径/diff检查结果由末尾验证节登记。普通查询query-builder/index/dao/reader/related及reading/mark/rating现有deletedAt守卫沿用，未为无改动路径重复造相同测试。B1实际drain、锁序和发布并发证据沿其已通过记录，B2核心23项与native7项沿上文分批证据，未重跑整套。

没有全量lint/test/build、50万性能或最终浏览器；这些属于批准的第三批。POSIX持续外部停写前提和同父fd内无inode条件CAS限制不变。独立Sol审查须核对新App/Worker适配、018和核心已列边界；本实施者自测不替代独立审查，gate不能因此打开。

### 最终检查与夹具卫生

- `pnpm --filter @pixishelf/db typecheck`、`pnpm --filter @pixishelf/job-contracts typecheck`、`pnpm --filter @pixishelf/job-executors typecheck`、`pnpm --filter @pixishelf/worker typecheck`、`pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false` 分别最终通过，包含新增测试。App没有运行Next typegen/build；本轮未改页面路由形状。
- `pnpm exec oxlint` 对本节列出的App/contract/factory/Worker/测试文件定向执行：原19文件0 warning/0 error；追加原review测试afterAll清理后该文件独立0/0，共20文件。只作现有多行if/for的无行为花括号修正及删除旧夹具未使用import，没有放松规则。
- `pnpm docs:check`通过253份Markdown；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`使用已有Chrome和正常提升权限，通过33图源、23嵌入Mermaid。未改图源、未安装浏览器。`rg --files packages/pixishelf | rg '[A-Z]'`为0匹配；`git diff --check`通过。
- 最后只读核对：三合成库115完成迁移，相关三个CHECK validated；执行器库operation/Claim/job/resource lease/worker均0，reader/test/tsc进程0。没有自建App/Worker常驻进程。
- 复用的maintenance fixture原afterAll只删除Artwork，Image可空FK将其置NULL，普通review隐私夹具也有同样问题。此次按跟踪artworkIds在删除作品前显式删除Image，分别修改 `maintenance-executor-fixture.ts` 和 `artwork-dedup-review-service.postgres.test.ts`；这是测试清理修正，未重跑已过领域套件。
- 清理前执行器专库648条Image。逐项核对本轮06:39:35–06:48:05 UTC产生的78条孤立Image，路径为本轮UUID目录下0000/0001.bin、animation.apng/mp4/webp、duplicate.apng或唯一 `dedup-api-review-3165b195-a470-42b4-abe3-1c612195e0b6/secret.jpg`。将精确ID/路径/时间保存到 `/private/tmp/dedup-b2-sol-image-cleanup-20261024.csv`；事务内锁定明确78个ID，复查总数、artworkId=NULL、时间和路径白名单后只删这些ID。清理后570条，目标ID剩余0；开工前570条合成Image完整保留（上文458是更早核心升级时的历史数，未据此清理既存孤儿）。未清库或扩大为时间范围删除。

本轮普通实施到此冻结，交独立Sol review；本文的“通过”仅指列明自测。没有将独立审查、第三批UI/最终浏览器或生产恢复演练记作完成。

## P2-01 控制收据差异修复

根据[第二批独立审查](./artwork-deduplication-direct-delete-batch2-review-2026-10-24.md)的P2-01，由原实施Sol/xhigh只修复此控制分支，**待原reviewer差异复审，未自行宣称通过**。独立gate仍false、stage3，未启动第三批、未提交。

| 文件/接口 | 最小修复 |
| --- | --- |
| `packages/pixishelf/services/artwork-dedup-review-service.ts` 的 `controlArtworkDedupPrepare` | Session/expectedUserId、独立gate及新目的严格输入/归属校验后，按既有actor→command顺序读取持久收据，先核对原action、operationId、expectedVersion及规范摘要，再分派真正的新命令。原PREPARE的RETRY_OPERATION/CANCEL_OPERATION收据不因当前mode推进到DIRECT_DELETE而被解释为另一动作；新删除自身的RETRY_DIRECT_DELETE/STOP_DIRECT_DELETE收据仍按原DB规范输入（含Session userId）验证。成功重放返回操作当前job/投影，不检查新Worker能力、不入队、不更新执行版本；同键异输入或异action拒绝。新命令原有Worker、版本、状态、reader及范围约束保留。 |
| `packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts` 的 `isArtworkDedupPrepareRetryable` | 专项准备时发现原helper硬限定ISOLATION，使新目的首次retry也不可达。经主任务明确扩展所有权，helper增加显式DIRECT_DELETE分支：operation协议1、维护job定义2、payload目的DIRECT_DELETE及协议1；旧ISOLATION仍走v1。两者复用原模式、reader/token、job归属/执行版本、lease和FAILED/PAUSED条件，不将新目的伪装为旧目的。没有改锁/reader恢复主体，仅为定向lint给原三处多行if补无行为花括号。 |
| `packages/pixishelf/services/__tests__/artwork-dedup-direct-delete.postgres.test.ts` | 仅新增一个聚焦用例，同时覆盖要求的离线及跨阶段两种重放；通过真实API创建新目的PREPARE，经真实queue fail和API retry生成收据，没有直接伪造命令。 |

精确命令：

```bash
QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-direct-delete.postgres.test.ts -t 'replays a PREPARE retry receipt offline and after DIRECT_DELETE' --reporter=dot
pnpm --filter @pixishelf/db typecheck
pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false
pnpm exec oxlint packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts packages/pixishelf/services/artwork-dedup-review-service.ts packages/pixishelf/services/__tests__/artwork-dedup-direct-delete.postgres.test.ts
git diff --check
```

专项 **1通过、3跳过**（用例2.46秒，总4.92秒）；DB/App类型均通过，三文件lint为0 warning/0 error，diff检查通过。没有重跑原B2矩阵、B1、native、全量检查或图示；本次最终文档检查由主任务统一执行。

该用例实际证明：旧ISOLATION/v1仍可重试；新目的/v2失败后入口与可用动作均能重试，缺operation协议、v1任务、缺payload目的/协议或readerToken未清均不可重试。首次成功retry后job/command为2/1；Worker离线重放保持原job、operation/execution版本和2/1计数；同键改版本冲突，新键仍被离线能力拦截，恢复Worker后旧版本的新键仍冲突。随后实际PREPARE完成READY并经API确认进入DIRECT_DELETE，job/command为3/2；再次离线以原PREPARE retry键重放返回当前DIRECT_DELETE job/版本，计数及执行版本不变；异输入和将原retry键改作cancel仍冲突。此次没有执行DIRECT_DELETE文件删除。

环境仍仅127.0.0.1:55432的 `dedup_executor_next` 与夹具自建临时根；开始时Image570、operation/job/resource lease均0。最终夹具与进程清理由下方核对结果登记，不清理既存合成数据。

最终只读核对：Image仍570；operation、command、Claim、job、resource lease、worker均0；当前worktree的vitest/tsc/reader子进程0。夹具按自有run/job/artwork IDs清理，未删除既存Image或触及真实库/媒体。修复再次冻结，交原reviewer只做差异复审。

## 最终收口与恢复入口

- 独立 GPT-6.1 Sol / xhigh 审查仅发现 P2-01；原实施 Sol 修复并补真实 API 专项后，由原 reviewer 限定差异复审确认关闭，未发现新的 P1/P2，B2 门槛通过。复杂核心由 Astra/high 实施；本轮只按已登记变化运行专项、相关类型及定向 lint，没有重复全量构建或规模验证。
- 本批完成四来源及六种混合来源的直接删除后端、正式015–018迁移、精确文件清单/持久意图/回执、原范围失败续行、停止、来源墓碑、新导入意图以及 App/Worker v2 接线。专项证据按前文范围分别有效，不合并宣称完成最终产品验收。
- 保存位置为独立 worktree `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 加既存未提交改动；没有提交、暂存、重置或合并。主目录的其他开发改动原样保留，未操作真实数据库/媒体或用户服务。
- 所有本批实施及审查 agent 已结束，无自建 App/Worker 或测试子进程残留；合成库测试夹具已按所属ID清理，既存570条Image保留。自动化80未恢复，保持暂停。本任务按用户要求在这里暂停，不启动下一批。
- 下次用户主动继续时，只进入第三批：正式结果/删除记录页面、一次确认及停写声明、停止/失败/原范围重试反馈；然后进行最终一次全量检查与 GPT-6.1 Sol / medium 浏览器验收，记录真机仍需确认的操作。沿用本批证据，不从旧隔离/恢复方案或前两批重新开始。
- 开放条件尚未达成：`ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=false`、release stage3 保持；不把已实现后端等同可供真实图库立即删除。POSIX同父目录内无inode条件CAS、持续外部停写前提及合成恢复证据限制仍按文件执行契约有效。

最终收口检查：`pnpm docs:check`通过254份Markdown；`git diff --check`通过；主应用大写路径为0匹配。图源本次未变，沿用已通过的33图源/23嵌入检查，不重复渲染。
