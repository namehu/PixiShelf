---
status: record
scope: B3 独立有界审查及隐私/分页两项 P2 修复差异复审
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-direct-delete-batch3-2026-10-24.md
  - docs/design/artwork-deduplication/ui-design.md
  - docs/features/artwork-deduplication.md
  - docs/features/browser-privacy.md
  - docs/operations/runbooks/artwork-deduplication.md
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-preview.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-reimport.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-review.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-members-sheet.tsx
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# 第三批独立审查

**B3 代码门槛通过：P2-01/P2-02 已经限定差异复审关闭，无剩余代码审查阻断项。**初审未发现 P1。最终 App typegen/build、Sol/medium 真实浏览器及发布候选的最终开放决定仍由主任务收口；本代码结论不替代这些验收，也不代表生产部署。

2026-10-24，GPT-6.1 Sol / xhigh，工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c` 加既存 WIP。已读完整第三批实施记录（UI、真实 PG 展示、隔离候选及最终旧夹具修复）、最新页面设计、功能规格和运维手册。只读本批代码与关联调用点；B1/B2 已通过结论继续有效，未重新审其删除核心、迁移、drain、50万规模或旧移动套件。

本轮未操作浏览器、未连接数据库、未重跑测试或 docs/diagrams；唯一仓库写入为本文。使用 [web-design-guidelines 技能](../../.agents/skills/web-design-guidelines/SKILL.md)及其[官方规则源](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)补充核对语义控件、名称、焦点和静态布局；真实视口/焦点行为仍交后续浏览器验收。

## P2-01：文件与来源名称绕过全局隐私遮蔽（已关闭）

以下保留初审时的代码位置和问题语境；关闭依据见末尾差异复审。初审位置：`packages/pixishelf/app/admin/duplicates/_components/duplicate-operation-preview.tsx:143–144,166–173`；`packages/pixishelf/app/admin/duplicates/_components/duplicate-reimport.tsx:76`。

触发：用户切换为隐私模式后，打开批次的「原件与附属文件」或「允许重新导入」。成员作品名已使用 PrivacySensitiveText，但文件名 relativeName、冻结 artworkTitle、包含文件/目录末级名的 source.displayName 均直接输出在普通 p/span 中，没有 data-privacy-sensitive 的祖先。全局 CSS 只遮蔽标记节点，因此这些敏感只读名称仍以明文出现，与全站隐私契约不一致。aria-label 保留真实内容是既有明确边界，本项不要求改变辅助技术或复制语义。

最小修复：使用现有 PrivacySensitiveText（或合适的 data-privacy-sensitive 节点）标记实际文件/作品/来源名称，保留角色、数量、来源状态和动作文字的可读性。两处展示和重导入来源选择都需覆盖，不能只改成员标题。

补证：定向组件断言上述动态名称落在隐私标记内；后续真实浏览器切换隐私时核验 FILES 与来源选择两个视图。无需新隐私框架或重跑全站隐私矩阵。

## P2-02：非首页保存 keeper 后继续使用旧审核版本的游标（已关闭）

以下保留初审时的问题语境。初审位置：`packages/pixishelf/app/admin/duplicates/_components/duplicate-review.tsx:35,57,76–96,199–205`；`packages/pixishelf/app/admin/duplicates/_components/duplicate-members-sheet.tsx:36–45,114–121`。服务契约对照：`packages/pixishelf/services/artwork-dedup-review-service.ts:169–188,190,216`。

触发：在第2页及之后的结果组，或长组的第2页成员中，成功保存新 keeper。saveReview 推进 reviewRevision；组件只 invalidate listGroups 查询，组 cursor/memberCursor 仍保留旧 reviewRevision 的编码。服务按当前 reviewRevision 解析游标，下一次查询确定返回 INVALID_CURSOR。错误后的「重新加载」仍带同一旧 cursor，不能自行恢复；要退回首页才能重新取得可用游标，当前页保存/选择/预览流程被错误中断。

最小修复：保存成功或观察到审核范围 revision 变化时，使组与成员分页都回到有效范围并重新取得游标；不要放宽服务端游标的账户/运行/审核版本绑定。保留已保存 keeper、独立删除选择与幂等意图，避免通过清空整个审核状态掩盖问题。

补证：用有审核 revision 校验的定向组件 fixture，覆盖结果页2保存 keeper，以及21成员组的成员页2保存 keeper，随后查询/再选择可正常继续且不循环 INVALID_CURSOR。真实浏览器对25组和21成员样本再核验一次。现有分页 mock 只按 cursor 回传数据，没有模拟保存后服务拒绝旧 revision，故不能覆盖本条件。

## 其余限定范围的结论

| 范围 | 核对结果及限制 |
| --- | --- |
| 正式入口与一次确认 | 正式页面仅「检查结果 / 删除记录」，现行组件没有导入旧 recovery consent，也不调用 isolate/restore/preparePurge/purge。新 PREPARE 显式 purpose/protocol；确认在同一 Sheet 内绑定新目的、READY、服务器 allowedAction、范围摘要和版本，两个后果/持续停写勾选形成三个 literal true，没有备份表单、口令或第二次永久删除确认。旧目的只读提示重新准备。 |
| 账户、幂等与迟到响应 | CheckPage/Workspace/Sheet 按账户、运行、操作重新挂载；操作确认还按 version/scopeDigest 重置。useDuplicateIntent 在同步锁下保留未知响应的原规范输入键，离开作用域后忽略迟到 callback；操作查询键含 expectedUserId，较旧版本/updatedAt 不覆盖新状态。新请求由真实 Session 与服务端状态决定，UI不接文件路径。 |
| 首 intent 与显示契约 | 服务使用持久 deleteStartedAt/stopRequested 区分 CANCEL/STOP；PREPARE BUILDING 可请求取消不等于 reader 退出。deleteIntentFiles SQL 按 DELETE receipt 的 distinct fileId 计数；FILES 关联持久 operationArtwork 的 role/title，不依赖已删业务行。作品名/来源/时间强制用冻结字段，个人数据 CURRENT/REMOVED/UNAVAILABLE，删除后明确未保留历史明细。keeper 不在前三摘要时有独立投影，未扩原删除范围。 |
| 真实 PG 展示证据 | `artwork-dedup-display.postgres.test.ts` 调真实 service/Prisma，5条收据含跨执行重复及非DELETE而投影3文件，验证远端 keeper、文件冻结关联、业务删除后 REMOVED/冻结字段和实时 generation17。它直接构造合法展示状态，不能当真实 unlink 证据；实际删除沿 B2，浏览器另验。冻结记录登记展示+候选关闭负例当次2文件3项通过，本 reviewer未重复执行。 |
| 来源重新导入 | 只在完成 COPY、真实 TOMBSTONE 与服务器 ALLOW_REIMPORT 条件下显示；提交 sourceId/expectedGeneration、操作版本及 Session一致性参数，无伪造 provider，不恢复文件或使旧任务有效。跨页选择上限100、摘要和原意图复用维持；名称遮蔽缺口归 P2-01。 |
| 静态可访问性/布局 | 动作为 Button，导航为 Link，radio/checkbox 有名称和关联 label；Tabs/Sheet 沿现有 Radix 语义、标题及焦点围栏，关闭焦点显式返回。主要动作/分页/关闭为44px，Sheet 手机全宽，长标题可换行、底部含安全区与导航偏移。静态未发现其他达到P1/P2的缺陷；320/390px溢出、暗色、Tab方向键/焦点回归和真实隐私切换仍须浏览器验证。 |
| 候选能力 | 已核对实施记录：首次自动审批拒绝后，用户精确答复“授权，仅用于隔离候选验收”，再正规启用。真实常量 true，stage3不变；无client/env后门，旧ISOLATE/RESTORE/PURGE仍关闭。candidate测试不mock contracts，保留兼容Worker前置、严格协议/确认/路径/userId负例和匿名/换账户事务前拒绝；独立关闭fixture保留App/Worker拒绝分支。只用于新合成环境，不推定生产开放；主任务依约处理未通过验收的候选与失败恢复关闭。 |

## 最终旧夹具适配核对

本轮按第三批记录列明的文件核对适配差异，没有扩大到历史全仓故障：

- auth fixture 调真实账户一致性检查，limit负例改为真实上限之外101，userId注入拒绝保留。archive-module 使用原始序列化 proof 和匹配 source row，缺 proof/HOLD 的零业务写负例仍执行真实 guard。
- executor 的 dedup-guard-fixture 只模拟明确的 identity/key/Artwork 查询与 Claim 状态，未知查询抛错；resolver 的缺 proof/HOLD 在 provider前拒绝。原调用与业务断言保留，不将这些 mock 当真实 PG 并发证明。
- maintenance CLEAN 正例登记原 generation/drained、实际 manifest SHA 与正常事务 checkpoint；restart 使用新执行 token。越界/根目录负例仍逐字确认目标内容保留，并新增 begin未调用断言；错误更早在身份边界返回 STATE_CONFLICT，未改生产删除或来源保护逻辑。
- merged-artist-create 增补 Claim/锁模型与顺序断言。`update-artwork-tags.test.ts` 是标签来源语义单测，显式 mock 维护 guard，不能用于宣称 guard在此执行或证明其保护；其真实 guard/Claim 证据沿已通过的B1 PG专项，未修改生产 guard。Worker config只更新已存在的保护目录默认值断言。archive-task-service 的7个helper原样提取至邻近fixture，原业务断言保留；仅keyset PG一项的复验不外推为全44项重跑。

复用实施记录的最终一次全量与有限修复结果：App首次3131通过/18失败/320跳过，35项定向适配通过；executor首次821通过/53失败/291跳过，五文件适配后85个独立用例通过；Worker config单文件5通过。类型、依赖build及定向lint的范围依记录，不把初次失败、跳过、重复跑或mock变成额外通过证据。本次未重跑任何套件，也未运行被排除的旧去重移动套件。

## 收口要求

初审要求的两个P2已一次修复并完成下述限定差异复审。名称隐私标记与保存后组/成员游标恢复的有限代码证据已补齐；其余已通过的B1/B2、四来源/native、规模或整仓测试不要求重跑。最终App typegen/build及Sol/medium真实浏览器由主任务统一，不能被本静态review或mock替代；它们尚未执行本身不构成这两项代码缺陷。

本轮未运行 docs/diagrams，最终文档检查归主任务。未操作现有隔离App/Worker，也未触及真实媒体、用户服务或Git提交。

## 两项 P2 修复差异复审与关闭

2026-10-24，原独立 reviewer、GPT-6.1 Sol / xhigh 只复审4个UI组件、3个现有测试及第三批实施记录最新修复节；未扩审后端、门禁、服务、B1/B2或旧夹具。静态核验充分，未重复运行测试、类型、docs/diagrams或浏览器，唯一写入仍为本记录。

- **P2-01关闭。**`duplicate-operation-preview.tsx:145,167–179` 和 `duplicate-reimport.tsx:77` 将实际文件名、冻结作品名及两处来源名称接入现有 PrivacySensitiveText。角色、文件数、状态和动作仍在标记外；来源 label 与 checkbox 关联保留。preview/actions 测试对动态名称的 data-privacy-sensitive 祖先及状态不遮蔽分别断言，未改辅助技术/复制语义或新增隐私机制。
- **P2-02关闭。**`duplicate-review.tsx:57–69,93–110` 在保存成功/未知响应时回组首页，只将旧查询标 stale，不主动 refetch 旧游标，精确刷新无游标的组/成员首页。向成员组件传递当前 reviewRevision，`duplicate-members-sheet.tsx:39–54` 在 revision 变化的首次 render 已移除旧 memberCursor，再在 effect 同步分页状态，因此没有 effect 前先查询旧 cursor 的窗口。错误页重载也先回首页。saved keeper、跨页删除选择、draft和原幂等意图保留，服务端游标绑定没有放宽。
- `duplicate-review.test.tsx:181–309` 的两个严格 fixture 由真实组件 mutationFn 推进模拟服务 revision；旧 cursor 会抛 INVALID_CURSOR。断言组页2保存后只查询无旧游标的首页，重新翻页使用 r1 cursor、keeper与两组选中范围保留且预览提交新revision；21成员页2保存第21部后回首页，再翻页、再次保存第20部使用正确 reviewVersion，未发出旧memberCursor、未进入错误重试循环。这是组件/React Query证据，不冒称真实PG或浏览器。

实施记录登记相关4文件32项全部通过、App tsc通过、7文件定向lint 0 warning/0 error及diff通过，本reviewer核对了测试断言但没有另跑一轮。Nuqs既有修正维持，未修改后端/gate/服务。没有发现修复引入的新P1/P2或额外代码证据缺口。

**两项P2关闭，B3代码门槛通过。**隐私真实遮蔽、25组/21成员非首页保存、窄屏/键盘/焦点与最终App产物仍由主任务按已有隔离候选验收计划验证；候选true的授权仍仅限隔离验收，不能外推为真实图库开放。

## 浏览器窄屏 P3 的单行差异复审

2026-10-24，原 reviewer、GPT-6.1 Sol / xhigh 仅核对 `packages/pixishelf/app/admin/duplicates/_components/duplicate-group-row.tsx:69` 的 keeper fieldset 添加 `className="min-w-0"` 及其局部上下文。该样式解除 fieldset 的默认最小内容宽度约束，使已有可换行/收缩的成员行能够适应窄屏；保留原 disabled、aria-label、radio 分组和 onKeep 行为，未涉及服务、业务或候选门禁。

**单行修复通过独立差异复审，无新增 P1/P2；B3 代码门槛结论维持通过。**320px 下约7px横溢来自主任务的浏览器发现，本 reviewer未独立复现或测量。本轮未跑测试、build、docs/diagrams或浏览器，只追加本记录。最终唯一 App build 与320px/账户切换的生产产物冒烟由主任务安排；候选 gate=true 仍仅限隔离测试用途。
