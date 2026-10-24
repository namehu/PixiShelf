---
status: record
scope: 直接删除第一批实施、修复、补证及独立审查通过后的暂停交接
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/direct-delete.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/design/artwork-deduplication/app-write-guards.md
  - docs/design/artwork-deduplication/archive-source-proofs.md
---

# 第一批必要写保护实施交接

状态：**B1 已通过独立 Sol 审查；R1–R4 与 E1–E7 均关闭。本批收口暂停，等待用户明确继续 B2。**工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，基线 `6e8d4f4c` 加原有多人 WIP。本轮未提交、未重置他人修改；未修改 schema/migration、删除授权或 native 文件实现。独立 DIRECT_DELETE 能力保持未开放，release stage 3 不变，自动化80不恢复。无真实媒体/业务库操作，未启动 App/Worker、未碰5430。

## 本轮完成的复杂改动

- scan、Audit Apply、Local import、Local rescan 在最终发布事务首次根锁前取既有 creator catalog。Image计数触发器同样 UPDATE Artwork；App媒体登记、普通删除 begin/publication、单作品 metadata-only UPDATE、评分和用户删除评分级联的外层锁前缀已补。不是在取得根后才给 publisher 补锁。
- App媒体旧 WIP 接续：真实 Claim 下注册/重建/章节/手工存储零写拒绝；首个章节路径 begin 同事务声明关联 Image，原token缺声明不补造；章节仅提交 videoPath 时也按既有 artwork.images 解析关联 Image。原COMPLETED单图publication分支仍只读返回，但该分支真实PG尚待补。
- `reopenArtworkDedupSources` 按已有根协调与identityKey锁序，选中sourceId+generation+owner CAS，原子推进双向重叠代次，只打开指定owner的选中来源；没有新祖先版本体系。内部原语不删除Claim、不自行取消/终结、不开放App。第二批调用者必须在同一原operation/version/fence事务先验证生命周期/真实退出/文件回执；部分失败不得调用。
- `inspectArtworkDedupArchiveDrain` 聚合原操作PROVIDER绑定的所有Import、历史execution、全部token、job attempt与内容声明。未登记尝试、任何无drainedAt token、活动job或未结束写声明都阻断。FAILED、过期租约和CANCELLING不等于退出。只读原语返回待停止job ID；发送既有控制命令、等待让槽和最终CAS属于第二批接入责任，未声称完整删除流程已跑。
- 归档旧WIP原proof/token/fence链按暂停记录专项复验；新增curly定向修复。App原发布retry先核验原proof，不刷新旧意图；仅已知executor STATE_CONFLICT映射回既有App ArchiveError。
- 普通归档维护请求加入catalog及Claim/URL hold；reconcile跳过hold；trash/restore/purge的实际声明begin在catalog下检查持久hold，最终publication先catalog/归档协调再根。staging cleanup新增精确目录写声明，声明前验证generation路径/真实drain，最终同事务释放；未登记LEGACY及未drain执行拒绝在线清理。这些新维护接点尚未完成专项PG，不能以旧归档25项替代。
- 共享creator来源关系、人工关系及映射移动增加同事务Claim守卫；artist修改/采用来源姓名、全局tag修改/删除按升序受影响Artwork检查。需要Sol补真实PG及检查剩余入口。

## 本轮精确生产文件

以下是本轮改动范围；标“旧WIP”者包含本轮之前的差异，不可将整个HEAD diff当本轮新增。

| 范围          | 文件（仓库相对路径）                                                                                                                                                                          | 本轮增量                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| DB            | `packages/pixishelf-db/src/artwork-dedup-source-release.ts`、`artwork-dedup-archive-drain.ts`                                                                                                 | 新内部原语                                            |
| DB            | `packages/pixishelf-db/src/index.ts`、`artwork-dedup-claims.ts`（旧WIP）                                                                                                                      | 导出；普通归档provider hold只读检查                   |
| DB            | `packages/pixishelf-db/src/creators.ts`、`artwork-dedup-user-delete.ts`（后者旧WIP）                                                                                                          | creator最终写守卫；用户删除catalog前缀                |
| Scan旧WIP     | `packages/pixishelf-job-executors/src/scan/scan-executor.ts`、`audit-apply-executor.ts`、`local-executor.ts`、`local-rescan.ts`                                                               | 最外层最终事务catalog前置                             |
| Archive新接线 | `packages/pixishelf-job-executors/src/archive/maintenance-executor.ts`                                                                                                                        | URL hold、catalog前缀、staging声明及drain拒绝         |
| Archive旧WIP  | `packages/pixishelf-job-executors/src/archive/dedup-source-snapshot.ts`、`download-generation.ts`、`executor.ts`、`resolver-executor.ts`、`intake-enqueue.ts`、`media-content-publication.ts` | 定向curly修复；证明链复验，未重构主体                 |
| App媒体旧WIP  | `packages/pixishelf/services/artwork-service/image-manager.ts`、`content-source-guard.ts`、`media-chapter-upload.ts`、`index.ts`                                                              | catalog前缀、path-only章节关联Image；保留既有守卫     |
| App删除       | `packages/pixishelf/services/artwork-service/deletion-content-guard.ts`                                                                                                                       | begin首次根之前catalog；最终由publishContentOwner前置 |
| App其他       | `packages/pixishelf/services/artwork-rating-service.ts`（旧WIP）、`artist-service.ts`、`tag-service.ts`                                                                                       | 评分catalog；artist/tag受影响Artwork守卫              |
| App归档       | `packages/pixishelf/services/archive/archive-publication-retry.ts`、`archive-module.ts`、`archive-task-service.ts`、`archive-maintenance-service.ts`                                          | 原proof retry/错误映射；catalog及维护hold             |

`manual-storage.ts`本轮未另改生产实现，只在真实PG中验证原WIP。未改已有source-groups、App输入证明主实现；不要求重审阶段1/2或其规模证据。

## 实际验证

仅使用已授权loopback 55432合成库：executor=`dedup_executor_next`、DB=`dedup_data_next`、App=`dedup_app_inputs112`（schema111）。连接用户dedup及fixture密码沿暂停记录，不加载应用环境。没有db:push或迁移。仅当前夹具ID/prefix及临时目录清理；没有重置/删除测试库。

| 实际命令（在工作树运行）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 结果与范围                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_data_next> pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-source-release.postgres.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                                                                                                                                      | 最终2/2通过；祖先/后代/段边界/其他owner保留；真实双事务release持根至提交，capture的lock_timeout=55P03，提交后只取得新代次                                                                                  |
| 同库 `... vitest run src/__tests__/artwork-dedup-archive-drain.postgres.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 最终1/1通过；所有attempt/token、旧FAILED未登记、sealed已drain、无drain、过期CANCELLING；事务回滚                                                                                                           |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/job-executors exec vitest run src/scan/__tests__/scan.postgres.test.ts -t 'discovery proof capture\|keeps frozen proof\|unchanged discovery page\|original LOCAL_DIRECTORY\|applies frozen NEW evidence\|applies CHANGED evidence\|marks newly published Pixiv\|builds a trusted baseline' --reporter=dot`                                                                                                                                                                                      | 最终13通过、56跳过。真实竞争连接持catalog再取同根；实际生产首次catalog处未持根。屏障针对Pixiv新建、Local OPEN、Audit NEW/CHANGED；Local rescan及独立评分屏障未测。HOLD注入owner/回读/成功旗标/确切code保留 |
| 同executor库 `... vitest run src/archive/__tests__/dedup-source-snapshot.test.ts src/archive/__tests__/download-lane.postgres.test.ts src/archive/__tests__/download-lane-recovery.postgres.test.ts src/archive/__tests__/resolver-executor.postgres.test.ts -t 'original source\|original resolver\|original drain\|original fenced\|source generation changes at final\|handoff and replay\|reuses checked completed\|recovers a rename-before-commit\|does not drain or allow same-generation\|atomically commits READY\|commits AUTO NEW\|source snapshot' --reporter=dot` | 4文件25通过、39跳过；含pure8及原PG17。最后仅curly格式修复；不覆盖本轮maintenance-executor新接线                                                                                                            |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_app_inputs112> pnpm --filter @pixishelf/next exec vitest run services/artwork-service/__tests__/artwork-dedup-media.postgres.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                                                                                                                    | 最终3/3通过；keeper/copy注册/重建/章节/手工路径零写；first relatedImage声明、旧token不补造、晚Claim最终关联拒绝、begin拒绝回滚、无Claim章节正常                                                            |
| `pnpm --filter @pixishelf/next exec vitest run services/artwork-service/__tests__/manual-storage.test.ts services/artwork-service/__tests__/image-manager-replace.test.ts services/artwork-service/__tests__/media-chapter-upload.test.ts services/artwork-service/__tests__/image-manager.test.ts services/__tests__/artwork-rating-service.test.ts --reporter=dot`                                                                                                                                                                                                           | 5文件43/43通过；仅为旧行为回归，不替代PG                                                                                                                                                                   |
| `pnpm --filter @pixishelf/db typecheck`；`pnpm --filter @pixishelf/job-executors typecheck`；`pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false`                                                                                                                                                                                                                                                                                                                                                                                                             | 最终三项通过；最后App retry增加已导出类型的错误映射后尚未再跑App类型，Sol收尾复验                                                                                                                          |
| `git diff --check`；`rg --files packages/pixishelf \| rg '[A-Z]'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | diff通过；大小写扫描无匹配（退出1表示零匹配）                                                                                                                                                              |

首次App PG的2个夹具问题是导出名写错及Claim在内容原语被映射为WRITING，未修改生产拒绝规则；cleanup因遗漏writeStartedAt成对清空违反约束。该次唯一prefix `dedup-review-b29600d8-2a35-4ff8-b18c-963f4967eeba`、其两个新目录行及临时目录已经精确清理。修正夹具后3项通过且cleanup完成。drain首次夹具错误给FAILED保留leaseExpiresAt，按正式lease约束更正后通过；没有放松约束。扫描首轮基线用例本来只SKIP无发布，误要求catalog屏障；该用例保留普通回归，屏障断言只限定真正发布用例，最终13项通过。

## Sol收尾与独立审查必须保留的缺口

1. **普通URL维护新增逻辑尚未专项验收**：App请求/重试、reconcile、已排队trash/restore/purge、staging cleanup的hold早到/晚到、实际声明反向阻止claim、成功释放与失败保留。旧maintenance“LEGACY无generation也能cleanup”正例必须改为明确拒绝，并新增有真实drained generation正常清理正例；不能只删测试或补造生产旧回执。清理声明需要真实故障续行审查。
2. **App媒体剩余PG**：READY receipt迟到登记、COMPLETED纯读重放、真正claim获取与首次章节begin的双向竞争；当前晚Claim夹具直接持久化Claim仅验证最终守卫，并非证明认领协议允许越过活动token。path-only章节分支已修但只有旧单测，需覆盖真实Image映射。
3. **artist/tag/creator剩余验证**：新增守卫的真实零写与无Claim正常、全范围排序；核对Series命令分支、artist merge、metadata-only delete、Pixiv source sync、migration等必要入口。`creator-maintenance`的SERIES直接写和其他系列入口本轮未接；不要声称全入口已完成。共享creators函数加入Claim guard可能影响原mock fixture，需定向修依赖夹具并运行。
4. **锁序剩余**：Local rescan真实屏障、评分/User级联真实竞争未补；扫描直接publisher调用不是本轮屏障入口。继续追踪触发器，不能仅查显式helper。App archive错误传输/同一proof retry需专门PG。
5. **lint**：定向curly已修归档新WIP；新drain格式化带来的curly已补。仍有既有`creators.ts` multiline curly及syncSourceCreators max-params；归档executor max-lines（约1318）与handleArchiveExecutionFailure max-params、resolver finalizeResolutionError/moveToRetryTail max-params、publisher publishArchiveImportInTransaction max-params。未进行无关拆分。最终精确lint报告保存在 `/private/tmp/dedup-b1-lint-final.txt`，其后只修了new drain单项。应由Sol必要格式/类型收尾，不以该文件代替最新命令结果。
6. **B2接入责任**：release原语只做状态CAS/代次；取消失败后完整释放、DIRECT_DELETE终结和allowReimport必须由未来生命周期在同一fence/version事务验证退出及回执后调用。drain聚合只读，不发送停止、不安排等待或开放文件动作。尚无全来源真实删除或完整取消/失败文件流程证据。

未运行全量build/test/lint、50万性能、native复审、正式迁移、生产/浏览器验证、docs/diagrams检查；按本批额度要求留给既定收尾/最终批次。独立审查前应以本记录的精确范围和暂停WIP为起点，避免重做已关闭批次。所有本线测试、类型进程已退出；未留自建App/Worker/后台服务。

## Sol 普通实施收尾（2026-10-24，尚非独立审查）

状态：**普通收尾已冻结，B1 仍被 CLEAN_STAGING 故障续行阻断，不能标记整批通过**。本节是实施者证据，不是独立 Sol 审查。工作树、分支、HEAD 和原 WIP 继承本记录首屏；未提交、未启动 App/Worker、未恢复自动化80。真正 DIRECT_DELETE 与旧 stage 3 门禁均未改。没有修改 native 文件、schema 或 migration；没有 B2 删除调用、取消释放或 drain 等待让槽接入。

### 普通收尾增量与文件状态

沿已有 catalog→root/source→Artwork 顺序补最小接点，没有新增锁或工作流：

- `packages/pixishelf/services/series-management-service.ts`、`series-service.ts`：系列成员/排序以及系列元数据修改、级联删除均在原事务先 catalog，再对现有成员与候选 Artwork ID 升序核对 Claim；这些字段会改变冻结的系列整理影响。
- `packages/pixishelf-db/src/artist-merge.ts`：实际 merge 前对 source/target 的普通 artistId 和 creator 关系涉及的全部 Artwork 升序检查。没有改变 merge 计划或权限。
- `packages/pixishelf-job-executors/src/maintenance/creator-maintenance.ts`：真正 SERIES apply 分支补 Claim，不能只在排队或预览检查。
- `packages/pixishelf-job-executors/src/pixiv-artwork/executors.ts`、`series-sync.ts`、`pixiv-series/executors.ts`：最终来源发布在原 Artwork/ref 锁前取 catalog，检查本作品及可能被共享 Series 标题更新影响的成员。保留原缺失作品的 skip 语义；控制/失败回执不要求 OPEN。此处只守卫已存在作品的来源元数据，不伪造新来源证明。
- `packages/pixishelf-job-executors/src/migration/prisma-database.ts`：目录 begin、finish、cancel finish、最终 publication 的最外层事务补 catalog 前缀；local/manual 的 storageKey/目录映射分配前核对 Claim。未改文件搬运或恢复协议。
- `packages/pixishelf/services/archive/archive-maintenance-service.ts`：将已知 ARTWORK_CLAIMED/URL_HELD/SOURCE_HELD 映射为既有 App ArchiveError STATE_CONFLICT；未知异常原样抛出。原 `archive-publication-retry.ts` 的最后错误映射已通过专门 PG 和类型复验，Sol 未改其生产逻辑。
- 只做必要格式/curly 收尾的旧 WIP：`packages/pixishelf-db/src/creators.ts`、`packages/pixishelf/services/artist-service.ts`、`tag-service.ts`、`packages/pixishelf-job-executors/src/archive/maintenance-executor.ts`。`artwork-dedup-archive-drain.ts`/`artwork-dedup-source-release.ts` 参加检查，没有改变其算法。
- 设计仅在 `docs/design/artwork-deduplication/app-write-guards.md` 增补上述必要入口；未重写总设计或生成图。

新增测试文件：

- `packages/pixishelf/services/__tests__/artwork-dedup-shared-writes.postgres.test.ts`
- `packages/pixishelf/services/archive/__tests__/archive-dedup-guards.postgres.test.ts`
- `packages/pixishelf-job-executors/src/pixiv-artwork/__tests__/dedup-shared-series.postgres.test.ts`

修改现有测试：App `artwork-service/__tests__/artwork-dedup-media.postgres.test.ts`；`services/__tests__/{series-service,series-management-service,artist-service,tag-service}.test.ts`；Executor `archive/__tests__/maintenance-executor.postgres.test.ts`、`migration/__tests__/prisma-database.test.ts`、`pixiv-artwork/__tests__/executors.test.ts`、`pixiv-series/__tests__/{executors,artwork-executor-fetch}.test.ts`。旧单测仅补新事务/受影响查询/guard 依赖，真实 Claim 拒绝由新 PG 验证；没有删除业务断言或用 mock 代替 PG 证据。

所有文件仍为未提交工作树内容；新增文件 untracked、原文件 unstaged。精确检查清单在 `/private/tmp/dedup-b1-sol-files.txt`，共29个代码/测试文件，不是整份 HEAD diff 的归属声明。

### 实际检查

数据库继续只用首屏授权的三个 55432 合成库；没有迁移、db:push 或加载应用环境。PG 夹具只清自己的随机 ID/prefix 或事务回滚。App 媒体本次仅运行新增 READY/COMPLETED 两项，没有重跑旧三个用例或旧 fixture 的全根 identity 临时改写。

| 实际命令（工作树根；URL 只代指上述专库）                                                                                                                                                                                                                                                                                     | 结果与准确范围                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_app_inputs112> pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-shared-writes.postgres.test.ts --reporter=dot`                                                                                                                                          | 最终2/2；artist/tag/series 全集合中后一个成员有 Claim 时零写拒绝，解除后原功能；creator 手工/来源证据/remap 拒绝后原功能；实际 artist merge 在 Claim 下拒绝。Claim 为夹具直接持久化，不是认领协议测试。                                                                                                                                                                       |
| 同 App 库 `... vitest run services/artwork-service/__tests__/artwork-dedup-media.postgres.test.ts -t 'READY\|COMPLETED' --reporter=dot`                                                                                                                                                                                      | 2通过、3跳过；真实 READY 回执迟到登记拒绝且回执/Image 零写，真实成功 publication 后 COMPLETED 在 Claim 下纯读重放，原回执/Artwork 不变。                                                                                                                                                                                                                                      |
| 同 App 库 `... vitest run services/archive/__tests__/archive-dedup-guards.postgres.test.ts --reporter=dot`                                                                                                                                                                                                                   | 7/7；HOLD/TOMBSTONE/代次变化/null 原 proof 均映射 App STATE_CONFLICT 且原意图/声明不变；有效原 proof 重排同 job 而原 token 不变；staging 请求源 HOLD 零写；无活 Claim 的持久 URL hold 拒绝 trash/restore/purge 请求。                                                                                                                                                         |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/job-executors exec vitest run src/pixiv-artwork/__tests__/dedup-shared-series.postgres.test.ts src/archive/__tests__/maintenance-executor.postgres.test.ts -t 'LEGACY\|CLEAN_STAGING\|necessary source' --reporter=dot`                       | 最终8通过、9跳过。source/series/migration 3项为真实事务回滚：其他系列成员 Claim、storageKey 零写和无 Claim 正常、真正 creator SERIES apply 在预览后再检查。staging 5项：LEGACY 缺 generation 明确拒绝、undrained 零文件/声明写、早 HOLD 零文件/声明写、真实 drained 成功释放、晚 HOLD 保留原意图/未 cleaned generation/ACTIVE 声明，并准确复现 offline 恢复域 snapshot 拒绝。 |
| 同 Executor 库 `... vitest run src/archive/__tests__/maintenance-executor.postgres.test.ts -t 'queued .* persistent URL hold\|fenced trash and restore\|permanently purges due' --reporter=dot`                                                                                                                              | 5通过、12跳过；3个参数化用例各执行早/晚两种持久 URL hold（共6个动作），无活 Claim 的早 hold 在文件动作前拒绝，晚 hold 在最终事务拒绝并保留 ACTIVE 声明；另2项覆盖无 hold 的 trash→restore 和普通到期 purge 成功。它们是普通归档回收/清理，不是去重 DIRECT_DELETE。                                                                                                            |
| `pnpm --filter @pixishelf/next exec vitest run services/__tests__/series-service.test.ts services/__tests__/series-management-service.test.ts services/__tests__/artist-service.test.ts services/__tests__/tag-service.test.ts --reporter=dot`                                                                               | 4文件48/48；修正新事务依赖的旧 mock 后原功能回归。                                                                                                                                                                                                                                                                                                                            |
| `pnpm --filter @pixishelf/job-executors exec vitest run src/pixiv-artwork/__tests__/executors.test.ts src/pixiv-artwork/__tests__/series-sync.test.ts src/pixiv-series/__tests__/executors.test.ts src/pixiv-series/__tests__/artwork-executor-fetch.test.ts src/migration/__tests__/prisma-database.test.ts --reporter=dot` | 5文件34/34；来源/系列/迁移原行为回归；共享 guard 的数据库证据见上项，不能把这些 mock 测试称为真实最终发布竞争。                                                                                                                                                                                                                                                               |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_data_next> pnpm --filter @pixishelf/db exec vitest run src/__tests__/creators.postgres.test.ts src/__tests__/artist-merge.postgres.test.ts src/__tests__/artwork-dedup-archive-drain.postgres.test.ts --reporter=dot`                                                                 | 3文件19/19；creator/merge 无 Claim 原功能真实 PG，及交接要求的 drain 括号收尾复验。未重跑 source-release 2项或 scan/archive 已通过完整范围。                                                                                                                                                                                                                                  |
| `pnpm --filter @pixishelf/db typecheck`；`pnpm --filter @pixishelf/job-executors typecheck`；`pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false`                                                                                                                                                           | 三项最新通过，包含最终生产代码及当时新增 PG；随后仅新增普通归档 queued hold 测试、格式和本节文档，没有再改生产类型。按统筹要求未重复三包类型。                                                                                                                                                                                                                                |
| `pnpm exec oxlint <29个明确文件>`                                                                                                                                                                                                                                                                                            | 最终0 warning、2条既有规则错误：`migration/prisma-database.ts` 1292行超1200（HEAD 原文件1281行已超限）；`creators.ts` syncSourceCreators 6参数超5。没有为此拆大文件或改原签名。新 curly/普通 lint 已修。完整输出 `/private/tmp/dedup-b1-sol-lint-final.txt`。此报告只覆盖所列29文件，不替代前段归档主体遗留 max-lines/max-params 记录。                                       |
| `git diff --check`；`rg --files packages/pixishelf \| rg '[A-Z]'`                                                                                                                                                                                                                                                            | diff 通过；路径扫描零匹配（退出1）。                                                                                                                                                                                                                                                                                                                                          |

失败迭代均为夹具/断言修正：shared-write 首轮用了错误 `beforeSnapshot` 字段及 FK 清理顺序，随后遗漏 Claim 的非关系筛选；两次随机前缀 `dedup-review-8428e7ed-5bf3-4605-83ce-d989f3ab2a39` 和 `dedup-review-6b8b3db7-539e-4c56-9d3b-21397eab60ea` 已精确清理。staging 初版夹具漏 normalizedMetadata、代路径格式写错，已按正式字段/路径修正；恢复断言最初在 RUNNING 时仅得到非 READY，最终改为先等待 executor 抛出并 `repository.release`，再断言真实 domain snapshot 的 STATE_CONFLICT。没有放松生产约束、伪造 drainedAt 给旧 LEGACY 正例或清库。

### 交 Astra 的明确 B1 阻断：CLEAN_STAGING 原声明恢复

可复现入口为上表的 `maintenance-executor.postgres.test.ts -t 'CLEAN_STAGING late-hold'`。文件 I/O 完成后注入持久 provider HOLD，最终 publication 因 SOURCE_HELD 回滚：`cleanupRequestedAt/generationToken` 保留、generation.cleanedAt 仍 null、原 `archive-cleanup:<jobId>` 的精确目录声明仍 ACTIVE。等待 executor 已退出后按原 queue API release lease，再调用 `inspectMediaContentRecovery(... readExecutorMediaRecoveryDomainSnapshot)`，真实抛出：`ScanExecutorError / STATE_CONFLICT / Media content recovery domain checkpoint is missing, unsupported or changed`。

现有调用链：`executeArchiveMaintenance` 的 CLEAN_STAGING 早分支 → `executeStagingCleanup` → `beginExecutorMediaDirectoryWrites(sessionId=archive-cleanup:<jobId>, artworkIds=[])` → `consumeMediaContentRecovery`；最终 `publishMaintenanceMediaWrite` 使用原 handles/source。`scan/media-content-recovery.ts` 对 ARCHIVE_MAINTENANCE 的域分支显式拒绝 CLEAN_STAGING，并仅接受 `archive-maintenance:<jobId>` 与 Artwork/revision snapshot。因此仅保留声明和重试同 job 还不足以续行；不得删除声明、换新 token 或伪造旧退出回执。

最小修复方向由 Astra 沿**现有** inspect/grant/resume/consume 和精确声明快照完成，不另建恢复体系：让原 CLEAN_STAGING 会话/原 payload 取得受验证的域 snapshot，并绑定原 Import 的 `id/systemJobId/phase/status/providerKey/externalId/creatorBucket/stagingPath/generationToken/sealedManifestSha256/cleanupRequestedAt`、完整 generation 的 `token/jobId/path/manifestSha256/drainedAt/cleanedAt` 及将清空的 item 检查点集合。复用现有有界摘要/claim handles/job attempt 绑定模式，按实际语义决定所需字段；这是交接要求，不是已实施的新契约。接回原 begin/最终 publication，并核对 CLEAN_STAGING 早分支的 ACTION_REQUIRED/取消回执路径。HOLD 必须继续允许停止和失败回执，不能因此刷新原来源 proof 或接受旧执行。

### 尚未覆盖，不能补作通过

- 上述 CLEAN_STAGING 的 offline grant/resume/consume、删除后 DB 失败/崩溃续行没有成功证据，B1 因此未闭合。
- maintenance 精确目录声明反向阻止**实际** claim 的专项竞争；App 首次章节 begin 与**实际** claim 双向竞争；path-only 章节到真实 Image 的 PG 路径尚欠。旧直接插 Claim 的晚拒绝不能替代这些证据。
- RECONCILE 的 source/URL hold 跳过物化目前只有代码接线，未增加专门真实 PG 物化用例；不得把请求拒绝或已排队动作测试当作该项。
- 本次 Pixiv source/series 的 PG 覆盖共享守卫和实际 creator SERIES；没有完整网络 fixture→最终 source/series executor 的真实并发屏障。迁移新增 PG 只验证 storageKey 分配/Claim，无文件迁移或恢复新证据。
- Local rescan 的真实 catalog 屏障、评分/User 级联真实竞争沿前段缺口，未另补；此前13项 scan 竞争不能扩称这些入口也已验收。
- 未跑全量 build/test/lint、50万性能、正式迁移、native 复审、浏览器、生产或 docs/diagrams 检查。图源没有新增修改，文档/图统一门禁由 B1 统筹在阻断修复与独立审查后执行。

所有本节测试/类型会话均已结束；只读进程核对没有本工作树的 Vitest/tsc/App 进程，只有核对命令自身。未启动或遗留自建 App/Worker/后台服务，未碰用户5430。这里冻结等待 Astra 复杂修复，再由独立 Sol 审查；不自动进入 B2。

## Astra：CLEAN_STAGING 原声明恢复阻断修复（2026-10-24，冻结交审）

本节接续上方 Sol 的真实 PG 复现，只闭合该阻断。没有改变已过审 source-groups/App-input，没有新 schema/migration、B2 删除状态机、native 文件实现、普通 URL 产品语义或自动化。上方旧复现是修复前证据；不再代表当前 CLEAN_STAGING 域完全不支持恢复。

### 精确本轮生产差异

- `packages/pixishelf-job-executors/src/archive/maintenance-executor.ts`：CLEAN_STAGING 进入既有 begin 拒绝的 ACTION_REQUIRED 路径。首次原 job fence 事务把精确目录声明与唯一 `archive.cleanup.checkpoint` 一同提交；原声明无 checkpoint 不补造。每次续行及最终事务检查原 checkpoint；文件动作前复核原目录身份。最终 DB 失败继续保留 ACTIVE 声明。去掉不可达的无 generation LEGACY 删除分支和未使用的全 items eager load。
- 新 `packages/pixishelf-job-executors/src/archive/staging-cleanup-recovery.ts`：本域 checkpoint 只存在于现有 SystemJobEvent。绑定原 Import/cleanupRequestedAt/generationToken/来源证明、所有 generation 和所有 item 的分页摘要、已有 provider 行 id/generation/status/owner，以及精确路径与根的 dev/ino/birthtimeNs；记录原 writeId/writeToken/directoryId。没有 capture/刷新 OPEN、没有清 token、没有改共享恢复 schema。唯一事件按原 job 查找，缺失或重复均拒绝；事件被裁剪同样拒绝。允许原目录仍在或已缺失；拒绝原缺失路径被占用和目录被替换。保留已有受信根/父路径 confinement。
- `packages/pixishelf-job-executors/src/scan/media-content-recovery.ts`：只增加 `ARCHIVE_MAINTENANCE / CLEAN_STAGING / archive-cleanup:<原jobId>` 的域 reader；仍走原 inspect → grant → resume → consume。顺带给该文件既有 multiline 条件补 lint 要求的 braces，无行为改动。

本轮没有改 `packages/pixishelf-db/src/media-content-recovery.ts`：共享原 token 转交、grant/attempt 绑定、消耗与最终释放机制直接复用。没有清理、刷新或重新生成旧执行的来源授权。checkpoint 中的 provider 行仅为原清理时的身份观察，恢复/最终提交按原代次比较，不代表新来源意图；HOLD/TOMBSTONE 仍由原守卫拒绝，控制/失败回执不经此授权。

### 精确测试与文档差异

- `packages/pixishelf-job-executors/src/archive/__tests__/maintenance-executor.postgres.test.ts`：保留 Sol 原有五项 LEGACY/CLEAN_STAGING 夹具；把晚 HOLD 的断言更新为 checkpoint 拒绝，验证 offline inspection 不把 HOLD 变成 OPEN 授权。其他已有 maintenance 测试未重跑。
- 新 `packages/pixishelf-job-executors/src/archive/__tests__/staging-cleanup-recovery.postgres.test.ts`：独立 13 项真实 PG 恢复专项；按唯一 prefix 清理合成记录和临时根，没有 reset/truncate/drop 测试库。
- `docs/design/artwork-deduplication/archive-source-proofs.md`：先补本域首次声明/原 checkpoint 原子提交、故障续行、缺证据保守拒绝的契约，再实现代码。
- 本 record：本节及顶部状态。上述 7 个文件即本次修复范围；其他 WIP/Sol 代码保持接续，不把整个 HEAD diff 误认本次新增。

### 最终检查证据

数据库仅 `postgresql://dedup:***@127.0.0.1:55432/dedup_executor_next`，文件仅本测试创建的系统临时目录。没有读取真实图库或用户 5430。

| 命令                                                                                                                                                                                                                                                                                        | 最终结果                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/maintenance-executor.postgres.test.ts src/archive/__tests__/staging-cleanup-recovery.postgres.test.ts -t 'CLEAN_STAGING\|LEGACY cleanup' --reporter=dot` | **2 文件、18 通过、12 跳过**，6.54s。覆盖原5项，以及首次声明已提交/文件未删中断、已删文件/未进 finalizer 中断、finalizer 完成业务 DML 后注入 rollback；三者均通过真实 inspect/grant/resume/consume 恢复原 writeId/token/目录，完成后版本按 consume+completion 共推进2。邻目录 sentinel 不变。 |
| 同上新恢复专项负例                                                                                                                                                                                                                                                                          | generationToken、generation.path、第101个item、来源generation、HOLD、原目录替换、原不存在final路径新占用、checkpoint缺失/重复均拒绝 grant，原声明不变；cleanupRequestedAt 在 resume 漂移拒绝；grant/resume后路径新占用在 consume 前拒绝并 PAUSED/ACTION_REQUIRED，grant仍 ACTIVE、文件不删。  |
| `pnpm --filter @pixishelf/job-executors typecheck`                                                                                                                                                                                                                                          | **通过**；覆盖本次最终生产代码及拆分后的专项文件。其后仅测试 else 补 braces 和本节文档，无类型行为改动。                                                                                                                                                                                      |
| `pnpm exec oxlint <上述3个生产文件+2个测试文件>`                                                                                                                                                                                                                                            | **0 warning、0 error**。未扩大到先前记录中的普通 lint 遗留。                                                                                                                                                                                                                                  |

首轮 16 项中 13 通过、3 个恢复完成后的断言失败：测试只计算 consume 的版本推进，漏算 completion 的既有推进；修正为总共 +2，最终全过。首轮类型仅新增测试泛型 finalizer wrapper 错误，已修。静态收尾只补 braces；新增测试从既有超1200行文件拆为相邻专项文件，未重构生产框架。

### 保守边界与独立审查责任

- 已运行但没有本域 checkpoint 的旧 WIP 声明仍不能自动恢复，历史事件缺失也不能用当前文件不存在替代证据；需单独人工核对。没有删除旧声明来伪造成功。
- 专项直接调用真实现有 offline API，没有启动 CLI/App/Worker 全链；没有注入递归 rm 内部的中途系统崩溃，也未做父路径/根替换的独立故障测试。代码允许原目录部分内容已删、目录身份仍原值的续行；继续继承 root-confined 的非 native TOCTOU 边界，未声称文件身份原子能力已通过。
- generation 与 item 摘要全量分页，已用第101个 item 漂移验证跨页；不是50万规模性能测试。无关完整主应用/DB/worker build/test 未重跑；本节不覆盖原记录中其他未验证入口。
- 本轮全部 test/typecheck/tool session 已退出，临时根由 afterAll 清除；没有自建常驻进程，没有提交，没有恢复自动化80。代码冻结交独立 Sol review；整批是否关闭由独立审查决定。最终 docs:check/diagrams:check 由统筹在文档定稿时完成，本轮未重复运行。

## Astra：独立审查 R1–R4 定向修复（2026-10-24，冻结交差异复审）

仅处理[首次独立审查](./artwork-deduplication-direct-delete-batch1-review-2026-10-24.md)四项发现。没有再查全项目入口，没有扩到 B2/native/schema，也没有把首次审查列出的其他证据缺口追加为本轮任务。保留全部原 Sol/WIP；未提交，自动化80仍未恢复。

### 生产增量（8文件）

- R1/R3：`packages/pixishelf-db/src/artwork-dedup-archive-drain.ts` 按严格 `ARCHIVE_MAINTENANCE + payload.action=CLEAN_STAGING + payload.archiveImportId` 找原任务，再按 jobId/session 查未结束声明；同一查询用于普通清理请求守卫与已有 drain 聚合。只有相关 cleanup 属于旧执行；其他 Import、RECONCILE 和去重自身任务不会被纳入。`packages/pixishelf-db/src/index.ts` 导出未解决清理查询。
- R1：`packages/pixishelf/services/archive/archive-maintenance-service.ts` 在推进意图前发现原声明即返回明确原任务恢复要求；`packages/pixishelf-job-executors/src/archive/maintenance-executor.ts` 的 RECONCILE 在同一位置 SKIP。FAILED/CANCELLED 不能推进原 cleanupRequestedAt 或新建抢占 job；原 intent/checkpoint/token 不变。
- R1：`packages/pixishelf-db/src/media-content-recovery.ts` 只放行原 CANCELLED CLEAN_STAGING 的 offline 恢复；snapshot/session、真实 job payload、原域 reader、全 writer 停止和未过期租约检查都继续执行。非 cleanup 的 CANCELLED 仍 WRITING；原取消标记仅由既有 resume 事务在授权后清除。没有放宽普通 cancelled 任务或添加新恢复协议。
- R2：`packages/pixishelf-job-executors/src/archive/phase-handoff.ts`、`intake-enqueue.ts`、`resolver-executor.ts` 在首次 archive/source 锁之前取已有 creator catalog。覆盖 DOWNLOAD→PUBLISH、LEGACY→DOWNLOAD、手工入队和 AUTO 分类/入队的 SystemJob INSERT 触发器隐含锁；不对原暂停/取消/失败回执增加 OPEN 要求。

### 专项增量（6文件）

- 新 App `services/archive/__tests__/archive-cleanup-recovery.postgres.test.ts`：真实清理已删文件后注入失败，通过 runtime finalizer 分别形成 FAILED/CANCELLED；同一合成库实际调用 App 请求和 RECONCILE，然后原 inspect/grant/resume/consume 完成。对比原摘要、时间戳、唯一清理 job 和 writeId/token；CANCELLED 附非 cleanup 域拒绝、保留取消标记仍可恢复的正负断言。
- DB `src/__tests__/artwork-dedup-archive-drain.postgres.test.ts`：在既有真实 PG 回滚样本中添加相关 RUNNING cleanup（未声明也阻断）、终态仍 ACTIVE、session-only RECOVERY_REQUIRED、声明完成后解除阻断，以及不同 Import/RECONCILE 排除。任务与声明是满足正式约束的合成观察样本；此项不是真实维护认领或发送停止命令的并发测试。
- 新 executor `archive/__tests__/catalog-order-probe.ts`：实际入口首次调用 catalog 时暂停；第二个 PostgreSQL 事务依次取得 catalog、archive、原 provider 行 FOR UPDATE，lock_timeout=250ms，必须成功且触达计数非零。不是仅检查 SQL 文本顺序。
- executor `archive/__tests__/download-lane.postgres.test.ts` 与 `resolver-executor.postgres.test.ts`：给真实 DOWNLOAD/LEGACY v1/v2 handoff、AUTO resolver 加上述屏障；新增手工 enqueue 屏障。既有 AUTO/manual 竞争夹具同步采用正确外层 catalog→archive 前缀。
- executor `archive/__tests__/download-lane-recovery.postgres.test.ts`：保留真实晚 manifest I/O 屏障，改为整次清理在首个文件/声明之前 STATE_CONFLICT，旧代与已drained后继代均未 cleaned、文件保留；释放真实晚执行后仍无旧 fence drain 回执，第二次清理继续拒绝且零声明。没有删除该竞争用例、手改 drainedAt 或放宽生产 drain 门槛。

契约先补于 `docs/design/artwork-deduplication/archive-source-proofs.md` 的“B1 审查修复”节；本 record 为另一文档变更。本轮总计上述8生产+6专项+2文档，共16文件。

### 命令与确切证据

所有 DB 连接仅127.0.0.1:55432的既有合成库；App/Executor 使用 `dedup_executor_next`，drain 使用 `dedup_data_next`。测试媒体仅系统临时根。没有真实DB/媒体/5430操作，没有删除重建合成库。

| 命令                                                                                                                                                                                                                                                                                                                                                                             | 结果                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL=<dedup_executor_next> QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/next exec vitest run services/archive/__tests__/archive-cleanup-recovery.postgres.test.ts --reporter=dot`                                                                                                                                                      | **2/2通过**（FAILED/CANCELLED）。随后增加取消标记及非cleanup负例，只以 `-t CANCELLED` 复跑，**1通过、1跳过**。                                                                                                                                                                                                              |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/download-lane.postgres.test.ts src/archive/__tests__/resolver-executor.postgres.test.ts src/archive/__tests__/download-lane-recovery.postgres.test.ts -t 'catalog barrier\|serializes an AUTO handoff\|rejects whole cleanup' --reporter=dot` | **3文件、7通过、50跳过**。五项实际catalog屏障（DOWNLOAD、LEGACY v1/v2、manual、AUTO）、一项AUTO/manual竞争、一项真实旧晚执行清理拒绝。                                                                                                                                                                                      |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_data_next> pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-archive-drain.postgres.test.ts --reporter=dot`                                                                                                                                                                                                         | **1/1通过**。最初误用 PIXISHELF_TEST_DATABASE_URL 导致 skipped，不算通过；后续合成夹具先后违反租约字段、声明job/token/attempt、单writer lane三项正式约束，补齐夹具后通过，未改约束或生产门槛。                                                                                                                              |
| `pnpm --filter @pixishelf/db typecheck`；`pnpm --filter @pixishelf/job-executors typecheck`；`pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false`                                                                                                                                                                                                               | 三项通过；增加最后 CANCELLED 负例及修正drain夹具后，DB/App类型再复验也均通过。执行器在首次通过后只有非行为文档/静态记录，无新增执行器类型修改。                                                                                                                                                                             |
| `pnpm exec oxlint <14个本轮代码文件中的10个无既有错误文件>`                                                                                                                                                                                                                                                                                                                      | **0 warning、0 error**。范围：DB drain/index/drain test；executor maintenance/phase-handoff/intake-enqueue/catalog-order-probe/download-lane-recovery test；App maintenance service/new recovery test。                                                                                                                     |
| `pnpm exec oxlint <本轮代码文件除index的13文件>`                                                                                                                                                                                                                                                                                                                                 | **0 warning、33 error**，均位于本轮未改动的既有规则位置：DB media-content-recovery 19个curly+audit max-params；resolver production 2个max-params；resolver旧测试2个curly；download-lane旧测试9个curly。没有为消除既有规则而做本轮无关重构。精确输出 `/private/tmp/dedup-b1-review-fixes-lint-final.txt`。不是全批lint通过。 |

本轮相关功能证据合计10个独立用例通过，额外一次CANCELLED定向复验。不重复之前18项恢复全集、旧25项归档、全量主应用/Worker/DB build/test或50万规模。全部自建测试/检查进程退出后冻结；未启动常驻服务。审查记录中的其他B1证据缺口、历史无checkpoint兼容边界与native平台限制仍如原文，不借本轮通过数量宣布闭合。后续仅由原Sol复审本节修复差异与证据；无论复审是否全过，不继续自主扩大循环全审。

## Sol：B1 独立审查剩余证据补齐（2026-10-24，实施证据交原审查者复核）

只补[独立审查未覆盖项](./artwork-deduplication-direct-delete-batch1-review-2026-10-24.md#未覆盖项与批次归属)的七项最小证据。**七项现均已补齐，待原审查者只复核新增证据；本实施者不代签 B1 独立审查通过。** 没有新生产缺陷或生产代码改动，没有重跑 R1–R4、旧几十项套件或规模测试。

本轮仅新增两个测试文件：`packages/pixishelf/services/artwork-service/__tests__/dedup-b1-evidence.postgres.test.ts`（以下 App 文件）、`packages/pixishelf-job-executors/src/scan/__tests__/dedup-b1-publication-evidence.postgres.test.ts`（以下 Executor 文件）；更新本记录和 review 的证据归属节。没有修改 UI/schema/migration/native、门禁、自动化、其他 WIP 或暂存区，没有提交。HEAD 仍为 `6e8d4f4c98514c96233404e02acb241f0a1be20f`。

| ID                                        | 实际入口与确切边界                                                                                                                                                                                                                                                                                                                                                                | 结果              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| E1：maintenance ↔ 实际 claim             | 实际 TRASH begin 提交目录声明后受控停止，以 runtime finalizer 形成 FAILED；writer 轮换后实际 claim 明确 CONTENT_WRITING、零 Claim。反方向实际 claim 提交、原 writer 离开后，真实 queue claim 的 maintenance owner 调用生产目录 begin，明确 STATE_CONFLICT、零声明。断言同根/目录 ID、原 session、原 source HOLD/owner。反方向是生产目录准入原语，不冒称完整 trash 生命周期。      | App 两项通过      |
| E2：首次章节 begin ↔ 实际 claim          | 两个方向都在实际事务 commit 前用 promise 屏障控制，另一 PG 连接明确 P2010/55P03；释放后分别 STALE/WRITING，原 Image token 关联正确，零新增 Claim/声明。没有 sleep 或捕获任意异常作通过。                                                                                                                                                                                          | App 两项通过      |
| E3：path-only 真实 Image                  | 实际 uploadMediaChapterManifest 以 videoPath 找到登记 mp4 Image，建立原 uploadToken 来源声明及 READY 回执。其后保持既有409/Replacement authorization required；Image.chaptersPath 未改，不冒称 path-only 已成功发布。                                                                                                                                                             | App 一项通过      |
| E4：Local rescan 最终事务                 | 实际 executeLocalArtworkRescan 使用真实冻结输入/fingerprint/source proof 与真实文件发现；首次 catalog 前另一 PG 连接取得 catalog→同根→Artwork，hits=1，随后登记图片与 SUCCESS/UPDATE checkpoint 落地。                                                                                                                                                                            | Executor 一项通过 |
| E5：评分/User 级联                        | 实际 App setArtworkRating 和 deleteUser 首次 catalog 前，另一 PG 连接取得 catalog→同 Artwork→目标 UserBA，hits=1。随后真实 level=3 写入、带评分用户删除及 PG FK 评分级联清除成功，作品仍存在。                                                                                                                                                                                    | App 两项通过      |
| E6：HOLD 下 RECONCILE                     | 实际 materializer 同时遇到 source HOLD 的到期 staging 和无活 Claim 的持久 URL hold 作品；discovered=2/skipped=2/materialized=0/reused=0，未 enqueue，job 数、原行与时间戳不变。执行前确认没有无关可物化候选。                                                                                                                                                                     | App 一项通过      |
| E7：source-sync/series/migration 最终发布 | 两个实际 Pixiv executor finalizer 在首次 catalog 前，让另一连接取得两个共享成员 Artwork、Series 和原 ref 锁；hits=1，job COMPLETED、共享 title/来源 metadata 真实写入。系列明确保留 MANUAL 成员，PARTIAL/protectedFields=[membership]。完整真实 move 迁移的最终 Prisma publication 前另一连接取得 catalog→同根→Artwork，最终路径/item/job/声明完成、目标内容正确且原文件 ENOENT。 | Executor 三项通过 |

E1 没有伪造同瞬间双完整 writer：正式 `20260818120000_add_archive_intake_worker_lanes/migration.sql` 第62行的 `system_jobs_single_executing_per_lane_idx` 排除同 lane 的两个 RUNNING/PAUSING/CANCELLING。故按真实 lane 轮换与持久声明验证两种顺序；E2 的 App 入口不占 Worker lane，确为双连接竞争。claim 使用真实 DB 认领；冻结内容与检查 flags 是合成 fixture，不宣称重跑检测/fresh 文件验证。

| 实际命令                                                                                                                                                                                  | 最终结果                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `QUEUE_KERNEL_TEST_DATABASE_URL=<dedup_executor_next> pnpm --filter @pixishelf/next exec vitest run services/artwork-service/__tests__/dedup-b1-evidence.postgres.test.ts --reporter=dot` | **8/8通过**，3.45s；Better Auth 仅提示合成环境缺 base URL，没有登录/网络请求。                                           |
| 同库 `pnpm --filter @pixishelf/job-executors exec vitest run src/scan/__tests__/dedup-b1-publication-evidence.postgres.test.ts --reporter=dot`                                            | **4/4通过**，1.45s；probe hits 和实际业务/文件结果均断言。                                                               |
| `pnpm --filter @pixishelf/job-executors typecheck`；`pnpm --filter @pixishelf/next exec tsc --noEmit --incremental false`                                                                 | 均通过。Executor 随后只明确新 series fixture 的 MANUAL provenance、清 unused imports；App 类型包含最终泛型及共享根断言。 |
| `pnpm exec oxlint <两个新增测试文件>`                                                                                                                                                     | 最终0 warning、0 error。                                                                                                 |
| `git diff --check`；`rg --files packages/pixishelf \| rg '[A-Z]'`                                                                                                                         | diff通过；路径零匹配（退出1）。                                                                                          |

仅用127.0.0.1:55432的 `dedup_executor_next`，新文件校验 host/port/database，媒体只在自建临时根。开始前根协调零行；按本轮 prefix/精确 ID/token/自建根身份清理，不改其他 fixture 根，不加载应用环境、不碰真实DB/媒体/5430。最终两个新文件一次干净验证共12项全过；先前失败仅是新夹具的 manifest 字段、queue lease/MANUAL优先级、逐例清理、Series 默认 LEGACY 与明确 MANUAL 断言、测试 context child 泛型问题，未放松约束或生产门槛。

未跑全量 lint/test/build、docs/diagrams、浏览器或生产验证，B2/B3 责任仍如原记录。所有本轮测试/类型进程退出，无自建常驻服务、无提交、自动化80未恢复。冻结交原 Sol 仅复核新增两测试文件及本证据，之后暂停，不进入 B2。


## 主线程最终收口与暂停

2026-10-24，独立审查最终确认 B1 无剩余阻断，详见[独立审查最终结论](./artwork-deduplication-direct-delete-batch1-review-2026-10-24.md)。上文中途的“待补”“待复审”描述保留为当时记录，以末节证据及审查最终结论为准。全部子代理本轮已结束，无遗留测试或自建 App/Worker 进程。按三批计划暂停；不派发 B2，不恢复自动化80。

主线程收尾：252份Markdown检查通过；使用已安装Chrome完成33张图源、23个内嵌Mermaid检查。默认Playwright Chromium未安装，Chrome在沙箱内启动受限，正常提升权限后检查成功；未下载浏览器、未改图源或重新全量生成。主目录git status为空；独立worktree仍在codex/artwork-deduplication、HEAD 6e8d4f4c，已有及本批未提交改动全部保留，未暂存或提交。

本批完成的是新直接删除设计与必要写保护；DIRECT_DELETE仍未实现开放，旧stage 3不变。既有lint规则遗留、历史无checkpoint的保守拒绝和最终全量/浏览器未执行限制见上文，不宣称全仓库验证通过。未运行本批不需要的全量build/test或50万规模重测，未操作真实媒体/业务库、未停止用户5430服务。

下一次仅在用户明确继续后开始B2：正式DIRECT_DELETE目的与独立门禁、冻结预览与一次确认、认领后真实停止及Writer让槽、所选全组fresh核验、精确逐文件删除/回执、部分失败续行、业务记录删除与来源墓碑/显式重新导入。复用本批已审守卫、release与drain原语，不重做B1。B3负责正式UI及最终验收，浏览器模型固定GPT-6.1 Sol / medium。
