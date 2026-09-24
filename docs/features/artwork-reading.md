---
status: draft
scope: 本地作品的账户级有效阅读、媒体进度、继续阅读、筛选与最近阅读，以及本功能的隔离验收记录
last-verified: 2026-09-24
sources:
  - docs/design/artwork-reading-tracking.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/prisma/migrations/20260924130000_add_artwork_reading_tracking/
  - packages/pixishelf/server/routers/reading.ts
  - packages/pixishelf/services/reading-service.ts
  - packages/pixishelf/lib/reading/
---

# 作品阅读记录与进度

本页记录本地作品阅读功能的用户语义与验收证据。功能正在隔离环境验收，不能据此推断生产实例已经迁移或发布。实现约束及完整验收矩阵见[架构设计](../design/artwork-reading-tracking.md)。

## 用户行为

- 阅读记录按账户隔离，同账户跨设备共享。详情长图、自适应预览、独立原图预览和沉浸阅读使用同一计数规则；原站缩略图预览不计入。
- 手动浏览要求媒体加载成功、页面在前台且媒体真实可见满 500 ms；自动浏览在当前媒体成功展示时立即计入。预加载、遮挡弹层、离屏、后台和加载错误不计入。隐私遮罩不停止记录。
- 同一作品的有效阅读活动间隔超过 30 分钟才增加一次访问次数。刷新、切换浏览模式和短时间回访沿用同一次访问；有效心跳只延长已有活动，不能创建首次访问。
- 进度按完整作品的不同逻辑媒体计数。既有 APNG/视频分组的成员共同代表一个展示项；跳读只增加实际看过的项，不把最大序号前面的项推定为已读。零媒体作品不判为已看完。
- 普通打开从头开始；用户显式选择“继续阅读”才跳到最后有效位置。最后媒体已不存在时优先定位第一个未读项，否则回到开头。
- 卡片与详情显示当前账户的未看、阅读中、已看完及进度；最近阅读按最后阅读时间排序。阅读状态筛选与原有筛选、排序组合时使用稳定游标。列表里已显示的卡片只原位更新标记，刷新后才重新套用筛选顺序。

## 数据变化与恢复

迁移 `20260924130000_add_artwork_reading_tracking` 为现有 `Artwork` 增加默认值为 1 的 `mediaRevision`，新增账户作品摘要与已读媒体集合；不回填过去的阅读。没有记录的旧作品显示未看，不代表过去从未阅读。软删除保留记录；永久删除通过外键级联清理。

普通媒体增删、排序保留仍存在的已读媒体，下次打开时校正进度快照。完整替换、恢复或全量重建在同一事务中递增版本并清空该作品所有账户的阅读摘要、次数、已读集合与恢复位置；迟到的旧版本上报被拒绝。媒体写入与阅读上报统一先锁作品，再处理媒体或阅读状态。客户端的待发送事件不构成持久离线队列，强制关闭或持续断网可能丢失最后尚未提交的一批。

发布前应建立数据库、原媒体、派生媒体、配置和镜像的一致检查点，随后使用 `db:generate` 与 `db:deploy`，禁止 `db:push`。回滚代码时保留新列和表，并暂停旧版本的完整重建写入者；若旧版本已经重建作品，重新升级前须核对受影响作品、清空其旧阅读数据并递增版本。影响范围无法确认时不得直接恢复阅读功能。详见[备份与恢复](../operations/backup-and-recovery.md)。

## 隔离验收记录

截至 2026-09-24，以下结果仅来自本任务新建的 PostgreSQL 15 容器和合成 fixture：

| 检查 | 结果 |
| --- | --- |
| 空库迁移 | `reading_empty_baseline` 从空 PostgreSQL 执行完整 85 条正式 migration，成功；初始作品数为 0。 |
| 已有库升级前检查点 | `reading_existing_upgrade` 原有 84 条 migration，3 个 Artwork、3 个 Image、2 个 UserBA；custom-format dump 已通过 `pg_restore --list` 可读性检查，SHA-256 为 `CA3AACFC9DC97FA38064BFF8F33BD21BDA24CABB71E117C8E608D25B7C31D5E8`。 |
| 已有库升级 | 仅执行 `pnpm --filter @pixishelf/db db:deploy`，只应用阅读迁移；升级后 85 条 migration，原有 3/3/2 行仍在，三个作品的 `mediaRevision=1`，两张新阅读表均为空。 |
| 媒体生命周期与上报 | 隔离 PostgreSQL 测试已覆盖 App 完整替换、回滚、普通增删/排序、Worker 替换发布/恢复、乱序多设备 VIEW、混合已删除媒体事件。 |
| 50,000 作品规模 | `reading_perf` 填充 50,000 Artwork、200,500 Image、50,000 阅读摘要和 110,098 已读媒体，两账户；33 个阅读状态×排序组合连续翻页及边界作品退出候选集后续页通过。服务端并发、版本失效、删除、重建及账户隔离通过；测试后合成记录已清理。 |
| 查询耗时 | 同一合成数据下，默认/广条件/艺术家升序/随机种子的卡片端到端查询，原路径与阅读筛选分别为 12.9/19.9、94.1/78.6、287.2/93.8、37.0/66.5 ms；随机多约 29.5 ms，仍低于旧随机 100 ms 门槛。独立阅读摘要单查询 3.7 ms，最近阅读 8 查询 13 ms。广条件和艺术家绝对耗时较旧 25 ms 基线高，但旧基线选择率不同；同数据对照显示阅读筛选未使这两类查询恶化。完整 EXPLAIN 与 33 组合结果保存在 ignored `backend-performance-full.json`、`backend-performance.json`。 |
| 工程门禁 | App 全量单元/组件测试 343 文件、2,159 例通过，21 文件、132 例跳过；新增邻图预加载停留时间回归 2 例、列表空态后重新测宽回归 4 例通过。浏览器修复收口后的 `lint` 零警告、`typecheck` 和提升权限的 `build` 均成功。Worker 及其依赖包 `typecheck`、`test`、`build` 均成功。隔离库集成测试 3 文件、13 例通过，2 文件、6 例跳过。 |
| 真实浏览器：阅读入口 | 在隔离 Edge、`reading_browser` 和合成静态 PNG 上，详情、自适应预览、独立原图、沉浸 viewer 四入口均有 HTTP 200 阅读上报与数据库记录；原图文件流返回 PNG 200。零媒体作品在 viewer 展示 6.5 秒未产生上报或阅读摘要。首轮列表因账户初始空态后未重新测宽而无卡片，修复后 4 张卡片及徽标可见。原图首轮 500 是隔离库缺少 `Setting.scanPath`，补齐 fixture 后原文件流通过，未改原图源码。 |
| 真实浏览器：进度与门禁 | 未读筛选的在屏卡片原位更新徽标，最近阅读新增记录；普通重开 18 页作品从头开始，显式“继续阅读”定位到数据库保存的第 2 页媒体。前台媒体完全离屏 65 秒的两轮实测中，上报数和数据库 `lastActiveAt` 均不变，回到视口后新 VIEW 成功。受控 `visibilitychange` 模拟隐藏 65 秒同样无上报或数据库变化，恢复后新 VIEW 成功。 |
| 浏览器覆盖边界 | headless Edge 切换 tab 后旧页 `document.hidden` 仍为 false，因此**真实后台标签页**未覆盖；仅有受控模拟及组件测试证据。视频、动画媒体、跨标签页 Cookie 账户切换和所有筛选×排序组合的浏览器遍历未覆盖；账户隔离与筛选游标另有单元测试、真实 PostgreSQL 集成和 50,000 作品矩阵证据。viewer 既有候选列表可先落在零媒体作品，用户须选有媒体作品继续阅读；零媒体项不产生阅读。 |

备份、命令日志、浏览器脚本和截图位于本地 ignored 验收目录 `packages/pixishelf/.local-data/reading-validation/`；其中含隔离环境凭据，不应发布到仓库或公开附件。关键截图包括 `entry-adaptive-second.png`、`explore--artworks-preview-artworkId-1-index-2.png`、`viewer-empty-no-reading.png`、`viewer-completed-reading.png`、`chain-unread-before.png`、`chain-unread-return.png`、`chain-history-after.png`、`continue-real-reopened-start.png`、`continue-real-target.png`、`gate-offscreen.png` 和 `gate-visibility-return.png`。最终构建后已停止本任务隔离 App 与 PostgreSQL、ImgProxy 容器，保留可复用的脚本、测试数据库、日志和备份；没有触及现有图库、数据库或生产部署。

现有 `image-count.test.ts` 在隔离集成测试的 `afterAll` 中尝试直接删除仍被作品引用的 Artist，数据库按现有外键拒绝并输出清理错误；测试断言通过。遗留的两组该测试合成作品和本次生命周期测试留下的无主合成 Image 已核对 ID、路径及隔离库后清理，未修改业务代码或其他数据库。

## 范围外

本功能不回填历史阅读，不提供手动标记、重置、批量修改、访问流水、统计仪表盘、视频秒级进度或持久离线队列。访问次数不用于权限判断，也不改变原媒体的备份责任。
