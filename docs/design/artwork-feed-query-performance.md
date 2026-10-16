---
status: current
scope: 作品浏览筛选链路、索引随机分页、诊断与隔离性能验证；生产性能未核验
last-verified: 2026-10-16
---

# 作品浏览筛选与查询性能

## 当前链路与边界

作品页 URL／快捷筛选快照 → `InfiniteArtworkList` → `artwork.cardList` → Zod 和会话账户校验 → 筛选 SQL → 当前页 ID → 卡片与封面批量补全。艺术家、标签详情复用此链路。

沉浸浏览经 `artwork.viewerFeed` 转换为相同筛选输入；随机模式共享 ID 选择器，随后加载本页完整媒体。作品详情自身的“只看未读媒体”使用阅读进度链路，不进入此作品候选排序。

后台管理 `artwork.list` 保留精确计数和页码契约。浏览 `cardList` 不返回 total，不执行总数查询；作品页、艺术家作品区和标签作品区均删除依赖它的数量文案。多取一条判断下一页，不新增异步计数请求。

| 条件     | 语义与数据库路径                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 关键词   | 非精确时匹配标题、描述、有效创作者名称、Pixiv 创作者身份和来源映射名；精确时匹配作品标题                                       |
| 创作者   | 使用有有效证据的创作者关系；管理接口另支持名称精确匹配                                                                         |
| 标签     | 多标签 ID 必须全部包含；标签名列表任一匹配，排除标签名使用 NOT EXISTS                                                          |
| 来源     | Artwork.source 创建来源枚举                                                                                                    |
| 时间     | 原始日期和入库日期独立范围；结束日期包含当天，不改变既有数据库日期解释                                                         |
| 媒体     | 视频为存在 VIDEO；图片为不存在 VIDEO，仍可含动图；动图按持久类型或探测结果；扩展名、音频、数量保留原语义                       |
| 阅读     | 未读：不存在当前账户 seenCount > 0 摘要；阅读中：0 < seenCount < totalCount；已读完：totalCount > 0 且 seenCount >= totalCount |
| 管理扩展 | 本地 ID、外部 ID／storageKey、精确匹配、Pixiv 身份与核对状态；不向浏览 UI 额外暴露                                             |
| 排序     | 标题、有效创作者、媒体数、原始日期回退入库日期、入库日期、随机；均保留 ID 决胜规则                                             |

## 随机顺序与分页

固定 `md5(id::text || ':artwork-random-v1') COLLATE "C"` 作为随机键，配合 ID 建立仅覆盖活动、未删除作品的部分表达式 B-tree 索引。seed 的 MD5 派生随机起点；先读取键大于等于起点的一段，再读取小于起点的一段，只回绕一次。两个区间分别 LIMIT，不用一个 CASE 排序整个结果集。

这是一套固定乱序的随机起点，不是每个 seed 对全库独立洗牌；相邻作品可能相似，候选稀疏时多个 seed 也可能落到同一结果。已有 seed 的顺序会在本次升级后改变。索引随作品写入自动维护，不创建随机后台任务、账户随机表或全库结果缓存。

随机路径的多标签条件逐个使用 EXISTS，使随机索引能在候选满足全部标签后提前结束；普通排序保留原分组候选策略，两者集合语义相同。

卡片和 viewer 新增 randomCursor／nextRandomCursor。游标携带版本、起点、阶段、最后键和 ID，并绑定账户、seed 和规范化条件；不包含标题等内容。先验证再查询，不接受旧 readingCursor 充当随机游标，也不接受随机 OFFSET 页码。错账户、错条件或旧版本返回 `ARTWORK_RANDOM_CURSOR_INVALID`；客户端清空整条无限查询并从首屏恢复一次，重复失败显示原错误，不追加一个新首屏。非随机游标行为不变。

固定候选集完整遍历不重不漏；动态浏览时已删除、已读等不符合条件的项不再进入后续页，游标不依赖边界行仍存在。新增或重新符合条件的项仅在尚未遍历的区间可出现，不承诺数据库快照。seed=0 有效；缺失时客户端生成并在此次浏览保持稳定。快捷筛选不保存游标。

## 封面与查询成本

卡片的基本字段、创作者和标签按当前页补齐。封面使用 LATERAL 子查询，按 Image(artworkId, sortOrder, id) 索引每作品 LIMIT 1；原 APNG 与同名视频伙伴解析、视频海报语义保留。避免 ORM 关联 take 的实际读取量依赖客户端裁剪。沉浸浏览仍按需读取本页完整媒体。

宽条件随机查询可沿索引较早取足一页。稀疏标签、艺术家、媒体或文本条件仍可能要求更多候选探测，不能把所有筛选都承诺为常数成本。SQL 字符数不是性能指标；应分别测 ID 选择、媒体补全和 HTTP 等待。

## 只读诊断

主应用目录执行 `pnpm artwork:diagnose /absolute/path/input.json`。输入为列表查询 JSON，必须包含 sortBy=random、randomSeed 和 expectedUserId；账户只用于诊断阅读条件，CLI 不提供公开 API。显式 DATABASE_URL 优先，否则按标准本地配置读取。

诊断在只读事务内运行，单语句超时 15 秒、事务上限 60 秒；测量 ID 选择、卡片补全、服务总耗时，并分析两个随机区间。报告仅保留执行计划节点、索引名与耗时／缓冲区统计，不输出条件表达式、SQL 参数、账户明文、结果 ID、标题、路径或凭据。计划是在服务查询后采集的热缓存证据，不包含 HTTP、代理、连接排队以外的网络耗时，也不声称清空了磁盘缓存。输入文件应保留在本地、不提交版本库。

## 迁移与回退

`20261016090000_artwork_browse_indexes` 增加随机部分表达式索引和封面复合索引，不改业务行、字段或阅读含义。部分表达式索引由 SQL migration 管理，Prisma Schema 只描述普通封面索引。正式部署按备份恢复文档建立一致检查点、停写后 db:deploy；普通 CREATE INDEX 会阻塞写入，不能作为无停机部署承诺。先部署索引再运行新版本；回退应用可保留新增索引，无须删除阅读记录或还原媒体。

## 验证记录（2026-10-16）

生产示例为十万级作品的“未读＋随机”首屏。已配置的生产连接只读诊断两次超时，尚无生产执行计划和提速数据。隔离 PostgreSQL 验证与实际测量结果见下方交付记录；不得将旧 5 万作品结果作为当前生产验收。

### 隔离数据库实测

复现入口（主应用目录）：`BROWSE_PERF_DATABASE_URL=<专用测试库连接串> pnpm exec vitest run tests/integration/artwork-browse-performance.postgres.test.ts`。测试拒绝非 `127.0.0.1:55434/browse_perf` 数据库；先在该空库执行正式 `db:deploy`。测试会创建／清理 `browse-perf-` 合成记录，并在事务内重建本轮两个索引用于非空迁移演练，因此只能用于专用可丢弃测试库，不能复用业务库。普通单元测试和 CI 不自动执行此性能套件。

Apple M1 / 8 核 / 16 GiB，Docker PostgreSQL 16.14（aarch64）。5 万、10 万、20 万作品分别配置约 20 万、40 万、80 万媒体，另有一部 3,001 页作品；三个账户的已读比例为 0%、50%、99%。保留实际触发器和索引，ANALYZE 后分别执行一次预热及 20 次采样。以下是未读＋随机（seed 73476、24 卡片、50% 已读）热缓存 p95；最终矩阵没有与全量测试／构建并行。

| 作品数  | 旧动态随机：选 ID | 新索引随机：选 ID | 新卡片服务（含补全） |
| ------- | ----------------: | ----------------: | -------------------: |
| 50,000  |          44.73 ms |           2.05 ms |             11.75 ms |
| 100,000 |          79.99 ms |           1.90 ms |              9.20 ms |
| 200,000 |         195.78 ms |           4.54 ms |             21.51 ms |

旧、新选 ID 范围一致；旧卡片首屏还包含精确计数，其成本未计入上表，因此不将选 ID 提速倍数当作完整 HTTP 提速。10 万作品的 100 页连续遍历验证无重复，0%／50%／99% 已读账户均返回 24 张卡片；99% 已读账户单次卡片服务约 14.8 ms。真实网络、NAS 磁盘冷缓存、生产数据库统计信息和高并发排队尚未覆盖。

标签＋媒体格式＋日期组合仍可能选择全候选关联与排序：5 万／10 万／20 万规模单次卡片服务约 113／168／190 ms；这类组合没有达到宽条件同等级提速，不能宣称所有随机筛选都走有界索引扫描。单独多标签在同次测量下约 12／14 ms（5 万／10 万），较此前随机路径全量聚合明显改善。

94 条正式迁移从空库成功部署，Schema 校验与 migration status 通过。10 万作品、40 万媒体的非空库中，重新建立两个新增索引约 0.39 秒（本机值，不代表生产锁等待）。回归覆盖四类阅读条件、seed=0、完整回绕、边界删除／转已读、新作品进入、账户／条件／游标隔离、无结果、组合筛选、卡片与 viewer 一致、3,001 页作品限量封面和视频海报 UTC 版本。四项数据库测试通过；合成数据已清理。

只读 CLI 在隔离空库实际运行成功。机器可读报告位于 ignored `.local-data/browse-performance/report.json`，包含首次观测、采样 p95、密度与组合场景和执行计划；首次观测也不是清空系统缓存后的冷读。生产数据库连接仍不可达，生产性能未核验。

主应用最终 lint（0 错误／警告）、typecheck、test（393 文件／2615 用例通过，27 文件／175 用例按环境跳过）和提升权限 build 均通过；Prisma validate／generate／status、路径大小写检查及 diff 空白检查通过。性能套件另行完成，不能把上述跳过项视为数据库验收。真实浏览器补充验证见下节；没有生产 HTTP 性能测量，没有操作生产数据库或发布镜像。

### 真实浏览器补充验证

2026-10-16 使用 Codex 内置 Chromium，桌面 1280×720 与移动视口 390×844，访问当前代码的本地 Next 开发实例并使用 `entry=direct`。移动结果为视口模拟，不是 Android 或 iOS 真机验收。专用 PostgreSQL 16 数据库配置 180 部合成作品、360 张临时 JPG；初始为 144 未读、6 阅读中、30 已读完。独立 ImgProxy 只挂载合成图片目录。回环诊断代理记录浏览器实际发出的 `cardList`／`viewerFeed` 响应 ID 和游标，不记录认证请求头。

| 实际操作                             | 响应结果                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| 桌面未读＋随机连续滚动到终点         | 6 页，每页 24，共 144 个唯一 ID，零重复，末页无下一游标                                 |
| 桌面切换为已读完                     | 2 页，24＋6，共 30 个唯一 ID；回到顶部且没有混入旧未读分页                              |
| 桌面未读＋Warm 关键词进入沉浸浏览    | 实际浏览到第 23 部，跨过 20 部批次；两批共 40 个唯一 ID，首批与卡片前 20 个 ID 完全一致 |
| 移动未读＋随机，seed=0，滚动到终点   | 6 页，24×5＋1，共 121 个唯一 ID，零重复，末页无下一游标                                 |
| 移动从筛选列表进入沉浸浏览并连续上滑 | 实际浏览到第 23 部；两批共 40 个唯一 ID，首批与卡片前 20 个 ID 完全一致                 |

两个沉浸浏览阶段各产生 23 部真实阅读，未读数由 144 变为 121、再变为 98；最终数据库为 98 未读、52 阅读中、30 已读完，与账户阅读语义一致。桌面和移动封面均实际加载成功；移动为双列卡片，页面宽度与视口同为 390px。移动列表和沉浸浏览切换为视频条件后均显示空状态，清除列表筛选后恢复普通时间倒序。

浏览器发现 seed=0 打开筛选后直接应用会被误判为缺少种子，现已将共用筛选抽屉的假值判断改为 nullish 判断。邻近 6 项组件测试、lint 和 typecheck 通过；移动列表再次应用以及沉浸浏览切换条件均保留 seed=0。

快速滚动的有限诊断窗口捕获到 20 条 `reading.summaries` tRPC 控制台 error 日志，代理同时记录 18 条该接口的客户端响应连接提前关闭；该窗口已记录的上游响应均为 200。浏览器日志 API 将错误对象折叠，不能逐条确认 message／code 或将全部日志都归因于取消，因此不声称全程控制台零错误。本轮没有出现列表／沉浸浏览错误界面，全部记录的 feed 响应为 200；未进一步修改这项日志行为。

本地证据保存在 ignored `packages/pixishelf/.local-data/browser-browse-20261016/`：`summary.json`、分场景响应、`http-responses.jsonl`、`console-diagnostic.json`、`client-aborts.jsonl` 和桌面／移动截图。完成后停止本轮 Next、诊断代理、独立 ImgProxy 与专用 PostgreSQL 容器，保留 fixture 和证据可复查。未覆盖生产 HTTP、NAS 媒体、真实手机触摸环境、真实视频／动图播放和错误游标的浏览器故障注入。

## 历史基线（2026-08-12，旧实现）

以下为历史查询方案的数据，包含已被本轮移除的首屏计数和动态 seed 排序，不再是当前接口契约。

### Dataset and scenarios

- 50,000 artworks, 200 artists, 300,000 artwork-tag relations, 200,000 media rows, and 16,666 video metadata rows.
- Indexes mirror the relevant Prisma schema indexes, including artwork source date, artwork-tag pairs, artwork-media path, media type, and video metadata.
- The complex filter combines two required tags, source type, audible video, video media type, source date, and database-created date.
- Timings below cover database selection only. Media hydration, response serialization, and network transfer must still be measured in the target deployment when investigating an incident.

### Baseline and result

| Query                                   |                   Before |     After |                         Acceptance |
| --------------------------------------- | -----------------------: | --------: | ---------------------------------: |
| Card list default first-page count      |                 6.014 ms | unchanged |                           <= 25 ms |
| Card list default first-page IDs        |                 0.075 ms | unchanged |                           <= 25 ms |
| Card list ordered page at offset 25,000 |                 6.612 ms | unchanged |      <= 25 ms at this dataset size |
| Complex viewer exact count              | 239.686 ms on every page |   removed | no `COUNT(*)` in Viewer page query |
| Complex viewer page selection           |                58.674 ms | 15.261 ms |                           <= 25 ms |
| Stable random page selection            |                63.808 ms | unchanged |                          <= 100 ms |

The multi-tag predicate now starts with the selective `ArtworkTag(tagId, artworkId)` index, groups matching artwork IDs once, and joins the remaining filters to that candidate set. Previously it ran a correlated aggregate for thousands of candidate artworks. Viewer pagination now requests one extra row to determine `nextPage`, so it no longer repeats an exact count that the UI never displays.

### 历史回归门禁

- Unit tests require grouped multi-tag SQL and reject the former correlated predicate.
- Viewer service tests require exactly one raw page-selection query, no `COUNT(*)`, one batch media query, one batch tag query, and one batch like-status query.
- Card list tests preserve its first-page-only count and later-page overfetch behavior.
- Stable random ordering remains an `O(n)` scan and top-N sort because its seed is dynamic. Revisit the random pagination strategy before treating 100,000+ artwork libraries as a supported performance target.
