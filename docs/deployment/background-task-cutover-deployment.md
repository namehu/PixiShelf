# PixiShelf 后台任务统一切换最终部署文档

> 发布日期：2026-08-18  
> 发布状态：上线与人工回归已由上线负责人确认完成  
> 镜像策略：生产 Compose 使用 `latest`；回滚依赖上线前保存的不可变镜像 ID、本地回滚标签和数据库/媒体快照  
> 代码基线：后台任务阶段 1–7 及其上线修复，当前仓库基线为 `v0.36.1`（`92248a08`）

> 后续架构说明：本文保留 2026-08-18 发布时 Thumbor 仍在运行的历史事实。当前版本已经移除 Thumbor；
> 新部署不得照搬本文中的 Thumbor 服务和 `/_video` 路由，旧版本回滚则必须使用对应归档配置。

本文合并本次上线前的两版部署方案、纯 Docker 环境修正和上线期间的代码修复记录，作为本次发布的最终归档。后续常规升级可复用检查项，但不得把本文的“已完成”状态直接套用到新的发布。

## 1. 上线结论

- 后台任务重构阶段 1–7 已交付并完成开发环境、数据层和生产环境人工验收。
- App 控制面和通用 Worker 已切换到 Central Dispatcher。
- 生产稳态要求两枚开关同时为 `true`：

  ```dotenv
  CENTRAL_DISPATCHER_CUTOVER_ENABLED="true"
  WORKER_DISPATCH_ENABLED="true"
  ```

- 通用 `worker` 是唯一后台任务消费者，固定单实例运行。
- 旧 `archive-worker` 只保留在 `legacy-rollback` profile 中，生产稳态不得启动。
- `scheduler` 容器只负责触发 tick；每项自动任务是否执行，继续由数据库中对应计划的启用状态决定。
- PostgreSQL 数据、原媒体和派生媒体均沿用原生产持久化位置，没有创建新系统或切换到空数据库。
- Traefik 继续使用外部 `web` 网络、`websecure` entrypoint 和既有域名；`/_image`、`/_video` 分别路由至 imgproxy、Thumbor。
- 上线负责人已完成第 11 阶段回归，本次上线按成功完成归档。

## 2. 本次交付与修复范围

| 基线 | 内容 |
| --- | --- |
| `1a501732` | 修复生产 App 镜像缺失后台任务 workspace 包的问题。 |
| `cea30911` | 修复真实视频文件探测、路径解析和海报任务调度异常。 |
| `2de7297a` | 完善章节扫描、代表帧预览、派生媒体访问和视频无损优化。 |
| `05cb5cc4` | 修复计划任务启用状态在管理界面的展示布局与交互。 |
| `a56d1988` / `v0.35.0` | 区分派生媒体 GC 的正式清理与 reconciliation dry-run，完成阶段 1–7 主体交付。 |
| `f7e1d5b6` / `v0.36.0` | 更新队列暂停状态回归断言。 |
| `92248a08` / `v0.36.1` | 保证扫描输出顺序稳定，完成本次上线后的最终修正。 |

人工回归覆盖了任务工作台、计划启停、全量扫描、真实视频探测、视频封面、章节预览、代表帧、视频流优化、派生媒体访问、GC dry-run/正式执行边界以及后台任务状态与事件展示。

## 3. 生产架构稳态

| 服务 | 生产状态 | 说明 |
| --- | --- | --- |
| `app` | 运行 | Web/API、任务控制面；启动入口负责 `prisma migrate deploy`。 |
| `worker` | 运行，单实例 | 唯一 Central Dispatcher 消费者，Registry 固定为 17 项 v1 capability。 |
| `archive-worker` | 停止 | 仅供旧控制面紧急回滚，不能与已启用 Dispatcher 的 `worker` 并行消费。 |
| `scheduler` | 按生产计划运行 | 只调用内部 tick；数据库计划仍可分别停用。 |
| `postgres` | 运行 | 使用既有外部卷 `pixivshelf_postgres_data`。 |
| `imgproxy` | 运行 | 只读访问原媒体和派生媒体，处理 `/_image`。 |
| `thumbor` | 运行 | 只读访问原媒体并使用持久化结果目录，处理 `/_video`。 |
| Traefik | 外部既有服务 | 使用外部 `web` 网络，不由本 Compose 创建或删除。 |

关键挂载边界：

- App：原媒体 `rw`、派生媒体 `rw`、既有 public 数据 `ro`。
- Worker：原媒体 `rw`、派生媒体 `rw`。
- imgproxy：原媒体和派生媒体均为 `ro`。
- Thumbor：原媒体 `ro`、结果缓存目录 `rw`。

## 4. 最终使用的 11 阶段部署流程

以下步骤是本次上线的最终有效版本。服务器只需要 Docker、Compose 文件、`.env`、持久化目录和镜像，不需要 Git checkout、Node.js 或 pnpm。

除 `cd` 是 Shell 内建命令、无法加 `sudo` 外，下面所有可执行命令均使用 `sudo`。

### 阶段 1：确认构建和发布物

1. CI 构建、安全扫描和镜像推送成功。
2. 记录准备部署的代码 tag、commit、镜像 ID 和 digest。
3. 虽然 Compose 使用 `latest`，上线记录必须保留实际镜像 ID/digest，不能只记录可变标签。

```bash
cd <生产 Compose 目录>
sudo docker compose images
sudo docker image ls --digests docker.io/dockernamehu/pixishelf
sudo docker image ls --digests docker.io/dockernamehu/pixishelf-worker
```

### 阶段 2：保存旧镜像用于回滚

在拉取新的 `latest` 之前记录当前容器镜像 ID，然后创建不会随远端变化的本地标签：

```bash
sudo docker compose ps
sudo docker inspect --format '{{.Name}} {{.Image}}' $(sudo docker compose ps -q app)
sudo docker inspect --format '{{.Name}} {{.Image}}' $(sudo docker compose ps -q archive-worker)

sudo docker image tag <旧App镜像ID> docker.io/dockernamehu/pixishelf:pre-central-cutover
sudo docker image tag <旧ArchiveWorker镜像ID> docker.io/dockernamehu/pixishelf-archive-worker:pre-central-cutover
```

条件允许时同时导出镜像到 NAS：

```bash
sudo docker image save \
  docker.io/dockernamehu/pixishelf:pre-central-cutover \
  docker.io/dockernamehu/pixishelf-archive-worker:pre-central-cutover \
  | sudo gzip \
  | sudo tee <备份目录>/pre-central-cutover-images.tar.gz >/dev/null

sudo sha256sum <备份目录>/pre-central-cutover-images.tar.gz
```

### 阶段 3：备份旧配置并安装新配置

```bash
sudo mkdir -p <备份目录>/config
sudo cp docker-compose.yml <备份目录>/config/docker-compose.yml.before-cutover
sudo cp .env <备份目录>/config/env.before-cutover
sudo chmod 600 <备份目录>/config/env.before-cutover
```

安装最终 Compose 和 `.env` 后确认：

- 所有脱敏占位符已经替换成原生产真实值。
- 数据库密码、`JWT_SECRET`、`BETTER_AUTH_SECRET`、内部 token 沿用生产值，不在升级时轮换。
- `IMAGE_TAG=latest`。
- 原媒体、派生媒体、Thumbor 缓存和 PostgreSQL 外部卷仍指向既有路径/卷。
- Traefik 网络、域名、entrypoint 和公开端口保持原值。
- 暗启动前两个 Dispatcher 开关均为 `false`。
- `.env` 权限限制为仅管理员可读，并且永远不提交到 Git。

```bash
sudo chmod 600 .env
sudo docker compose --env-file .env -f docker-compose.yml config --quiet
sudo docker compose --env-file .env -f docker-compose.yml config --services
sudo docker compose --env-file .env -f docker-compose.yml config --profiles
```

默认服务列表中应包含 `app`、`worker`、`postgres`、`imgproxy`、`thumbor`；`archive-worker` 和 `scheduler` 应分别受 `legacy-rollback`、`scheduled` profile 控制。

### 阶段 4：只拉取本次需要更新的镜像

为避免无意升级 Thumbor、imgproxy、PostgreSQL 等外围镜像，本次只拉取 App 和 Worker：

```bash
sudo docker compose pull app worker
sudo docker compose images app worker
```

### 阶段 5：暂停调度并排空旧任务

1. 在管理界面停用所有不应自动执行的计划。
2. 停止 scheduler 容器。
3. 停止人工提交新任务和其他外部写入脚本。
4. 等待旧任务全部进入终态；需要取消的任务应通过业务入口取消并等待恢复完成。

```bash
sudo docker compose --profile scheduled stop scheduler
sudo docker compose logs --tail=300 app archive-worker
```

不得通过 SQL 直接把未完成任务改为 `COMPLETED`。

### 阶段 6：停止所有旧写入者并执行纯 Docker 数据库审查

```bash
sudo docker compose stop app worker archive-worker scheduler
```

生产服务器没有源码 checkout，因此不得执行 `pnpm background-task:cutover-audit`。直接通过现有 PostgreSQL 容器运行同等只读审查：

```bash
sudo docker compose exec -T postgres sh -c \
'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH blockers AS (
  SELECT 'system_jobs' AS category, count(*) AS count
  FROM system_jobs
  WHERE status::text IN (
    'PENDING', 'RUNNING', 'PAUSING', 'PAUSED',
    'CANCELLING', 'RETRY_WAIT'
  )
  UNION ALL
  SELECT 'archive_imports', count(*) FROM archive_imports
  WHERE status::text IN ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING')
  UNION ALL
  SELECT 'archive_import_items', count(*) FROM archive_import_items
  WHERE status::text = 'DOWNLOADING'
  UNION ALL
  SELECT 'scan_runs', count(*) FROM scan_runs
  WHERE status::text = 'RUNNING'
  UNION ALL
  SELECT 'pending_replace_batches', count(*) FROM pending_replace_batches
  WHERE status::text IN ('RUNNING', 'CANCELLING')
  UNION ALL
  SELECT 'pending_replace_items', count(*) FROM pending_replace_items
  WHERE status::text IN (
    'STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING',
    'ROLLING_BACK', 'RESTORING', 'RESTORE_SWAPPING'
  )
  UNION ALL
  SELECT 'video_probes', count(*) FROM "MediaVideoMetadata"
  WHERE "probeStatus"::text = 'PROBING'
  UNION ALL
  SELECT 'video_posters', count(*) FROM "MediaVideoMetadata"
  WHERE "posterStatus"::text = 'GENERATING'
  UNION ALL
  SELECT 'chapter_previews', count(*) FROM "MediaChapterPreview"
  WHERE status::text = 'GENERATING'
  UNION ALL
  SELECT 'keyframe_frames', count(*) FROM "MediaVideoKeyframe"
  WHERE status::text = 'GENERATING'
  UNION ALL
  SELECT 'keyframe_staging_sets', count(*)
  FROM "MediaVideoKeyframeSet" AS keyframe_set
  LEFT JOIN system_jobs AS linked_job
    ON linked_job.id = keyframe_set."systemJobId"
  WHERE keyframe_set.status::text = 'STAGING'
    AND (
      keyframe_set."systemJobId" IS NULL
      OR linked_job.id IS NULL
      OR linked_job.status::text NOT IN (
        'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'
      )
    )
  UNION ALL
  SELECT 'archive_lifecycle', count(*) FROM "Artwork"
  WHERE "archiveLifecycleState"::text IN ('TRASHING', 'RESTORING')
)
SELECT
  category,
  count,
  sum(count) OVER () AS total_blockers,
  CASE WHEN sum(count) OVER () = 0 THEN 'PASS' ELSE 'STOP' END AS deployment_gate
FROM blockers
ORDER BY category;

COMMIT;
SQL
```

只有全部为 `0`、`total_blockers=0`、`deployment_gate=PASS` 才可继续。任何非零结果都必须停止上线，恢复旧系统处理或取消任务后重新排空和审查。

### 阶段 7：创建一致性备份

数据库和媒体必须属于同一个停写时间点。至少保存：

- PostgreSQL custom-format dump 及 SHA-256。
- `_prisma_migrations` 记录。
- 原媒体目录的 Synology 快照或等价备份。
- `pixiv_data`/派生媒体目录的 Synology 快照或等价备份。
- Compose、`.env`、镜像 ID/digest、外部卷名和关键目录清单。

```bash
sudo docker compose exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | sudo tee <备份目录>/pixishelf-before-cutover.dump >/dev/null

sudo sha256sum <备份目录>/pixishelf-before-cutover.dump

sudo docker compose exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\''SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;'\''' \
  | sudo tee <备份目录>/prisma-migrations-before-cutover.txt >/dev/null

sudo du -sh <原媒体宿主机目录>
sudo du -sh <派生媒体宿主机目录>
sudo docker volume inspect pixivshelf_postgres_data
```

数据库 dump 与媒体快照都验证可读后才能启动新 App。

### 阶段 8：迁移与暗启动

保持两枚开关均为 `false`，启动新的 App。App entrypoint 会先执行 `prisma migrate deploy`，再启动 Web：

```bash
sudo docker compose up -d --no-deps --force-recreate app
sudo docker compose logs --tail=300 app
sudo docker compose ps app postgres
sudo curl -fsS http://127.0.0.1:5430/login >/dev/null
sudo curl -fsS https://pixi.namehu.top:4443/login >/dev/null
```

确认 migration 成功、登录正常、Traefik 路由正常后暗启动 Worker：

```bash
sudo docker compose up -d --no-deps --force-recreate worker
sudo docker compose logs --tail=300 worker
sudo docker compose exec -T worker node dist/healthcheck.cjs --mode=ready
sudo docker compose exec -T worker node dist/capability-audit.cjs
```

预期结果：一个 READY Worker、17 项 capability 完整、Dispatcher 关闭且没有领取任务。暗启动阶段不要提交业务任务。

### 阶段 9：原子切换 Central Dispatcher

先停止 App 和 Worker，在同一次编辑中把两个开关都改为 `true`：

```bash
sudo docker compose stop app worker archive-worker
sudo vi .env
sudo docker compose --env-file .env -f docker-compose.yml config --quiet
sudo docker compose --profile legacy-rollback rm -f archive-worker
sudo docker compose up -d --no-deps --force-recreate app worker
```

切换后立即确认：

```bash
sudo docker compose ps
sudo docker compose logs --tail=300 app worker
sudo docker compose exec -T worker node dist/healthcheck.cjs --mode=ready
sudo docker compose exec -T worker node dist/capability-audit.cjs
```

禁止以下两种状态：

- `CENTRAL_DISPATCHER_CUTOVER_ENABLED=true`、`WORKER_DISPATCH_ENABLED=false`：新任务会入队但无人消费。
- `CENTRAL_DISPATCHER_CUTOVER_ENABLED=false`、`WORKER_DISPATCH_ENABLED=true`：可能形成旧执行路径与新 Worker 混跑。

### 阶段 10：小范围冒烟

按从低风险到有写入的顺序验证：

1. 派生媒体 reconciliation：固定 `dryRun=true,reconcile=true`，确认 `deleted=0`。
2. 单条真实视频探测。
3. 单条视频封面或章节预览。
4. 单条代表帧任务。
5. 单条视频流优化，并确认原视频和优化结果均可访问。
6. 检查任务从入队、claim、事件时间线到终态的完整链路。

第一次验证不要执行全量扫描、全库迁移、大批量替换或 GC 正式删除。

### 阶段 11：完整回归、恢复调度并宣布完成

本次已由上线负责人完成完整人工回归。确认无异常后启动 scheduler：

```bash
sudo docker compose --profile scheduled up -d scheduler
sudo docker compose --profile scheduled ps scheduler
sudo docker compose --profile scheduled logs --tail=200 scheduler
```

注意：scheduler 运行不等于所有计划均已启用。管理页顶部的“自动计划已启用”数量必须与数据库中各计划的实际启用状态一致。计划应按需要逐项开启，避免上线后立即集中运行全量任务。

## 5. 上线完成后的验收记录

| 项目 | 最终状态 |
| --- | --- |
| Compose 配置解析 | 通过 |
| PostgreSQL 沿用原外部卷 | 通过 |
| 原媒体和派生媒体沿用原路径 | 通过 |
| migration | 通过 |
| App 本地与 Traefik 登录访问 | 通过 |
| Worker READY | 通过 |
| 17 项 capability audit | 通过 |
| 两枚 Dispatcher 开关同步切换 | 通过 |
| 旧 archive-worker 停止 | 通过 |
| 真实媒体读写 | 通过 |
| 视频探测、封面、章节、代表帧 | 通过 |
| 视频流优化 | 通过 |
| 派生媒体 URL/代理访问 | 通过 |
| GC dry-run 与正式模式区分 | 通过 |
| 计划启停和数量展示 | 通过 |
| 全部任务人工回归 | 通过（上线负责人确认） |

## 6. 上线后日常检查

```bash
cd <生产 Compose 目录>
sudo docker compose ps
sudo docker compose logs --since=24h app worker
sudo docker compose exec -T worker node dist/healthcheck.cjs --mode=ready
sudo docker compose exec -T worker node dist/capability-audit.cjs
sudo docker system df
```

持续关注：

- Worker 最近心跳是否小于 2 分钟。
- 是否存在长期 `RUNNING`、租约过期或 `RETRY_WAIT` 激增的任务。
- 自动窗口结束后是否仍有应被跳过的待执行任务。
- `DerivedMediaGcEntry` 的 `FAILED` 是否增长。
- App、Worker、PostgreSQL、imgproxy 和 Traefik 是否出现连续错误。
- Docker 日志是否保持 `10 MB × 5` 轮转。
- 媒体目录容量和数据库卷容量是否安全。

## 7. 安全与归档要求

- 生产 `.env`、数据库 dump、审查结果中的文件路径和认证信息均按敏感资料保存。
- 不把生产 `.env`、备份或真实路径样例提交到 Git。
- 使用 `latest` 不代表可以省略版本记录；最终归档必须补充容器实际镜像 ID/digest。
- 在阶段 8 清理兼容代码完成且再次稳定运行前，保留旧镜像、升级前数据库 dump 和对应媒体快照。
- 独立回滚流程见 [background-task-cutover-rollback.md](./background-task-cutover-rollback.md)。
- 后续工作见 [background-task-follow-up.md](./background-task-follow-up.md)。
