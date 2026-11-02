---
status: current
scope: Pixiv 目录发现、inventory、来源一致性核对与选定发布
last-verified: 2026-10-22
sources:
  - packages/pixishelf-job-executors/src/scan/
  - packages/pixishelf/services/media-root-central-service.ts
  - packages/pixishelf-job-contracts/src/payloads.ts
---

# Pixiv 来源维护

本文描述当前扫描执行机制。在线获取 Pixiv 资料是另一条[来源同步链路](../features/pixiv-artwork-online-sync.md)。当前代码状态不代表生产发布已核验。

## Pixiv 扫描链路

### 入口与模式

- 管理页普通扫描和兼容的 full Webhook 创建 `INCREMENTAL`。
- Webhook `type=list` 创建 `CLIENT_LIST`，对已有来源使用 `SKIP`；公开请求体中的 `force` 字段已退役。
- 单作品重扫创建 `ARTWORK_RESCAN`。
- 破坏性 `FULL_RECONCILE` 已退出 App producer、`SCAN@v1` contract 和 Worker executor；历史终态记录只读保留。

![pixiv-scan](../diagrams/architecture/pixiv-scan.svg)

[Mermaid 源文件](../diagrams/architecture/pixiv-scan.mmd)

`ScanRun` 是扫描领域审计，不是第二套队列。`SystemJob` 管执行控制，`ScanRun` 管输入快照、逐项结果、作品/图片数量和耗时。

INCREMENTAL 的目录发现会统计经过的所有目录项，包括媒体文件。Worker 默认用
`SCAN_DISCOVERY_MAX_ENTRIES=10000000` 约束完整遍历；metadata 候选/冻结行另受 100000 行限制。两个上限必须
分开理解：前者防止异常目录无限遍历，后者限制单次数据库快照规模。
遍历默认不进入 SCAN_PATH 根目录直属的 `local-imports`、`sources`、`.archive-staging` 和 `.trash`，避免把本地
导入及归档文件纳入 Pixiv 发现成本；`SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES` 可提供完整替代清单。

### 发布批次、统计与计时

普通 Pixiv 扫描继续使用默认并发 4，每个作品独立提交 fenced transaction，并保留作者目录锁、来源身份检查和逐项恢复边界。
新图片先收集，再在同一作品事务内按最多 500 张执行 `createMany`；图片插入不使用 `skipDuplicates`，身份冲突必须使该作品回滚。
新增数量取数据库实际插入数。已有图片保留 ID 和顺序，新图片接在现有最大 `sortOrder` 之后，扫描不删除缺席媒体。
已有图片仍先检查摘要与动画来源是否失效，只有最终图片字段发生变化才执行原位更新；章节摘要未变化时保留 `chaptersUpdatedAt`。
新作品的默认已读初始化在全部图片批次插入后执行，仍属于该作品事务。

来源标签按名称集合查询，只批量创建缺失的 `general` 标签，再集合认领当前来源明确声明的 LEGACY 关系并批量补齐关联。
标签及关联允许利用唯一约束跳过重复，不改写已有标签属性；仅删除当前来源过期的 SOURCE 关联。人工、派生、其他来源归属和 AI 生成标签规则保持来源所有权边界。

`INCREMENTAL / CLIENT_LIST / ARTWORK_RESCAN` 在首次执行前初始化适用的解析、发布、失败计数与发布耗时。
恢复旧的未完成任务时，缺失的计数由持久单项检查点重建，再按结果转换更新，重放不重复累计。
`CLIENT_LIST / ARTWORK_RESCAN` 未执行目录发现，其发现、哈希指标继续允许为空；已执行历史的未知耗时也保持为空，不回填已经结束的任务。

单项 `startedAt / finishedAt / durationMs` 描述该次实际处理尝试，成功、跳过和失败都在结算事务内采样，耗时使用单调时钟。
`finishedAt` 是事务内检查点的结算采样时间，并非数据库提交完成时间；完成检查点重放保留原计时。
`publishDurationMs` 累加已持久发布尝试从申请发布事务到库存结算采样前的耗时，包含该事务的获取与围栏检查，排除提交尾部；并发作品的耗时之和不能当作墙钟耗时。
`ScanRun.durationMs` 则是运行开始到终态的墙钟差，恢复同一运行时可能包含暂停、重试等待。

每项完成后只输出一条结构化耗时日志，包含 job/run/ordinal、媒体数量、检查点读取、目录准备、元数据读取校验、媒体枚举、事务获取、前后围栏、body、提交尾部和提交后的总耗时。
未进入的阶段保持未知，回滚事务不伪造成功提交观测；日志不包含绝对路径或元数据正文。
隔离库对比方法与测量边界见[扫描发布性能记录](../records/scan-publication-performance-2026-11-02.md)。

### 来源一致性核对

设置页可以创建 `SCAN@v2` 的 `CONSISTENCY_AUDIT`。App 在共享的 SCAN singleton lock 内复核 Pixiv inventory
baseline 已处于 `READY`、存在新鲜 READY 且声明 `SCAN@v2` 的 Worker，并原子创建 SystemJob、ScanRun 和 queued
event；日常目录扫描、单作品扫描和 Webhook 仍走上面的 `SCAN@v1` 链路，调用方不需要修改。Worker 先冻结完整且
非空的 metadata path/stat 快照，再分类 `NEW / CHANGED / MISSING / INVALID / IDENTITY_CONFLICT /
UNCHANGED`。它只写 operational/audit 记录和 inventory 观测，不发布 Artwork、Image、来源引用、标签、Source
Snapshot 或媒体。

`MISSING` 只允许在完整遍历、未达到安全上限、冻结 count/digest 和扫描 root 身份全部复核通过后，由持有任务
fence 的 finalizer 生成；中断、取消、空目录或 root 变化都不会产生缺失报告。运行中页面只轮询安全摘要；只有
ScanRun 与 SystemJob 都进入 `COMPLETED` 后，独立结果页才开放绑定 run/filter 的 cursor 明细查询。

#### 选定同步

下图按管理员、控制面、Worker 与数据库分泳道；核对只写观察证据，选定同步才允许领域发布。

管理员只可在结果页当前已加载页选择 1–50 个仍为 eligible 的 `NEW / CHANGED`；两类可以用一个“同步所选来源”
动作混合提交。App 在共享 SCAN singleton lock 内重新验证核对已完整完成、inventory generation 未变化、来源根
可用且存在新鲜 READY 的 `SCAN@v3` Worker，然后原子创建 `SCAN@v3 / AUDIT_APPLY`、独立 apply ScanRun、冻结输入
和 PENDING 单项。`sourceAuditRunId` 只保存父核对的证据 ID，不建立可跟随变化的领域外键。

![pixiv-audit-apply](../diagrams/architecture/pixiv-audit-apply.svg)

[Mermaid 源文件](../diagrams/architecture/pixiv-audit-apply.mmd)

apply 不是 `CLIENT_LIST` 的别名。v3 Executor 逐项重新比较 metadata 内容、stat、inventory、ExternalRef 和 Artwork
身份；stale 或冲突项目零领域写入，其他项目可以继续，因此一次 job 可以完成但包含逐项失败。页面刷新后从
operation ID 恢复持久结果。一个核对项已经 APPLIED、非 stale SKIPPED、STALE、CONFLICT 或永久失败后不能从同一
核对重复提交；只有可重试失败（例如媒体在核对后暂时缺失）能在修复后从同一核对再次提交。`MISSING / INVALID /
IDENTITY_CONFLICT` 永不进入 apply，`MISSING` 也永不触发解绑或删除。

普通 Pixiv 扫描和 v3 apply 共用 publisher。成功发布会更新 `ArtworkExternalRef.metadataHash`，并按 metadata hash
追加或复用不可变 `ArtworkSourceSnapshot` 的规范化与原始来源证据。刷新只更新来源拥有的数据：尊重标题/描述
override，保留 Artist、MANUAL/DERIVED、未被当前来源再次确认的 LEGACY 与其他来源标签、现有媒体顺序，不删除不再出现的媒体。当前 Pixiv 元数据明确包含的同名 LEGACY 标签会认领为该 Pixiv 引用的 SOURCE 标签。

`AUDIT_APPLY` 对取消与保留有额外的证据完整性约束：

- PENDING、RETRY_WAIT 或 PAUSED 的 v3 apply 被直接取消前，命令层先验证 job payload、apply ScanRun、冻结输入与
  单项集合完整；随后在同一事务中取消 job 和 ScanRun，把未完成项记为可重试的 `OPERATION_CANCELLED`，并保留
  已完成项。
- RUNNING apply 先进入 CANCELLING，由 Executor 在 fence 下终态化尚未完成的项目和 apply ScanRun；任务完成前
  不能留下没有逐项结果的终态 operation。
- `SCAN_RUN_RETENTION_CLEANUP` 在共享 SCAN lock 内复核核对/apply 关系。父核对存在非终态 apply 时整组保留；
  只有父核对符合过期或溢出条件且关联 apply 都终态时，才删除父核对及这些终态 apply，避免留下无证据来源的
  operation 或过早删除核对证据。

## 根身份、库存与历史

根身份使用 `.pixishelf-root` 稳定 UUID，路径变动不得使另一个媒体根复用既有库存；重挂载、旧库绑定与标记恢复见[扫描根身份](../features/pixiv-root-identity.md)。inventory 区分观测 hash 与已发布 hash；只有领域发布和 processedContentHash 在同一 fenced 事务提交，才能标记处理完成。首次建立可信基线后仍枚举并 stat，但仅新文件、指纹变化和可重试失败读取内容。

回滚、旧 FULL 队列审计及实施证据保留在[历史设计](../archive/design/pixiv-source-maintenance.md)，当前升级操作以[部署基线](../operations/deployment.md)为准。
