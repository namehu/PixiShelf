# PixiShelf 扫描与导入审计历史设计

## 背景

PixiShelf 原本主要通过 `system_jobs` 记录扫描、导入等任务的运行状态。`system_jobs` 更适合做运行锁、进度、取消和后台任务状态，不适合作为长期业务历史和作品级详情的主数据源。

本次改造新增独立审计模型，用于记录扫描历史、导入历史、摘要统计和作品级成功/跳过/失败详情。`system_jobs` 保持原职责；审计历史由 `ScanRun` / `ScanRunItem` 承载。

## 已完成内容

### 第一阶段：Pixiv 扫描审计

新增独立审计表：

- `ScanRun`：一次扫描或导入运行记录。
- `ScanRunItem`：一次运行中的作品级明细。

新增枚举：

- `ScanRunType`
- `ScanRunMode`
- `ScanRunStatus`
- `ScanRunItemStatus`
- `ScanRunItemAction`

已接入入口：

- Pixiv 全量扫描。
- Pixiv 增量扫描。
- Pixiv 客户端列表扫描。
- Pixiv webhook 扫描。
- Pixiv 单作品 rescan。
- 本地作品 rescan。

主要实现点：

- `ScanRun` 和 `system_jobs` 通过可空 `systemJobId` 关联。
- 扫描开始时创建 `ScanRun`。
- 作品明细通过 `createScanRunItemBuffer()` 批量写入，避免每个作品单独写库。
- 扫描完成、失败、取消时更新 `ScanRun` 汇总。
- 设置页新增扫描历史卡片，支持最近一次摘要、历史列表和按状态筛选详情。

### 第二阶段：本地与外部触发导入审计

扩展审计枚举：

- `ScanRunType.LOCAL_IMPORT`
- `ScanRunType.LOCAL_CREATE`
- `ScanRunType.BATCH_IMPORT`
- `ScanRunMode.LOCAL_DIRECTORY_IMPORT`
- `ScanRunMode.LOCAL_CREATE`
- `ScanRunMode.BATCH_CREATE`
- `ScanRunMode.BATCH_REGISTER_IMAGES`

已接入入口：

- 本地目录导入。
- 后台批量导入。
- 本地创建作品。
- webhook scan 的 list 模式补充测试确认。

本地目录导入：

- `localImportRouter.start` 创建 `ScanRun`，并关联 `LOCAL_DIRECTORY_IMPORT` job。
- `runLocalImport()` 接收可选 `audit` hook。
- discovery 中发现的 existing / invalid 目录记录为跳过明细。
- 导入成功记录 `SUCCESS / CREATE`。
- 缺少艺术家映射、媒体扫描失败、写入失败记录为失败明细。
- 取消、失败、完成都会更新 `ScanRun` 状态。

后台批量导入：

- `batchCreateArtworksAction` 返回 `scanRunId`。
- 前端 `BatchImportDialog` 保存 `scanRunId`。
- `batchRegisterImagesAction` 带回同一个 `scanRunId`。
- 创建作品阶段先记录媒体数为 0 的成功 item。
- 图片注册阶段按 `externalId` 更新同一 item 的 `mediaCount` / `newImageCount`。
- 图片注册失败时记录 `FAILED_WRITE` 并标记 run 失败。

本地创建作品：

- 只有 `source === LOCAL_CREATED` 的创建进入审计。
- 普通作品编辑、改标题、改标签、删除等 CRUD 不纳入扫描审计。
- 审计失败只记录日志，不阻断作品创建主流程。

## 数据模型

### ScanRun

用于记录一次扫描、导入或本地创建运行。

关键字段：

- `id`
- `systemJobId`
- `type`
- `mode`
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`
- `totalArtworks`
- `processedArtworks`
- `succeededArtworks`
- `skippedArtworks`
- `failedArtworks`
- `newArtists`
- `newTags`
- `newImages`
- `errorMessage`
- `logRef`

设计原则：

- 业务历史以 `ScanRun` 为主，不依赖 `system_jobs.result`。
- `systemJobId` 只用于关联运行任务。
- `logRef` 预留给未来文件日志，不在当前阶段实现读取。

### ScanRunItem

用于记录一次运行中的作品级处理结果。

关键字段：

- `scanRunId`
- `externalId`
- `title`
- `artistName`
- `relativeDirectory`
- `metadataRelativePath`
- `status`
- `action`
- `mediaCount`
- `newImageCount`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `durationMs`

设计原则：

- 只存相对路径，不存绝对路径。
- 不存 raw metadata。
- 不记录逐 chunk 上传日志。
- 第一版不记录媒体级明细，只记录作品级明细。

## 写入策略

审计写入采用批量和分阶段策略：

- 运行开始：写一条 `ScanRun`。
- 作品明细：通过 buffer 累计后批量 `createMany`。
- Pixiv batch 成功：批量写成功 item。
- Pixiv batch 失败：批量写该批作品 `FAILED_WRITE`。
- 本地目录导入：每个 candidate 的成功、跳过、失败通过 audit hook 进入 buffer。
- 批量导入：创建阶段写 item，注册图片阶段更新 item 媒体统计。
- 运行结束：更新一次 `ScanRun` 汇总。

这样避免 1 个作品 1 次数据库往返。以 10,000 个作品、每批 200 条为例，明细写入约 50 次。

## 涉及模块

数据模型与迁移：

- `packages/pixishelf/prisma/schema.prisma`
- `packages/pixishelf/prisma/migrations/20260624000000_add_scan_audit`
- `packages/pixishelf/prisma/migrations/20260624001000_extend_scan_audit_import_types`

审计服务：

- `packages/pixishelf/services/scan-run-service.ts`

Pixiv 扫描与 rescan：

- `packages/pixishelf/services/scan-service`
- `packages/pixishelf/app/api/scan/stream/route.ts`
- `packages/pixishelf/app/api/scan/rescan/route.ts`
- `packages/pixishelf/app/api/webhooks/scan/route.ts`

本地与批量导入：

- `packages/pixishelf/server/routers/local-import.ts`
- `packages/pixishelf/services/local-import-service`
- `packages/pixishelf/services/batch-import-service.ts`
- `packages/pixishelf/actions/batch-import-action.ts`
- `packages/pixishelf/app/admin/artworks/_components/batch-import-dialog.tsx`

本地创建：

- `packages/pixishelf/server/routers/artwork.ts`
- `packages/pixishelf/services/artwork-service/index.ts`

前端展示：

- `packages/pixishelf/app/admin/setting/_components/scan-history-card.tsx`
- `packages/pixishelf/app/admin/setting/_components/scan-management.tsx`

测试：

- `packages/pixishelf/services/__tests__/scan-run-service.test.ts`
- `packages/pixishelf/services/__tests__/batch-import-service.test.ts`
- `packages/pixishelf/services/local-import-service/__tests__/index.test.ts`
- `packages/pixishelf/app/api/webhooks/scan/__tests__/route.test.ts`

## 验证方式

推荐命令：

```bash
cd packages/pixishelf
pnpm db:generate
pnpm typecheck
pnpm vitest run app/api/webhooks/scan/__tests__/route.test.ts services/__tests__/scan-run-service.test.ts services/__tests__/batch-import-service.test.ts services/local-import-service
pnpm vitest run services/scan-service
pnpm lint
```

数据库迁移：

```bash
cd packages/pixishelf
pnpm db:migrate
```

本地如果只需要快速同步 schema，可使用：

```bash
pnpm db:push
```

手工验证建议：

- 跑一次 Pixiv 增量扫描，确认设置页显示扫描历史。
- 使用 webhook 触发 list scan，确认历史模式显示为客户端列表。
- 跑一次本地目录导入，确认本地导入历史和详情可见。
- 使用后台批量导入，确认创建和图片注册归到同一个历史 run。
- 创建一个 `LOCAL_CREATED` 作品，确认出现本地创建历史。

## 当前已知限制

- `db:generate` 在 Windows 上可能因为 Node / Next dev server 锁住 Prisma `query_engine-windows.dll.node` 失败。处理方式是关闭 dev server、释放相关 Node 进程后重跑。
- 批量导入上传 chunk 不记录逐 chunk 明细，只记录最终作品和图片注册结果。
- 第一版历史详情只有作品级，不含媒体级明细。
- 文件日志 `logRef` 只是预留字段，当前 UI 不读取文件日志。
- 历史保留策略尚未实现，表会持续增长。
- **Pixiv 增量扫描的"已存在跳过"只计入汇总，不写作品级明细（有意设计）。** 增量扫描在发现阶段就用 `existingIds` 把已存在作品过滤掉，不进入 `parseAndCollect`，因此不会生成 `SKIP_EXISTING` 明细。这是为了避免在 10w 级作品库下，每次增量扫描都插入约 10w 条"已存在"脏明细。代价是：增量扫描的汇总 `skippedArtworks` 有数字，但在详情里按"跳过"筛选看不到对应作品行（`completeScanRunSummary` 用 `Math.max(summary.skippedArtworks, counts.skippedArtworks)` 保证汇总数不被明细数拉低）。本地目录导入因作品量级小，仍逐条记录 `SKIP_EXISTING`，两者行为不同属预期。
- **批量导入在"创建作品"阶段结束即标记 `ScanRun` 为 COMPLETED。** 若用户在创建后、上传/注册图片前关闭对话框或刷新页面，会留下一条 `COMPLETED` 但 `newImages = 0`、各 item `mediaCount = 0` 的记录。该记录处于终态、不会触发前端永久轮询，但看起来是"成功却没有图片"的运行。属可接受的边缘场景。
- **`parseAndCollect` 的 `context` 参数可选，不传时审计静默跳过。** 该参数设为可选是为兼容旧调用方；若将来新增调用方忘记传入 `context`，对应的 SKIPPED / FAILED 作品级明细会被静默丢弃而非报错。当前两处调用方（`scan.ts`、`rescan.ts`）均已正确传入。
- **本地创建作品的审计写入成本。** 每条 `LOCAL_CREATED` 作品创建会触发约 4 次数据库往返（`startScanRun` + `appendScanRunItems` + `completeScanRunSummary` 内部的 `groupBy` 与 `aggregate`）。这些记录已通过 `mode != LOCAL_CREATE` 的过滤从历史列表中隐藏，不污染展示，但写入开销仍存在；作品量大时可考虑后续聚合优化。

## 后续 TODO

- 增加扫描/导入历史保留策略：
  - 最近 N 次；
  - 最近 90 天；
  - 或按类型分别配置。
- 增加后台任务化扫描设计：
  - job 存储；
  - progress 订阅；
  - 页面关闭后恢复；
  - 取消传播；
  - 与现有 SSE 兼容迁移。
- 增加媒体级审计可选设计：
  - 仅失败媒体明细；
  - 或按需采样；
  - 避免默认记录过多数据。
- 增加历史详情分页加载更多：
  - 当前后端支持 cursor；
  - UI 第一版只加载固定数量。
- 增加原始日志文件方案：
  - JSONL 或文本日志；
  - DB 只存 `logRef`；
  - UI 按需读取。
- 增加 dashboard/任务中心统一视图：
  - Pixiv 扫描；
  - 本地目录导入；
  - 批量导入；
  - 本地创建；
  - 后续维护任务。
