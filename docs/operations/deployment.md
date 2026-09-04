---
status: current
scope: PixiShelf 当前本地运行、生产 Compose 拓扑、升级顺序、验证与回滚入口
last-verified: 2026-09-01
sources:
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
  - build/.env.example
  - build/Dockerfile
  - build/worker.Dockerfile
  - build/entrypoint.sh
  - scripts/update-production.sh
---

# PixiShelf 部署基线

本文是当前部署操作入口。Dockerfile、Compose 和 `.env.example` 决定精确服务与配置；一次性切换记录只用于复用审查、备份和回滚门禁。

## 支持范围

标题关键词来源发布使用 `20260904180000_add_archive_title_search` expand migration。先停止所有旧写入者并按[备份与恢复](./backup-and-recovery.md)建立一致性检查点，确认发现扫描全部终态，再执行 `migrate deploy`；禁止 `db:push`。配套 App/Worker 必须一起升级，两个 lane READY 且 capability audit 精确为 28 类/31 个版本组合后才开放入口。

新增类型数据存在时，旧 App/Worker 不能直接回滚运行。优先保留兼容版本并停用关键词来源、关闭新入口或前向修复；完整降级必须恢复配套数据库、媒体、配置和镜像检查点。当前实施与未完成的生产验证见[标题关键词实施记录](../design/e-hentai-title-keyword-scan.md)，本机测试不代表生产已部署。

- 本地开发：PostgreSQL、ImgProxy、通用 Worker 在 Docker 中运行，Next.js 在宿主机运行；
- 生产部署：单机 Docker Compose，原媒体和派生媒体使用宿主机目录挂载；
- 数据库：PostgreSQL 15；
- 应用与 Worker：Node.js 20 镜像；
- 主应用端口：5430；ImgProxy：5431；PostgreSQL：5432；Worker 健康端口仅在容器网络内使用 3011。

本文不承诺 Kubernetes、多副本 App、并行 Worker 或多租户部署。

## 当前服务拓扑

| 服务        | 数据权限                   | 当前职责                                                           | 生产稳态           |
| ----------- | -------------------------- | ------------------------------------------------------------------ | ------------------ |
| `postgres`  | 数据库读写                 | 领域数据、认证、队列、租约和 migration 历史                        | 必需               |
| `app`       | 数据库读写；原媒体默认只读 | Next.js Web/API、认证、任务控制面；启动时部署 migration            | 必需               |
| `worker`    | 数据库和媒体读写           | 单进程双 lane；28 个 job type，SCAN v1/v2/v3、ARCHIVE_IMPORT v1/v2 | 必需，固定一个服务 |
| `scheduler` | 无数据库权限               | 使用内部 Token 调用 App 的 scheduler tick                          | 按需启用           |
| `imgproxy`  | 原媒体和派生媒体只读       | 图片缩放、格式处理和缓存                                           | 必需               |

生产 Compose 不再包含旧 `archive-worker`、旧镜像或兼容 profile。一个 `worker` 容器同时托管固定并发为 1 的 `ARCHIVE_RESOLVE` 和 `BACKGROUND_WRITER`；最多一项解析和一项 writer 工作可以同时推进，所有媒体写仍在 writer lane 全局串行。

归档媒体内部并发不是环境变量。它保存在 PostgreSQL `Setting` 中，由管理后台以 1–8 显式保存；缺失时默认 2。发布、Compose 和 `.env.example` 不需要增加对应键。恢复数据库会同时恢复该设置；Worker 在每次归档启动、恢复或重试时读取并冻结。

## 环境文件边界

| 场景           | 文件                            | 数据库地址                             |
| -------------- | ------------------------------- | -------------------------------------- |
| 宿主机 Next.js | `packages/pixishelf/.env.local` | `127.0.0.1:5432` 或 `localhost:5432`   |
| Docker Compose | `build/.env`                    | Compose 在容器内覆盖为 `postgres:5432` |

必须核对：

- `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 与 `DATABASE_URL` 一致；
- `PIXISHELF_DATA_PATH` 指向真实原媒体目录；
- `DERIVED_MEDIA_HOST_PATH` 使用持久化绝对路径；
- `PIXISHELF_PUBLIC_DATA_PATH` 指向既有 `pixiv_data` 持久化绝对路径，并在容器内统一挂载到 `/app/pixiv-data`：App 只读、Worker 读写；
- `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`BETTER_AUTH_TRUSTED_ORIGINS` 符合实际入口；
- `INTERNAL_JOB_TOKEN` 与 `SCAN_WEBHOOK_TOKEN` 使用彼此独立的强随机值；
- `INIT_ADMIN_USERNAME`/`INIT_ADMIN_PASSWORD` 当前不参与自动初始化，遗留 `JWT_SECRET` 也不负责当前浏览器会话；
- `CENTRAL_DISPATCHER_CUTOVER_ENABLED` 与 `WORKER_DISPATCH_ENABLED` 始终成对切换；
- 生产反向代理使用 HTTPS，清除外部 `x-user-session`/`x-pathname`，并将 `NEXT_PUBLIC_IMGPROXY_URL` 限制在受信网络或等效保护路径。
- 反向代理对 `/api/jobs/events` 禁用响应缓冲和转换，保留长连接；应用已发送 `X-Accel-Buffering: no` 与 `Cache-Control: no-cache, no-transform`，代理仍需允许至少 15 秒心跳穿过。

不要提交 `build/.env`、`.env.local`、数据库备份、访问令牌或生产路径。

## 本地开发

标准流程维护在根 [README](../../README.md#本地开发)。固定顺序是：

1. 复制并配置两份环境文件；
2. 只启动 PostgreSQL 和 ImgProxy；
3. 生成 Prisma Client，并用 `db:deploy` 部署完整 migration；
4. 构建并启动通用 Worker，验证 READY 和 capability；
5. 在宿主机启动 Next.js；
6. 需要自动调度时再启用 `scheduled` profile。

普通启动和升级禁止使用 `db:push`。全新数据库也使用完整 migration 链，以便 Worker 预检能够确认 `_prisma_migrations`。

## 生产发布前门禁

每次升级都必须先完成：

- 记录当前 App、Worker 的 tag、image ID 或 digest；
- 确认只有预期消费者在运行，不存在无法解释的 RUNNING/PAUSING/CANCELLING 任务；
- 停止 scheduler，阻止新的计划任务物化；
- 创建同一时间点的 PostgreSQL 备份、原媒体快照、派生媒体快照和环境配置备份；
- 在隔离位置确认数据库备份可读取，媒体快照路径可访问；
- 检查磁盘余量、目录权限和 FFmpeg/FFprobe 可用性；
- 阅读目标版本 migration，确认是否存在不可逆数据变更；
- 对执行 lane 迁移运行 `archive:lane-cutover-audit`，阻断执行中的任务、活跃旧全局 lease、新鲜旧 Worker、执行中归档和新 Worker 不支持的等待任务。
- 安装不再支持 `FULL_RECONCILE` 的 Worker 前，使用下文的只读数据库命令确认该 payload 在所有非终态状态中的
  数量为零；这个一次性 contract 门禁由发布人员执行，不扩展通用升级脚本，也不可用 `--force` 绕过。
- 在应用 lane migration 前移除同一 Compose project 中的 orphan 服务，并用容器标签确认旧 `archive-worker` 容器数量为零。数据库审计无法发现仍存活但空闲的旧消费者，不能替代这项容器门禁。

备份位置、校验值和镜像 digest 必须记录在本次发布记录中。“命令成功”不能代替恢复验证。
完整备份集合、停写检查点和隔离恢复演练见[备份与恢复基线](./backup-and-recovery.md)。

### 艺术家外部身份版本的附加门禁

首次部署 `ArtistExternalRef` 和 `PIXIV_ARTIST_ENRICHMENT` 时还必须：

1. 把 PostgreSQL 与 `PIXISHELF_PUBLIC_DATA_PATH` 纳入同一一致性检查点；
2. 在旧数据库运行只读 `packages/pixishelf-db/prisma/diagnostics/artist-source-identity-audit.sql`，保存自动认领、重复数字 ID、无来源证据数字 ID 和 `p_` ID 计数；
3. 停止 App/Worker 写入后执行 `prisma migrate deploy`，再运行 `artist-external-ref-verification.sql`；其中 `missing_expected_claims` 和 `duplicate_provider_identities` 必须为零；
4. 先启动新 Worker，确认 READY 且 capability 精确为 28 个 job type / 31 个 type-version 组合，再启动新 App；
5. App 开放后先选择少量已确认艺术家试跑，核对 `artist_external_refs` 状态、`pixiv_data/artists/<user-id>/` 文件和受鉴权图片 URL；通过后再启动全部符合条件艺术家的连续补全；显式多选仍最多 200 个；
6. 重复 ID、无作品 Pixiv 来源证据的数字 ID 和 `p_` ID 只保留在审计结果中，不能通过生产 SQL 批量猜测认领。

旧 `Artist.userId` 本版本不会删除。只有稳定运行一个发布周期并确认回滚镜像、旧消费者和导出工具不再读取它后，才允许使用独立 migration 做物理清理。

### Pixiv 作品在线同步版本的附加门禁

首次部署 `PIXIV_ARTWORK_ENRICHMENT` 时还必须：

1. 在停写窗口把 PostgreSQL 与 `PIXISHELF_PUBLIC_DATA_PATH` 纳入同一一致性检查点；后者包含 `artworks/<pixiv-id>/metadata/` 不可变 JSON 快照，并新增 `sync-reports/<job-id>.json` 同步报告；
2. 使用目标 App 镜像执行 `prisma migrate deploy`，确认 `20260826143000_add_pixiv_artwork_online_sync` 已登记完成；不得用 `db:push` 代替；
3. 先启动 Worker 并确认 capability 包含 `PIXIV_ARTWORK_ENRICHMENT@v1 / BACKGROUND_WRITER`，再开放包含新任务入口的 App；
4. 先选择少量未检查作品，以默认模式核对来源字段、标题保护、精确 SOURCE 标签差异、数据库状态、磁盘快照和 `sync-reports` 文件，并从作品列表打开同步记录抽屉验证字段/标签差异及前后 JSON；
5. 再用少量作品验证“刷新已有资料”，确认标题和描述会采用 Pixiv 当前值，同时任务期间的新人工编辑不会被覆盖；
6. 上述证据通过后，才启动全部未检查作品。刷新全部会逐项处理所有有效 Pixiv 身份，可能持续较长时间，但 writer lane 并发仍为 1。

### Pixiv 系列来源身份版本的附加门禁

首次部署 `SeriesExternalRef` 和 `PIXIV_SERIES_RECONCILIATION` 时还必须：

1. 在停写窗口把 PostgreSQL 与 `PIXISHELF_PUBLIC_DATA_PATH` 纳入同一一致性检查点；系列核对会读取其中的作品 metadata 快照；
2. 在旧数据库运行只读 `packages/pixishelf-db/prisma/diagnostics/series-source-identity-audit.sql`，保存来源分布、重复 Pixiv 系列 ID、单作品多系列数量、direct/join 漂移和强证据候选；
3. 使用目标 App 镜像执行 `prisma migrate deploy`，确认 `20260827090000_add_series_external_refs` 已登记完成，再运行 `series-external-ref-verification.sql`；所有 invalid/duplicate 计数必须为零；
4. 先启动 Worker，确认 capability 包含 `PIXIV_SERIES_RECONCILIATION@v1 / BACKGROUND_WRITER`，再开放新 App；
5. 先从任务中心对少量作品执行系列核对，验证同名不同 ID 不合并、`SOURCE`/`MANUAL` 关系不互相覆盖、作品详情可显示多个系列，以及本地排除不会被普通核对恢复；
6. 通过后再从系列管理页连续核对全部未检查作品；刷新全部会恢复来源标题和来源顺序，但任务期间发生的新人工编辑仍优先保留。

旧 `Artwork.seriesId`、`Series.source` 和 `Series.externalId` 本版本不会删除。只有新关系稳定运行一个发布周期并确认旧消费者不再读取后，才能用独立 contract migration 清理。

## 一键生产升级

日常生产升级优先使用仓库内的一键脚本。它把 App 与通用 Worker 作为同一个发布单元：先检查执行中的后台任务，拉取两份镜像，停止写入者，以一次性 App 容器执行 `prisma migrate deploy`，再启动 Worker 并通过 READY/capability 门禁，最后启动 App。脚本只显式编排 `app`、`worker` 和原本已在运行的可选 `scheduler`。

从部署目录执行：

```bash
sudo bash ./scripts/update-production.sh
```

脚本优先使用当前目录的 `docker-compose.yml` / `compose.yml`；在仓库根目录执行且没有默认 Compose 文件时，会自动使用 `build/docker-compose.deploy.yml` 和同目录 `.env`。也可以显式指定：

```bash
sudo bash ./scripts/update-production.sh \
  --compose-file build/docker-compose.deploy.yml \
  --env-file build/.env
```

默认行为和参数：

- 查询 `system_jobs`，发现 `RUNNING`、`PAUSING` 或 `CANCELLING` 时拒绝升级；`--force` 明确允许通过 Worker drain 路径中断这些任务；
- 默认同时拉取 `app` 和 `worker`；`--no-pull` 仅用宿主机已有镜像强制重建；
- 记录 scheduler 原始状态，只在升级前本来就在运行时恢复它；
- 任一 migration、健康检查、READY 或 capability 门禁失败时保持 scheduler 停止，不自动假装回滚成功；
- `--wait` 只能证明容器 healthcheck 通过，脚本还会额外执行 Worker READY 和 capability audit。

发布前一致性备份仍是独立门禁，不能由“镜像更新成功”替代。可以把实例自己的 PostgreSQL dump、NAS 原媒体快照、派生媒体快照和清单校验封装成可执行文件，再作为停写窗口内的 Hook：

```bash
sudo PIXISHELF_PRE_UPDATE_HOOK=/absolute/path/pixishelf-backup-checkpoint.sh \
  bash ./scripts/update-production.sh
```

未配置 Hook 时脚本会明确警告，但不会伪造备份证据。完整备份集合和验证要求仍以[备份与恢复基线](./backup-and-recovery.md)为准。

### 退役 FULL contract 审计

首次安装移除 `FULL_RECONCILE` executor 的版本前，在生产部署目录执行以下只读查询。它直接使用 PostgreSQL
容器中的生产用户和数据库名，不要求宿主机存在目标版本源码：

```bash
sudo docker compose \
  --env-file .env \
  -f docker-compose.yml \
  exec -T postgres \
  sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "$1"' sh \
  "SELECT id, status, \"definitionVersion\", \"createdAt\", \"availableAt\", \"workerId\", error
   FROM system_jobs
   WHERE type = 'SCAN'
     AND payload->>'mode' = 'FULL_RECONCILE'
     AND status IN ('PENDING', 'RETRY_WAIT', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING')
   ORDER BY \"createdAt\", id;"
```

结果必须是 `(0 rows)`。终态 `COMPLETED / FAILED / CANCELLED / SKIPPED` 记录无需删除，它们继续用于历史展示。
如果存在非终态记录，先保持旧 Worker，逐项确认后完成或取消；不得直接改 payload、伪造终态或用
`--force` 跳过。确认结果为零后应立即执行升级；通用升级脚本不会代替这项版本专用审计。

### 静音音轨语义迁移与一次性校准

发布把 `MediaVideoMetadata.hasAudio` 的语义从“可能存在音频流”收紧为“检测到可听内容”，并新增三个 nullable 章节实测字段。生产首次上线该版本时按以下顺序执行：

1. 停止 scheduler，等待或取消活动 writer 任务；按[备份与恢复基线](./backup-and-recovery.md)建立 PostgreSQL custom-format dump、原媒体、派生媒体、配置和镜像 digest 的一致性检查点。
2. 部署 nullable migration、新 App/Worker 和 v3 合并脚本；保持 scheduler 关闭，确认 Worker READY 和 capability audit 通过。
3. 在管理任务页对“视频媒体探测与封面生成”执行一次“校准现有有音频”。该模式只选择任务创建时已有的 `hasAudio=true`，不重建健康封面或章节截图。
4. 检查任务结果的剩余数为 0、视频探测失败数为 0；再运行或检查章节截图增量任务，确认章节音频失败数为 0。环境类失败修复后可重复运行校准模式，`probeUpdatedAt` 检查点会跳过同一任务重试中已成功的真实有声项。
5. 抽样验证已知纯静音、真实有声和逐章混合视频，再恢复 scheduler。纯静音合并视频可以保留 AAC 流，但视频级和章节级均应显示无音频。

这次校准不批量改写旧 `chapters.json`、不重新编码视频，也不重新生成健康封面或章节截图。应用回滚时保留 nullable 字段；若必须撤销已经写入的校准结果，恢复发布前完整检查点，不要只恢复数据库或手工把所有记录改回 true。

## 标准生产升级（手动流程）

以下命令都从仓库根目录执行，并显式指定环境文件和 Compose 文件：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop worker app
docker compose --env-file build/.env -f build/docker-compose.deploy.yml \
  up -d --remove-orphans --no-recreate postgres imgproxy
docker ps -a --filter label=com.docker.compose.service=archive-worker \
  --format '{{.ID}} {{.Names}} {{.Status}}'
```

最后一条命令必须没有输出。`--remove-orphans` 要在停写后、专用审计和 lane migration 前执行；否则旧版本 Compose 创建的 `archive-worker` 虽已从新文件删除，仍会继续运行并可能在新 schema 上领取归档任务。执行前先核对同一 Compose project 的服务清单，避免把仍需保留的自定义 orphan 当成目标版本服务。

停止 App、Worker 和外部写入者后，使用目标版本源码或一次性新 App 镜像连接旧数据库执行专用只读审计：

```bash
pnpm --filter @pixishelf/next archive:lane-cutover-audit
```

退出码 `0` 才能继续；退出码 `2` 表示存在业务或消费者阻断项，退出码 `1` 表示审计本身失败。普通兼容任务的
`PENDING`、`PAUSED`、`RETRY_WAIT` 可以保留，但其 type/version 必须在新 Worker 的 capability inventory 内；
`FULL_RECONCILE` 是额外的 payload 级例外，必须按上一节清零。当前 inventory 为 28 个 job type、31 个
type/version 组合，其中 `SCAN` 支持 v1/v2/v3、`ARCHIVE_IMPORT` 支持 v1/v2、其余 26 类只支持 v1。专用审计只检查数据库状态；上一步“旧
`archive-worker` 容器为零”的结果必须单独记录。

审计通过后，在同一个停写窗口建立 PostgreSQL、原媒体、派生媒体、配置和旧/新镜像 digest 的一致性检查点。lane migration 会拒绝 `RUNNING/PAUSING/CANCELLING` 任务或未过期的 `global/background-worker` lease，并删除已经过期的旧全局 lease；它不是停止并发写入者的替代品。

停止写入者并完成一致性备份后，先把两枚开关设为暗启动状态：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED=false
WORKER_DISPATCH_ENABLED=false
```

拉取镜像并启动基础服务。迁移必须由一次性目标 Web 镜像执行完成，不能先开放会接收请求的 App：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml pull postgres imgproxy app worker scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d postgres imgproxy
docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps \
  --entrypoint prisma app migrate deploy --schema=packages/pixishelf-db/prisma/schema.prisma
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d worker
```

普通版本中 App entrypoint 也会在启动 Next.js 前执行 `prisma migrate deploy`，但 lane 直切必须把 migration 与开放 App 分开。migration 失败时立即停止，不得使用 `db:push`、手工删列或盲目标记 migration 完成。迁移一旦替换为按 lane 的执行索引，就禁止启动不理解双 lane 的旧消费者。

暗启动验证：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file build/.env -f build/docker-compose.deploy.yml logs --tail=200 worker
```

READY 必须显示两个 lane 都可领取，capability audit 必须精确报告 28 个 job type、31 个 type/version 组合、
`SCAN` v1/v2/v3、其余 v1 及正确 lane；`/livez` 只能证明进程存活，不能替代上述门禁。`SCAN@v3` 把
`AUDIT_APPLY` 与只读 `SCAN@v2` 隔离：滚动部署期间旧 v2 Worker 不会领取 v3 写任务，但发布门禁仍要求新
Worker 明确报告 v1/v2/v3 后才能开放 App 写入口。暗启动通过后再启动 App，仍保持 `false/false` 完成登录和
只读媒体抽样。

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d app
```

同时验证登录、画廊查询、原图片、静态视频封面、封面缺失占位和原视频播放。

确认无阻断后，把两枚开关同时改为 `true` 并重建 App 与 Worker：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d --force-recreate app worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d scheduler
```

最终 `ps` 和管理页面必须同时证明：

- App、PostgreSQL、ImgProxy 正常；
- 只有一个当前 Worker 为 READY；
- Worker 报告两个 lane READY，且 capability 精确为 28 个 job type / 31 个 type-version 组合（`SCAN`
  v1/v2/v3、`ARCHIVE_IMPORT` v1/v2，其余 26 类 v1）；
- scheduler 的启用状态符合预期；
- 没有异常积压、重复 claim、媒体 404 或 migration 漂移。

归档专项冒烟还必须证明：连续添加 URL 不等待前项解析；刷新后 FIFO/attempt/pause 保持；resolver 与 writer 可各运行一项；任何时刻没有第二项 writer；已就绪项目能在其余解析期间入队；旧等待任务可以由新 Worker 继续处理。

## 发布后观察

- 立即：登录、核心查询、任务创建/控制、Worker READY、媒体读写；
- 24 小时：错误日志、任务积压、租约、派生媒体失败和磁盘增长；
- 72 小时：失败/重试趋势、长任务耗时和日志轮转；
- 至少一个完整的上海时区 `00:00–08:00` 窗口：计划物化、deadline 和 `SKIPPED` 行为；
- 7–14 天：确认只有一个通用 Worker 服务、两个 lane 没有同 lane 重叠，并复核收件与维护任务容量趋势。

## 故障与回滚入口

出现重复消费、任务异常或 Worker 不稳定时，先执行可逆隔离：

1. 停止 scheduler；
2. 把两枚 Dispatcher 开关改回 `false`；
3. 重建 App/Worker，停止新的任务创建和 claim；
4. 保存 App、Worker、PostgreSQL 日志和任务状态；
5. 不在存在活动任务时强制回滚 Schema。

lane migration 后，服务级回滚只能使用兼容新 schema、当前 capability inventory 和双 lane 的 App/Worker，或以前向修复继续。旧消费者不能作为应用级回滚目标；需要回到旧消费者时，必须恢复切换前同一检查点的数据库、原媒体、派生媒体、配置和镜像。

恢复时必须使用同一时间点的数据库和媒体快照，不能只恢复其中一侧。任何删除数据库卷、覆盖媒体目录或回滚 migration 的操作都必须单独确认目标与备份，不属于日常故障排查步骤。

## 当前安全开关与历史边界

- 两枚 Dispatcher 开关仍保留，生产稳态为 `true/true`，暗启动和故障隔离为 `false/false`；
- App 镜像负责 migration，Worker 镜像只做 Schema 预检；
- `ArchivePreviewSession` 表暂时保留用于兼容观察，过期记录由收件保留任务清理；本次不做破坏性 Schema contract；

相关材料：

- [Build 与部署资产](../../build/README.md)
- [当前架构](../architecture/current-architecture.md)
- [权限与接口边界](../security/access-control.md)
- [备份与恢复基线](./backup-and-recovery.md)
- [阶段 1–7 切换记录](../deployment/background-task-cutover-deployment.md)
- [归档收件箱](../features/archive-intake.md)
- [归档收件箱切换记录](../deployment/archive-intake-cutover-deployment.md)
- [历史兼容回滚手册](../deployment/background-task-cutover-rollback.md)
