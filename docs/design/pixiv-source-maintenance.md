---
status: draft
scope: 退役 Pixiv 强制全量重扫，建立增量发现、定向来源同步、来源一致性核对和兼容迁移
last-verified: 2026-08-19
sources:
  - docs/product/product-baseline.md
  - docs/adr/0001-separate-source-references-from-local-identity.md
  - docs/adr/0005-retire-destructive-full-rescan.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/services/media-root-central-service.ts
  - packages/pixishelf-job-contracts/src/payloads.ts
  - packages/pixishelf-job-executors/src/scan/
---

# Pixiv 来源发现、同步与核对设计

本文是尚未实施的功能规格。当前页面、HTTP 契约和 Worker 行为仍以代码与 `current` 文档为准；本文不得被
当成已上线说明。

## 1. 决策摘要

正常产品中退役“强制全量重扫”，将 Pixiv 目录维护拆成三种意图：

| 用户意图       | 默认行为                                           | 是否修改目录数据 | 是否删除领域数据 |
| -------------- | -------------------------------------------------- | ---------------- | ---------------- |
| 扫描新作品     | 遍历目录，只有新、变化或待重试输入进入解析和发布   | 否               | 否               |
| 重新同步来源   | 只刷新一个 Artwork 或明确选中的来源项目            | 否               | 否               |
| 来源一致性核对 | 生成新增、变化、缺失、无效和身份冲突的持久差异报告 | 否               | 否               |

灾难性重建不再是管理页面或 Webhook 能力。若未来确有需求，应在一致性备份后重建到隔离数据库或新 generation，
完成验证后再显式切换，不能原地删除当前目录。

本设计不增加 Worker 进程或 execution lane。三种任务继续使用 `SCAN` 和 `BACKGROUND_WRITER`，与其他媒体写
任务保持全局串行；一致性核对虽然不发布媒体，仍留在 writer lane，避免它与扫描发布争抢同一目录和扫描审计
状态。

## 2. 问题定义

### 2.1 产品模型已经改变

早期 Pixiv 扫描把数据库近似视为一个目录的可重建投影。现在 Artwork 具有稳定的本地身份，并可同时承载：

- Pixiv Source Reference；
- local-import 或页面创建形成的本地状态；
- URL 归档 revision；
- 点赞、系列、Local Override、手工标签和媒体排序；
- 多个可信 Source Reference。

因此“删除 Pixiv 作品后重建”不再只是一次昂贵导入，而是可能破坏不可重建的本地数据和跨来源关系。

### 2.2 当前入口与执行语义不一致

当前设置页仍声明强制扫描会删除并重建 Pixiv 作品；中央 Worker 的 `FULL_RECONCILE` 实际执行以下动作：

1. 遍历并 hash 所有候选 metadata；
2. 对每个已存在 Pixiv Source Reference 使用 `REFRESH`；
3. 成功结束时删除本轮未见到的 Pixiv Source Reference。

也就是说，旧的破坏性产品文案、保留在 App 中的旧执行分支和中央 Worker 的批量刷新已经代表三种不同语义。
继续使用“全量”一词会让用户无法判断将读取什么、更新什么、删除什么。

### 2.3 当前增量并非真正按变化量执行

`INCREMENTAL` 当前只在发布阶段对已存在 Source Reference 使用 `SKIP`。发现阶段仍遍历并计算所有 metadata
文件的 SHA-256，并把完整输入冻结到 ScanRun。作品达到万级后，数据库写入虽然减少，目录遍历、文件读取、
hash 和冻结输入的成本仍随总量增长。

没有文件系统 change feed 时，发现任意层级的新文件仍至少需要一次目录枚举；本设计承诺的是：

- 目录枚举成本为 `O(N)`；
- 内容 hash、parse、媒体收集和领域发布成本接近 `O(Δ + F)`；
- `Δ` 是新增或指纹变化的输入，`F` 是上次未成功且需要重试的输入；
- 不再让普通扫描对全部 `N` 个作品做领域写入。

### 2.4 当前升级兼容 Bug 不能靠删除按钮规避

现有 Pixiv publisher 只删除当前 Source Reference 拥有的 `SOURCE` 标签，再为来源返回的每个标签直接创建
`SOURCE` 行。历史迁移把无法证明归属的关系保留为 `LEGACY`，而 `ArtworkTag` 仍以 `(artworkId, tagId)` 唯一；
同名 `LEGACY` 行会使创建 `SOURCE` 行触发唯一约束错误。

即使移除 `FULL_RECONCILE`，单作品 `ARTWORK_RESCAN` 和选定列表的 `REFRESH` 仍会进入同一 publisher。因此
provenance 兼容必须作为独立修复完成。

## 3. 目标与非目标

### 3.1 目标

1. 正常页面和新 API 不再创建破坏性全量重建或全目录批量刷新任务。
2. 新作品和发生变化的 Pixiv metadata 可以被持续发现并持久处理。
3. 管理员可以显式重新同步一个作品或一组已核对的变化项。
4. 目录缺失、来源变化和身份冲突以持久审计呈现，不自动删除领域数据。
5. 来源刷新只修改该来源拥有的数据，保留 User Curation、Local Override 和其他来源。
6. 扫描任务继续支持持久进度、取消、重试、租约恢复和作品级审计。
7. 旧 `FULL_RECONCILE` 任务在兼容窗口内仍可解释、控制和安全结束。
8. 通过计数和阶段耗时证明普通扫描的高成本工作随变化量而不是总作品量增长。

### 3.2 非目标

- 不把 Pixiv 文件扫描并入 URL Archive Provider。
- 不给 Worker 增加第三个 lane 或提高 writer 并发。
- 第一版不引入 inotify、FSEvents 或平台相关常驻 watcher。
- 第一版来源核对不读取并校验每个原媒体文件的完整内容；它核对 metadata 输入、来源身份和已知媒体计划。
- 不自动解除缺失 Source Reference，不自动删除 Artwork 或原媒体。
- 不在本次改造中彻底重建标签贡献数据模型；先采用保守的 provenance 合并规则。
- 不删除历史 `ScanRunMode.FULL` 行或篡改既有审计结果。

## 4. 领域语义与不变量

### 4.1 三种业务动作

#### 扫描新作品

用户面对的主按钮使用“扫描新作品”，不使用“增量”作为必须理解的产品术语。它处理：

- inventory 中不存在的 metadata；
- 文件 `size + mtime` 变化且内容 hash 与上次成功值不同的 metadata；
- 当前内容从未成功发布的失败输入。

已存在且快速指纹未变化的输入不读取内容、不 parse、不收集媒体、不进入 publisher，也不逐条写 `SKIP_EXISTING`
审计行；ScanRun 只保存聚合计数。

#### 重新同步来源

这是显式写操作，只接受以下冻结目标之一：

- 一个 Artwork 的唯一 Pixiv Source Reference；
- 一个来源核对报告中选中的 `NEW` 或 `CHANGED` 项；
- 受信客户端提交的明确 metadata path 列表。

提交时冻结 path、外部身份和内容 hash；执行时再次验证内容未变化。变化后的输入以
`STALE_SOURCE_INPUT` 跳过并要求重新核对，不拿旧报告覆盖新文件。

#### 来源一致性核对

第一版是 catalog-safe 的快速核对：遍历 metadata，比较持久 inventory，并只对新文件或快速指纹变化的文件
计算 hash 和 parse。结果分类：

| 分类                | 含义                                               | 默认动作           |
| ------------------- | -------------------------------------------------- | ------------------ |
| `NEW`               | 新 path 或新 Pixiv 身份                            | 可选“导入选中项”   |
| `CHANGED`           | 已知 path 内容变化                                 | 可选“同步选中项”   |
| `MISSING`           | inventory 中存在，但完整核对未发现                 | 只提示，不自动处理 |
| `INVALID`           | metadata 无法安全读取或解析                        | 修复文件后重新核对 |
| `IDENTITY_CONFLICT` | path、metadata identity 与 Source Reference 不一致 | 阻止写入，人工处理 |
| `UNCHANGED`         | 快速指纹未变化                                     | 只计数，不写明细   |

“只读”是指不修改 Artwork、Media、Source Reference、标签、系列、点赞或原媒体。核对仍会写 SystemJob、ScanRun、
inventory 观测值和差异审计，这是可观察与可恢复所必需的操作记录。

### 4.2 空目录、失败和取消

- scan root 不存在、不可读或根目录身份变化：任务失败或进入 `ACTION_REQUIRED`，不得生成 `MISSING` 结论。
- 完整核对发现零 metadata：进入 `ACTION_REQUIRED`，不得把全部 inventory 标成缺失。
- 达到安全上限、目录遍历不完整或任一页面未冻结：核对失败，不执行缺失差异的最终提交。
- 取消只保存已完成的发现进度；没有“核对完成”标记时不得发布 `MISSING` 结果。
- 单个无效输入可以形成 `INVALID` 差异；基础设施错误不能伪装成一批业务无效文件。

### 4.3 来源刷新拥有权

Pixiv 刷新必须按下表限制写入范围：

| 数据                           | 刷新策略                                                             |
| ------------------------------ | -------------------------------------------------------------------- |
| Pixiv Source Reference         | 更新 canonical locator、metadata hash、fetchedAt；身份不可改变       |
| Source Snapshot / raw evidence | 追加或复用不可变快照，保留原始来源证据                               |
| title / description            | 仅在对应 override flag 为 `false` 时更新                             |
| 来源统计和类型字段             | 可更新 bookmark、source date、restriction、Pixiv 类型等来源派生字段  |
| Artist                         | 现有 Artwork 默认保留；在明确建模 Artist override 前不由批量刷新改写 |
| 现有 Media path 与本地顺序     | 不删除、不重排；相同 path 可更新可验证的来源属性                     |
| 新发现 Media                   | 可追加，必须通过现有 root/path/媒体限制验证                          |
| 来源中不再出现的 Media         | 形成核对差异，不自动删除 Image 或原文件                              |
| SOURCE 标签                    | 只替换当前 Source Reference 明确拥有的标签                           |
| MANUAL / DERIVED / LEGACY 标签 | 永不由来源刷新删除或改写                                             |
| likes、Series、其他来源        | 永不修改                                                             |

若未来要求来源刷新更新 Artist 或本地媒体顺序，必须先增加可靠的 Local Override/来源排序模型和历史数据迁移，不能通过
扩大 publisher 的 `update` 对象顺手实现。

### 4.4 保守的标签兼容规则

在不改变现有 `(artworkId, tagId)` 唯一约束的第一阶段，来源标签按以下算法合并：

1. 删除当前 `sourceRefId` 拥有、但不在新来源集合中的 `SOURCE` 行；
2. 对每个新来源 tag 使用 `(artworkId, tagId)` 幂等 upsert；
3. 已存在行属于当前来源时保持不变；
4. 已存在行属于 `MANUAL`、`DERIVED`、`LEGACY` 或其他来源时保持原归属，不转换、不删除；
5. 完整来源标签仍保存在 Source Snapshot，因此没有通过强行改 provenance 来制造错误证据。

该规则优先保护用户数据。代价是一个与历史 `LEGACY` 重合的来源标签不会在 `ArtworkTag` 上记录当前来源贡献。
若未来需要多个 Source Reference 同时声明同一有效标签，应另行设计来源贡献表，而不是放宽唯一约束后让查询返回重复标签。

## 5. 持久输入库存

### 5.1 新模型

新增扫描器专用的 `PixivMetadataInventory`，不把 URL Archive Intake 塞入同一模型。建议字段：

```text
id
relativePath                 unique
externalId                   nullable, indexed
sizeBytes                    bigint
mtimeMs                      bigint
observedContentHash          nullable sha256
processedContentHash         nullable sha256
lastAttemptedContentHash     nullable sha256
externalRefId                nullable, onDelete SetNull
lastSeenAuditRunId           nullable
lastAttemptedAt              nullable
lastProcessedAt              nullable
lastErrorCode / lastErrorSummary
createdAt / updatedAt
```

含义：

- `observedContentHash` 表示最后一次稳定读取到的内容；
- `processedContentHash` 只在对应领域发布成功后推进；
- 两者不同表示仍有变化未成功应用；
- `lastAttemptedContentHash` 防止失败记录丢失，但不使失败输入永久跳过；
- inventory 是扫描优化和诊断事实，不拥有 Artwork，也不能级联删除 Artwork。

`ScanRunMetadataInput` 增加冻结的 `sizeBytes` 和 `mtimeMs`。现有 `contentHash` 保持可空：普通增量只冻结需要处理
的有 hash 输入；一致性核对可冻结全部 path/stat，并仅为变化项写 hash。

### 5.2 增量算法

```text
安全枚举 metadata path + stat
        |
        v
按 page 查询 inventory
        |
        +-- 同 path、size、mtime、上次成功 ----------> unchanged 计数
        |
        +-- 新 path / stat 变化 / 上次未成功
                 |
                 v
          稳定读取 + SHA-256
                 |
                 +-- hash == processed hash ----------> 只更新 inventory stat
                 |
                 +-- hash 不同 -----------------------> 冻结为 ScanRun input
                                                          parse + collect + publish
                                                          成功后推进 processed hash
```

目录枚举、冻结和发布都分页进行；单次数据库事务只处理一个输入或一个小批量 set-based inventory 更新。文件读取、
hash 和媒体收集不放在长事务中。

### 5.3 核对算法

核对先完成并冻结整个 path/stat 快照，再生成差异。只有以下条件全部成立，才能在最终 fenced transaction 中把
未见 inventory 分类为 `MISSING`：

- scan root 身份与启动时相同；
- 遍历完整且未达到条目上限；
- 输入 count/digest 验证通过；
- 任务没有 PAUSING/CANCELLING；
- 本次 audit 尚未终态提交。

`MISSING` 只写 ScanRunItem 差异，不删除 `ArtworkExternalRef`。未变化项不逐条写 ScanRunItem，以避免万级审计
噪声；ScanRun 保存总数和分类计数。

## 6. 任务、契约与接口

### 6.1 Job contract

继续使用 `SCAN` job type 和 `BACKGROUND_WRITER` lane。目标 payload 形态：

```ts
type ScanPayload =
  | { mode: 'INCREMENTAL' }
  | { mode: 'CONSISTENCY_AUDIT'; verification: 'FAST' }
  | { mode: 'CLIENT_LIST'; existingPolicy: 'SKIP' | 'REFRESH'; inputCount: number; inputDigest: string }
  | { mode: 'ARTWORK_RESCAN'; artworkId: number }
  | { mode: 'FULL_RECONCILE' } // compatibility only; no new producer
```

`FULL_RECONCILE` 在兼容阶段必须继续被 parser、Worker capability 和任务控制台识别。新管理页面、Webhook 和
服务不再创建该 payload。待审计确认不存在非终态和可重试的 legacy payload 后，后续 cleanup 才能移除 executor
分支；历史 `ScanRunMode.FULL` 枚举和值永久保留可读。

### 6.2 管理接口

管理 UI 最终使用明确命令，不再向组件暴露 `force: boolean`：

```text
scan.startDiscovery()
scan.startConsistencyAudit({ verification: 'FAST' })
scan.refreshArtworkSource({ artworkId })
scan.refreshAuditItems({ auditRunId, itemIds, idempotencyKey })
```

所有写入口使用当前单实例管理员边界，返回稳定 DTO，不返回 Prisma record、绝对路径或内部异常原文。批量同步为
逐项结果，允许 `APPLIED / SKIPPED / CONFLICT / FAILED`，不能用一个输入失败回滚已完成的其他输入。

### 6.3 HTTP 与 Webhook 兼容

`POST /api/webhooks/scan` 是日常自动化的主力入口，必须保持长期 transport 兼容。实施本设计不要求调用方修改：

- URL、Bearer Token 和 `SCAN_WEBHOOK_TOKEN`；
- 生产实际使用的 `type=list`、`metadataList` 和可选 `force` 请求体；
- POST 成功时的 HTTP `202` 与 `jobId / scanRunId / status / reused` 字段；
- `GET /api/webhooks/scan?jobId=...` 的轮询方式和既有终态字段。

Webhook 的 GET 和 POST 职责必须保持分离：

- `GET /api/webhooks/scan` 不触发扫描；无 `jobId` 时只做健康检查，带 `jobId` 时只读任务状态；
- `POST /api/webhooks/scan` 才校验请求并创建扫描任务。

服务端按以下规则处理现有 POST 请求：

| 请求                     | 行为                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `{}`                     | 保留为目录增量发现的兼容请求                                      |
| `type=full, force=false` | 映射为变化感知的 `startDiscovery`                                 |
| `type=full, force=true`  | 拒绝并返回稳定 `FULL_SCAN_RETIRED`，不创建任务                    |
| `type=list, force=false` | 冻结明确路径；新身份可以导入，已存在 Source Reference 使用 `SKIP` |
| `type=list, force=true`  | 冻结明确路径；已存在 Source Reference 使用安全的定向 `REFRESH`    |

`force` 在 `list` 模式下不是无效参数。对于列表中的新作品，`SKIP` 和 `REFRESH` 都会创建，因此两者看起来相同；
只有列表包含已存在作品时才产生差异：`false` 跳过，`true` 重新同步该作品的 Pixiv 来源。这个定向刷新是本设计保留
的安全能力，不等同于全目录强制扫描。

生产 Webhook 已经提供明确 metadata path 列表，相当于外部 change feed。该路径直接冻结并处理 `k` 个输入，不需要
服务端再次遍历全部 `N` 个 metadata，也不依赖阶段 2 的 inventory 才能保持高效。inventory 主要优化设置页的目录
扫描，并为来源一致性核对提供持久比较基线。

既有状态响应字段保持含义可用：`totalArtworks` 仍表示发现的候选总数，unchanged 可聚合到
`skippedArtworks`，`processedArtworks` 在完成时仍覆盖本次候选；hash 和 publish 计数只作为可选新增字段。不得要求
旧调用方读取新增字段才能判断任务终态。

新管理接口使用显式 intent，避免继续扩散 `force` 这个含混名称；Webhook 的 `list + force=false/true` 作为已部署
自动化契约长期保留，不把客户端迁移作为本改造的上线前提。全目录 `force=true` 不属于该兼容承诺。

## 7. 页面与交互

### 7.1 设置页

扫描卡片调整为：

- 主按钮：`扫描新作品`；
- 次要入口：`来源一致性核对`；
- 删除 `强制全量重扫`、destructive confirmation 和“删除并重建”文案；
- 显示最近一次扫描的枚举数、变化数、hash 数、发布数和耗时；
- active legacy FULL job 仍显示真实历史类型并允许取消，但不能复制或再次创建。

### 7.2 核对结果

来源核对页或 Drawer 提供：

- `NEW / CHANGED / MISSING / INVALID / IDENTITY_CONFLICT` 计数；
- 按分类筛选和 cursor 分页；
- `NEW` 与 `CHANGED` 当前页多选；
- `导入选中项` / `同步选中项`；
- `MISSING` 只展示定位和建议，不提供一键删除；
- 结果过期或文件指纹变化时显示 `结果已过期，请重新核对`。

批量动作必须显示逐项结果和部分成功。选择范围第一版只支持显式 item IDs 或当前已加载页，不支持“选择所有未知
分页结果”。

### 7.3 作品页

Pixiv Source Reference 明确且 metadata path 可验证时显示 `重新同步 Pixiv 来源`。操作说明列出会更新与不会更新
的数据，不再使用“重扫作品”这种可能被理解为删除重建的表述。本地导入作品继续走自己的 local rescan，不经过
Pixiv publisher。

## 8. 可观察性与性能

ScanRun/SystemJob 记录以下聚合指标，避免为 unchanged 输入制造万级明细：

```text
walkedEntries
metadataCandidates
inventoryUnchanged
contentHashed
contentChanged
parsedInputs
publishedInputs
failedInputs
missingInputs
discoveryDurationMs
hashDurationMs
publishDurationMs
```

验收以工作量不变量为主，而不是对未知 NAS 宣称固定秒数：

- 10,000 个稳定 metadata 的普通扫描允许遍历/stat，但内容 hash、parse 和 publisher 调用必须为 0；
- 其中 6 个发生变化时，hash/parse/publish 数量应与 6 和失败重试项同阶；
- 没有 audit 明确完成时，`missingInputs` 必须为 0；
- 任何正常扫描和核对都不得调用 Artwork、Media 或 Source Reference 的批量删除。

在发布前用生产规模的脱敏目录副本记录基线：总文件数、目录枚举耗时、hash 数、数据库写入数、峰值 RSS 和任务总
耗时。该证据用于发现退化，不写成跨硬件 SLA。

## 9. 分阶段实施

### 阶段 0：独立兼容修复

- 修复 Pixiv publisher 的 provenance 幂等合并；
- honor `titleOverridden` / `descriptionOverridden`；
- 现有 Artwork 刷新不改 Artist、不重排或删除已有 Media；
- 补 `LEGACY / MANUAL / SOURCE`、Local Override 和多来源隔离测试。

该阶段修复当前错误，独立提交，不依赖 inventory 或 UI 改造。

### 阶段 1：停止创建全目录刷新

- 设置页移除强制按钮和旧文案；
- 保留并修复 legacy executor，使已入队任务可以安全结束；
- App 服务禁止创建新的 `FULL_RECONCILE`；
- 全目录 `type=full, force=true` 返回 `FULL_SCAN_RETIRED`；
- 保留 Webhook `list + force=false/true` 的 URL、认证、请求和响应 contract，并增加兼容回归测试；
- 更新 Webhook、安全矩阵和当前页面文档。

这是可快速降低风险的产品切换，不包含数据库 migration，也不要求生产 Webhook 调用方改造。

### 阶段 2：真正增量的 inventory

- expand migration 增加 `PixivMetadataInventory` 与冻结 stat 字段；
- discovery 按 page 比较 inventory，只 hash/freeze 变化与失败项；
- publisher 成功与 inventory `processedContentHash` 在同一 fenced transaction 推进；
- 增加阶段计数、性能基线和恢复测试。

旧代码可以忽略新表，因此 migration 本身不越过不可回退边界。

### 阶段 3：来源一致性核对与选定同步

- 增加 `CONSISTENCY_AUDIT` payload、ScanRun mode/action 和差异查询；
- 增加设置页核对入口、结果页和显式选择；
- apply 时重新验证冻结身份与 hash；
- missing 只报告，不自动解绑或删除。

新 App 只有在新 Worker READY 且 capability audit 通过后才开放 audit producer。

### 阶段 4：兼容清理

- 审计数据库中 `FULL_RECONCILE` 的 PENDING/RUNNING/PAUSED/RETRY_WAIT 任务；
- 处理完或由管理员明确取消后，删除内部 FULL producer；保留 Webhook list 契约；
- 删除中央 executor 的 FULL 分支和旧 App 进程内 force-reset 分支；
- 保留历史 DTO 对 `ScanRunMode.FULL` 的展示；
- 将本 draft 的已实施事实提炼到 current 功能和架构文档。

破坏性 contract 清理不得与阶段 2 的 expand migration 放在同一不可回退发布中。

## 10. 回滚与恢复边界

- 阶段 0 只有保守 publisher 修复，可通过应用/Worker 镜像回滚；不会批量改写历史 provenance。
- 阶段 1 没有 schema 变更；回滚 UI 不得重新开放未修复的全目录刷新。
- 阶段 2 是 expand-only；回滚旧应用时保留 inventory 表，不清空、不降级 migration。
- 阶段 3 的核对只写 operational/audit 数据；回滚不需要撤销领域数据。
- 任何显式来源同步沿用 SystemJob、ScanRun 和文件快照恢复边界。
- 若发布过程中出现来源身份或原媒体不一致，先停止 scheduler/App/Worker 保存现场，再按
  [备份与恢复基线](../operations/backup-and-recovery.md)处理；不得用全量重扫作为事故恢复捷径。

## 11. 测试与验收矩阵

### 11.1 单元与 contract

- 新旧 payload 解析，旧 FULL 只可由兼容层读取、不能由 producer 创建；
- 旧 HTTP 请求归一化与 `FULL_SCAN_RETIRED`；
- inventory 指纹分类和 digest；
- 来源字段拥有权矩阵；
- provenance 合并：同名 LEGACY/MANUAL 不冲突、不转类、不删除；
- audit result 过期与批量选择状态。

### 11.2 真实 PostgreSQL

- `observedContentHash` 与领域发布失败时不推进 `processedContentHash`；
- publisher、ScanRunItem、inventory 和 SystemJob 的 fenced 终态原子一致；
- 同一输入重试不重复创建 Artwork、Image、Source Snapshot 或标签；
- 多来源 Artwork 刷新 Pixiv 时，其他 Source Reference 与 archive revision 不变；
- 完整 audit 成功才生成 MISSING；空根、取消、租约丢失和遍历上限均不能生成 MISSING；
- 并发手工标签修改与来源刷新不会触发 P2002 或丢失手工关系；
- legacy FULL job 在新 Worker 上仍能解析和安全终态。

### 11.3 文件系统 fixture

- 10,000 个 unchanged metadata：全量 stat、零内容 hash、零 parse、零领域发布；
- 新增、内容变化、只改 mtime、删除、重命名、无效 JSON、身份不匹配；
- metadata 在冻结后变化时 apply 返回 stale，不发布；
- scan root 临时不可用和中途取消；
- 新媒体追加，但旧媒体缺失时只报告、不删除。

### 11.4 UI 与人工验证

- 设置页不存在强制全量重扫入口；
- 扫描新作品关闭页面后继续，重新打开可恢复状态；
- 核对结果分页、筛选、当前页选择和部分成功；
- MISSING 没有一键删除；
- 历史 FULL 记录显示“历史来源核对（已停用）”，不显示可重新运行按钮；
- 浏览器验证一条新作品、一个变化作品、一个缺失输入和一个 provenance 兼容作品。

每个实现阶段先运行窄测试，再运行受影响 package 的 typecheck/lint/test/build；涉及 migration、队列 fencing 和
文件状态的阶段必须使用隔离 PostgreSQL 与临时目录。阶段代码完成后先做项目一致的必要注释补充，再进入独立审查，
所有 P0/P1 修复并回归通过后才进入下一阶段。

## 12. 完成标准

本设计只有在以下条件全部满足后才能从 `draft` 提炼为 current：

1. 正常 UI、Webhook 和服务无法再创建 `FULL_RECONCILE`，生产 Webhook 的 list 请求无需修改；
2. provenance 升级兼容和 Local Override 测试通过；
3. unchanged 规模 fixture 证明 hash/parse/publish 为 0；
4. audit 不对 Artwork、Media、Source Reference 或原媒体执行删除；
5. missing、取消、空根和遍历不完整的安全门禁有真实 PostgreSQL/文件 fixture 证据；
6. 旧非终态 FULL job 已清空或由管理员显式处理，历史记录仍可读；
7. 当前产品、架构、安全、测试、Webhook 和运维文档已按实际上线行为更新；
8. 生产规模脱敏副本的性能数据、发布检查点和回滚证据已登记。
