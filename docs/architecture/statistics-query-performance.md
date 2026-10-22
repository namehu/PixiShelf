---
status: current
scope: 统计页查询、分区缓存、只读校验与生产启用门禁；生产性能尚未核验
last-verified: 2026-10-14
---

# 统计页查询性能

## 已确认问题与实现

用户生产规模约 19,772 部作品、1,424,154 个文件，首次进入慢、紧接刷新快。
原页面并行执行六项统计后再查询艺术家名称，整页等待最慢查询；结果缓存 60 秒，错误结果也会缓存。
尚未取得生产执行计划，不能将 Image 精确计数认定为已证实的唯一瓶颈。

统计读取现在集中在 `services/statistics-service.ts`，基础指标、文件总数、艺术家与标签排行各自缓存
60 秒，页面用独立 Suspense 边界输出。基础指标共用一次读取；慢文件计数与局部错误不阻塞其他区域。
缓存函数失败会抛出，由展示层转换成局部错误；不缓存假零值或错误对象。Next 时间重新验证可能先返回
旧成功值再后台刷新，60 秒不是严格的新鲜度上限。整个路由仍受既有认证控制。

作品总数仍包含回收站；艺术家总数排除已合并记录；标签总数仍统计全部标签。艺术家排行继续只统计
有有效证据、作品可见且艺术家未合并的归属，一个作品对同一艺术家只计一次。未改变“活跃标签”的既有含义。

## 文件计数启用与回退

`STATISTICS_IMAGE_COUNT_MODE` 未设置、`exact` 或非法值时使用原 `Image.count()`。
只有显式设为 `counter` 才使用单条 SQL：所有 Artwork 的 imageCount 求和，加 artworkId 为空的 Image 数量。
两个子查询共享数据库快照，包含回收站文件；空库返回零。该等式依赖既有语句级触发器和历史计数正确，
不会在每次页面请求时再扫描全库校验，否则无法减少扫描成本。SQL 复用已有联合索引，无新迁移或自动修复。

### standalone 生产部署（无需应用开发依赖）

standalone 产物不保证包含源码脚本、pnpm 或 tsx，不能在应用目录直接运行 `pnpm statistics:diagnose`。
使用独立的 [只读 SQL 文件](../operations/statistics-diagnostics.sql)：在你常用的 PostgreSQL 数据库客户端中
连接生产库，确认 schema/search_path 与应用一致，在同一连接内一次执行整个文件。无需修改或重新打包应用。

如果数据库服务器或运维机器安装了 psql，把该 SQL 文件复制过去，通过 `PGHOST`、`PGPORT`、`PGUSER`、
`PGDATABASE` 和既有密码管理方式配置连接，然后运行：

```bash
psql -X -v ON_ERROR_STOP=1 -f statistics-diagnostics.sql
```

这是 PostgreSQL 客户端命令，不是在 standalone 应用中运行的命令。无需在应用容器安装工具。
SQL 文件包含只读事务、每条语句 30 秒超时、锁等待 2 秒和空闲事务 30 秒超时，最后回滚；不写入数据。
出现错误或超时即校验未完成，应结束该连接或执行 ROLLBACK，并保留 exact 模式。

全部语句成功完成，且结果行 `safe_to_enable = true`，才可启用快速计数；报告包含新旧计数、
`mismatched_artworks`、`triggers_ready` 和两份执行计划。还应核对触发器定义和执行计划。
检查失败不自动修复计数、不禁用触发器，也不清空缓存。

### 源码环境的可选入口

只有在已安装开发依赖、可连接目标数据库的源码仓库中，才能向当前进程显式提供该库 `DATABASE_URL`，然后执行：

```bash
pnpm --dir packages/pixishelf statistics:diagnose
```

未显式提供 URL 时会读取主应用本地环境文件，必须确认目标库，不能将本地通过误认为生产通过。
脚本在 REPEATABLE READ、READ ONLY 事务中检查三个计数触发器的启用状态、事件及处理函数，列出相关索引，
比较新旧总数并逐作品检查计数，最后对两种计数运行 EXPLAIN ANALYZE/BUFFERS。
每条语句最多 30 秒，等待锁最多 2 秒，整个事务最多 180 秒。不修改数据、统计信息或数据库缓存。
执行计划在一致性查询后取得，属于缓冲已预热的测量，不代表冷磁盘或 HTTP 时延。

退出码 0 且 `safeToEnable: true` 是启用前提；还应核对报告中的触发器定义和执行计划。
退出码 2 表示计数或触发器校验未通过；退出码 1 表示检查失败或超时，两者均继续保留 exact。
不要自动修复计数、禁用触发器或清空缓存。所有输出只含数量、结构和查询计划，不输出作品/作者名称或连接凭据。

### 启用与回退

通过后，在启动 standalone `server.js` 的服务环境中设置 `STATISTICS_IMAGE_COUNT_MODE=counter`，
再用原来的方式重启 Web 服务。例如直接用 shell 启动时，可运行 `STATISTICS_IMAGE_COUNT_MODE=counter node server.js`；
使用 systemd、PM2 或容器时，修改对应的服务环境配置。不要假定部署目录存在源码的 `.env.local`。
使用仓库 Compose 模板部署时，在 `build/.env` 设置该变量并重建 Web 容器以注入；
源码本地开发则修改 `packages/pixishelf/.env.local` 并重启 Web。Worker 无需变更。
模式参与缓存键，切回 `exact` 不复用 counter 结果。恢复旧模式或旧应用镜像即可回退，无数据库/媒体恢复步骤。
恢复数据库备份、执行直接 SQL 修复或更改计数触发器后，应先切回 exact 并重新校验。

## 日志与生产复测

- `statistics.query`：实际执行的查询名称、成功状态、耗时，包含数据库连接/连接池等待。
- `statistics.section`：各区域读取（含缓存）的成功状态及耗时。
- `statistics.page`：四个区域全部完成或失败的总耗时与失败数，不等于首屏 TTFB。

同一次独立访问中，只有 section/page 而没有 query 日志说明复用了缓存；过期时 section 可先完成，query
日志随后出现，表示后台重新验证。并发访问的日志可能交错，不把单条查询耗时当作整页网络耗时。
诊断报告是文件计数对照；艺术家关联查询、连接等待是否仍慢应结合分项日志判断，不预先添加索引。

用同网络浏览器访问 `/admin/statistics?entry=direct`，记录首次进入、60 秒内再次进入及超过 60 秒再次进入；
观察响应首字节、指标与排行完成时刻，确认代理没有把流式响应缓冲成整页输出。不清理生产 PostgreSQL 缓存。
分别记录 exact/counter 模式的服务器与浏览器数据；本地合成对照不等于生产提速承诺。

## 验证入口

单元测试使用 Next 真实 `unstable_cache` 配合内存存储适配器，覆盖缓存命中、60 秒重新验证、失败后重试、
旧成功缓存保留、模式隔离、慢文件计数不阻塞其他区域及排行过滤。

PostgreSQL 专项测试只接受本地、数据库名为 `pixishelf_statistics_test_*` 的独立空库。
先在该库执行完整 migration deploy，再显式提供 `STATISTICS_TEST_DATABASE_URL` 运行：

```bash
pnpm --dir packages/pixishelf exec vitest run tests/integration/statistics.postgres.test.ts
```

测试事务最终回滚，覆盖空库、未关联文件、增删与跨作品移动、回收站、排行过滤和只读诊断。
设置 `STATISTICS_BENCHMARK=1` 时额外生成 20,000 部作品和 1,420,000 个文件，预热一次后各测五次，
输出耗时和快速查询计划，并断言文件表只扫描未关联部分，不全扫描已关联文件。
不要将该变量或测试数据库 URL 配置到生产服务中。

## 验证证据

历史数据规模、测量结果及执行记录见[验证记录](../records/architecture/statistics-query-performance.md)。这些测量限定于对应环境与版本，不随当前实现改写。
