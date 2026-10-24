---
status: historical
scope: 去重第三阶段数据与接口首批冻结文件独立审查
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-data-batch-1-2026-10-24.md
  - docs/records/artwork-deduplication-data-batch-1-fixes-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/03-review.md
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf-db/src/artwork-dedup-operation.ts
  - packages/pixishelf-db/src/artwork-dedup-ownership.ts
  - packages/pixishelf-db/src/artwork-dedup-user-delete.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts
---

# 数据与接口首批独立审查

2026-10-24，分支 `codex/artwork-deduplication`，基线 `c2d6be73d0ace279a8ea716511daaa9b241d1616` 的首批冻结未提交文件。审查者使用独立新上下文，未参与本批实现。审查范围仅为[首批记录](./artwork-deduplication-data-batch-1-2026-10-24.md)列出的 DB、共享契约、运行时通用入口保护和 App API 文件，以及相关测试；不构成完整第三阶段验收。

同日按[差异修复记录](./artwork-deduplication-data-batch-1-fixes-2026-10-24.md)完成窄复审：原三项 P2 均关闭，直接依赖的新归属/helper 静态审查未发现新增可确认阻塞项。后文保留首审发现及当时证据；最新范围、验证与限制见末节。此结论不提升 release stage，不替代完整 PREPARE 或文件基础独立验收。

## 方法与环境

先阅读 AGENTS、文档入口、产品基线、权限边界、备份恢复及第三阶段设计/共享实施契约。静态检查迁移 107–109、Schema、审核/CAS/冻结/清单 helper、账户删除事务、共享 payload/DTO/阶段门禁、队列与 App 通用控制入口、路由及私人投影。

仅为两个具体业务疑点执行无数据库的最小调用：实际导出函数加注入的事务 double，通过现有 `pnpm exec node --import tsx` 运行。未连接 PostgreSQL，未读取真实媒体，未访问 `dedup_scale`，未启动浏览器，未运行全量 build/lint/test。首批记录中的 46 项验证为实现者提供的证据，本次未独立重跑。未修改业务代码。

## 发现

### P2：READY 提交未检查逐文件 inspectionStatus

位置：`packages/pixishelf-db/src/artwork-dedup-review.ts:278–286`。

`completeArtworkDedupPrepare` 的文件阻断条件检查 `status` 和 `ownershipStatus`，遗漏独立的 `inspectionStatus`。因此在 inventory/目录检查标志完整且其他快照校验通过时，合法持久数据组合 `status='VERIFIED'`、`ownershipStatus='VERIFIED'`、`inspectionStatus='PENDING'` 仍发布 READY。`inspectionStatus` 有 PENDING 默认值，文件写入 helper 也没有建立这三个字段必须同步完成的约束；当前首批宣称的最终完整检查门禁不能自行拒绝此状态。

定点调用实际 `completeArtworkDedupPrepare`，事务 double 仅将其他无关条件设为通过，并按实际查询的 OR 谓词计算文件计数，结果：

```json
{"file":{"status":"VERIFIED","ownershipStatus":"VERIFIED","inspectionStatus":"PENDING","requiresReview":false,"blockReason":null},"resultingStatus":"READY"}
```

最小修复：最终文件阻断谓词补充 `inspectionStatus != 'VERIFIED'`（或共享契约定义的唯一成功状态），并增加逐文件 PENDING/失败检查不能发布 READY 的定向测试。此次复现说明 DB helper 的完成条件缺口，不声称尚在开发的 PREPARE 执行器已经产生该组合。

### P2：全部建议丢失用户明确排除的历史和计数

位置：`packages/pixishelf-db/src/artwork-dedup-review.ts:184–185`、`:224–231`。

ALL_RECOMMENDED 将 `excludedGroupIds` 放入 `NOT IN` 过滤器，再只为剩余组插入 OperationGroup。用户明确排除的组既没有 EXCLUDED 冻结行，也不计入 `excludedGroups`。例如 run 有三组有效建议，排除一组后操作得到 selectedGroups=2、excludedGroups=0；只有算法认定不具资格的组才计为 EXCLUDED。后续仅凭稳定 operationId 不能还原用户排除了哪组，操作摘要少算实际排除范围，与共享契约要求保存跨页选择/排除及实际计数不符。现有首批多组测试恰使用此请求，但只断言 selectedGroups，未检查这一结果。

最小修复：ALL_RECOMMENDED 为 run 的完整组集合落冻结行，将用户明确排除组记为 EXCLUDED 和固定原因；只为 SELECTED 组创建 OperationArtwork。排除计数同时涵盖显式排除和资格排除，并增加三组/显式排除一组的断言。EXPLICIT 请求仍限定其提交的组集合。

### P2：文件预览没有验证 artworkId 属于当前操作

位置：`packages/pixishelf/services/artwork-dedup-review-service.ts:410–419`。

`getOperation` 的 FILES 分支直接把可选 `artworkId` 作为文件查询过滤条件，没有先核对 `(operationId, artworkId)` 的冻结成员行。传入另一操作的作品 ID 或未知 ID 时返回成功空页，而非约定的跨范围/未知 ID 受控拒绝。账户切换或详情切换后若沿用旧作品选择，会被解释为“此作品没有文件”，无法与非法预览范围区分。游标绑定不能代替首屏资源归属校验。

注入只有 Operation 与文件查询能力的事务 double，调用实际 `getArtworkDedupOperation`，使用当前操作之外的 artworkId=999999；函数没有访问成员表，返回：

```json
{"preview":{"kind":"FILES","items":[],"nextCursor":null}}
```

最小修复：当 FILES 指定 artworkId 时，在同一事务内查询 OperationArtwork 的复合主键，不存在即返回 NOT_FOUND/CONFLICT；补充跨操作 ID、未知 ID 和合法但尚无文件成员的区分测试。

## 已审部分的其余结论

- 当前账户审核以 `(runId,userId,groupId)` 隔离；ReviewState 串行化本账户审核与冻结，幂等请求先识别重放再执行业务 CAS。REPREPARE 在取得源操作锁后重新检查版本，重试保留原 operationId/范围。
- 全账户评分和有效/失效标记进入保护查询及有序签名；阅读不参与授权失效签名。App 的评分/标记/阅读只取当前读取者，他人仅布尔保护提示；未发现本批新增的跨账户私人内容透传。
- 最终 PREPARE 的 ReviewState/创作者/Artwork 锁持续到事务完成；账户删除以 UserBA 和 ReviewState 的 NOWAIT 锁及作品升序 NOWAIT 处理与普通写者的反向争用，静态检查未发现新的提交窗口。并发正确性没有在本次重跑真实 PG。
- 新维护历史表没有 Artwork/Image 删除级联；Operation 对 Run 为 RESTRICT，来源及收据保留独立稳定身份。迁移以新增 107–109 交付，没有回写已应用迁移。
- 共享 release stage 仍为 2；审核/准备/控制及高级路由均执行阶段检查，高级路由仍为拒绝执行的 typed shell。App 通用创建、控制、重试和提权以及运行时子任务/外部取消入口拒绝维护任务；未发现从这些入口绕过门禁的新增路径。

另有显示契约补齐项：`artwork-dedup-review-service.ts:108` 对全部现存成员固定返回 `thumbnailUrl:null`，未接通设计要求的既有受保护缩略图；最终界面联调前需补齐，不将此项混作安全门禁发现。

## 限制与后续

已知下一批的四项接口边界继续保留：全库跨作品/跨角色文件引用归属检查；COPY 范围唯一规范根/路径 logicalBytes 聚合；snapshot 可选 artworkId；Inventory 真实 archive pageIndex 及持久 stagedPath/sha/bytes 映射。本次没有将它们重复列为新发现，也没有宣称已支持。

PREPARE 执行器、文件基础、真实文件检查、UI、完整维护声明/写入口/URL hold/drain、隔离恢复与永久清理授权不在本次冻结审查范围。首审时三项发现要求修复并定向复审，关闭结果见末节；本记录不允许提升 release stage，也不替代后续第三至第五阶段验收。

无 DB 最小复现脚本位于 `/tmp/dedup-data-batch-review-proof.mts` 和 `/tmp/dedup-data-batch-review-api-proof.mts`，仅为本次环境证据，非产品或持久测试。初次使用 tsx CLI 因沙箱禁止 IPC pipe 报 EPERM，改用 Node import loader 后两项调用成功，无需提升权限。

## 文档与路径检查

主应用全小写路径检查 `rg --files packages/pixishelf | rg '[A-Z]'` 无输出。`pnpm docs:check` 通过，检查 215 份 Markdown 的本地链接、锚点、路径大小写和代码围栏。新增审查记录的 `git diff --no-index --check /dev/null <record>` 无空白错误输出（有新增内容时 no-index 返回 1）。未修改 Mermaid/SVG；本次范围禁止浏览器，因此不运行会启动浏览器的 diagrams 检查，交由最终统一文档门禁。

## 修复差异复审（2026-10-24）

复审时 HEAD 为 `6e8d4f4c98514c96233404e02acb241f0a1be20f`，业务差异仍未提交。只复审差异记录中的三项修复、相关回归断言，以及它们直接依赖的新 ownership、根映射、单项 snapshot、COPY 字节聚合和归档清单证据 helper；没有扩大为 PREPARE 执行器验收。保留其他协作者改动，未修改产品代码。

| 原发现 | 当前实现与直接验证 | 结论 |
| --- | --- | --- |
| READY 漏查逐文件 inspectionStatus | `artwork-dedup-review.ts:295–304` 已将非 VERIFIED 检查状态纳入阻断；`:310–311` 的 COPY 字节统计也使未检查文件返回 null。真实 PG 测试文件 `:231–244` 分别断言 PENDING、BLOCKED 返回 FAILED；正常 READY 的原并发窗口测试仍保留。 | 关闭 |
| ALL_RECOMMENDED 丢失用户排除 | `artwork-dedup-review.ts:181–189` 不再用用户排除缩小完整 run 的组集合；`:227–234` 持久 USER_EXCLUDED，统计 EXCLUDED，只为 SELECTED 写入作品。PG 测试文件 `:208–220` 断言 selected=2、excluded=1、历史原因及排除组没有 OperationArtwork。 | 关闭 |
| FILES artworkId 没有操作归属校验 | `artwork-dedup-review-service.ts:410–418` 查询 OperationArtwork 复合主键，不存在即受控拒绝。独立运行该接口的一个无 DB 定向测试，跨操作/未知 ID 在文件查询前拒绝，合法无文件成员返回空页。 | 关闭 |

本次独立执行命令（App 包内）：

```bash
QUEUE_KERNEL_TEST_DATABASE_URL= pnpm exec vitest run services/__tests__/artwork-dedup-review-service.postgres.test.ts -t 'rejects foreign and unknown FILES artwork scopes'
```

结果：1 passed、3 skipped，测试调用耗时 5 ms；测试环境变量明确为空，未连接数据库。DB 的上述断言及 `/tmp/dedup-data-fix-p2-pg-retry.log` 中 5/5 结果已阅读，属于实现者证据，本次没有独立重跑真实 PG。没有运行全量构建、测试、规模测试或浏览器。

直接依赖静态审查确认：saveFilesPage 先覆盖调用者的 ownershipStatus，再按绑定根和稳定引用键查询；最终完成再次查询全清单。source/archive 共用物理根时，目标按 archiveRelativePrefix 同时映射两个登记命名空间，未发现漏掉该配置的新增阻塞项。跨角色、跨作品及本操作重复引用参与阻断，未知附件仍阻断。COPY 聚合排除 keeper 并按物理根/规范路径去重；单项 snapshot 先核对冻结成员并在锁和比较中使用相同过滤条件。迁移110只新增对应索引，没有回写既有迁移。归档证据查询校验唯一 revision、provider/identity、已发布作品、sealed/drained 摘要以及真实 item/image/检测字节映射，清单分页使用真实 pageIndex。

这些代码已进入本批直接依赖，但上述静态核对不等于跨引用、嵌套根、归档有效/篡改与大范围回归已全部通过；相关独立定向证据仍按后续分工补齐。封面新路由、operation reader 恢复、完整 PREPARE、文件基础原生模块及后续维护声明/动作不在本次结论内。文件基础独立复审的既有平台阻断保持原状态；本次没有绕过或关闭该门禁。release stage 继续保持 2。

复审记录交付时 `pnpm docs:check` 通过，检查 218 份 Markdown；应用大写路径检查和本记录 no-index 空白检查均无错误输出。未运行图示/浏览器检查。
