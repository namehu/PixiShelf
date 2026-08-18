# Build 与部署

本目录维护 PixiShelf 的容器构建、Compose 和发布配置。阶段 1–7 已完成生产切换：通用
`pixishelf-worker` 是唯一正常消费者，旧 `archive-worker` 只作为应用级紧急回滚镜像保留，
生产稳态不得同时运行两个消费者。

当前标准发布、暗启动、验证和回滚入口见[部署基线](../docs/operations/deployment.md)。本文件只说明
`build/` 内的镜像、Compose、挂载和运行边界。

> **生产 Compose 过渡约束：** `docker-compose.deploy.yml` 仍声明了没有 profile 的
> `archive-worker`。阶段 8 完成前，不得用无服务名的 `docker compose up -d` 作为标准发布命令；
> 必须显式启动 `postgres imgproxy app worker scheduler`，并确认 `archive-worker` 保持停止。

## 文件边界

- `Dockerfile`：Web/API 的 Next.js standalone 镜像，负责启动前执行数据库迁移。
- `worker.Dockerfile`：通用后台 Worker 镜像，包含数据库客户端、任务契约、运行时和 Phase 5
  已迁移的全部 17 个 Executor capability：Archive/Keyframe、五类维护任务、视频媒体任务，以及
  扫描/本地导入、迁移和批量替换。
- `docker-compose.dev.yml`：本地构建与开发环境。
- `docker-compose.deploy.yml`：使用预构建镜像的生产环境。
- `.env.example`：部署变量模板；为防止新环境误消费，Central Dispatcher 开关仍安全地默认关闭。
- `archive-worker.Dockerfile`：回滚期兼容消费者；不参与切换完成后的正常生产运行。

暗启动时两个容器可以同时存在，但仅限通用 Worker 的 Dispatcher 为关闭状态。生产稳态中
`CENTRAL_DISPATCHER_CUTOVER_ENABLED=true` 与 `WORKER_DISPATCH_ENABLED=true` 必须成对设置，
并且旧 `archive-worker` 必须停止。严禁两个 Worker 同时消费。

`worker.Dockerfile` 不复制 `packages/pixishelf`（Next.js 应用）源码。Worker 只从独立 workspace
包构建，并以非 root UID/GID `1001` 运行。它不会执行 migration；数据库 schema 仍由 Web
镜像的 entrypoint 或显式 `pnpm --filter @pixishelf/db db:deploy` 管理。

## 存储与运行边界

Worker 需要以下挂载：

- `PIXISHELF_DATA_PATH` → `/app/data:rw`：原始媒体、归档 staging 与发布目录；
- `DERIVED_MEDIA_HOST_PATH` → `/app/.local-data/derived-media:rw`：视频代表帧等派生媒体；
- PostgreSQL：任务队列、租约、事件、领域检查点与最终发布状态。

启动预检会验证数据库版本、三个媒体目录的读写权限、FFmpeg 与 FFprobe。原始媒体目录必须可写，
因为扫描、本地导入、迁移和批量替换会在其中执行有检查点的文件操作。任一条件不满足时 Worker 不进入
READY，也不会领取任务。镜像内健康检查使用 `/livez`；部署确认使用：

```bash
docker compose -f docker-compose.deploy.yml exec worker \
  node dist/healthcheck.cjs --mode=ready
```

通用 Worker 固定为一个 Central Dispatcher。数据库唯一索引与全局资源租约提供第二道保护，禁止
同时存在两个执行中的任务。Compose 不配置副本数；停止宽限期为 45 秒，业务 drain 默认 30 秒。
日志使用 Docker `json-file` 轮转：单文件 10 MB、最多 5 个文件。

领域发布使用短 PostgreSQL 事务，默认连接等待上限由
`WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS=5000` 控制，事务执行上限由
`WORKER_QUEUE_TRANSACTION_TIMEOUT_MS=30000` 控制。事务超时必须严格小于
`WORKER_JOB_LEASE_DURATION_MS`，启动配置校验不满足时会直接拒绝启动。文件下载、探测和 FFmpeg
等长操作不得放入事务，只允许短检查点或最终领域发布使用该事务窗口。

## 本地开发

完整、跨平台且包含环境变量核对与验收命令的流程见根目录 [README](../README.md#本地开发)。
容器与迁移的固定顺序如下；不要在全新数据库迁移前启动 Worker：

```bash
cd build
cp .env.example .env
# 修改数据库口令、PIXISHELF_DATA_PATH、安全密钥，并在完整功能验证时将两枚 Dispatcher 开关设为 true

docker compose -f docker-compose.dev.yml up -d postgres imgproxy

cd ..
# 先按根 README 在当前终端显式提供 DATABASE_URL
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db exec prisma migrate status --schema prisma/schema.prisma

docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready

cd packages/pixishelf
pnpm dev
```

需要验证独立 Worker 时：

```bash
cd build
docker compose -f docker-compose.dev.yml up -d --build worker
docker compose -f docker-compose.dev.yml exec worker \
  node dist/healthcheck.cjs --mode=ready
docker compose -f docker-compose.dev.yml logs -f worker
```

开发模板出于升级安全默认 `false/false`；完整功能验证必须在 App 和 Compose 两侧成对改为 `true/true`。
只有需要验证旧路径时才显式启动 `archive-worker`；生产稳态不使用旧消费者。`db:push` 不写
`_prisma_migrations`，不能代替 migration deploy 满足 Worker 预检。

## 生产部署与回滚兼容

当前版本不再包含 Thumbor 服务或 `/_video` 实时截帧入口。发布新版本并确认静态视频封面、缺失封面占位
和原视频播放正常后，删除外部 Traefik 的 `/_video` 路由并停止、删除旧 Thumbor 容器。旧版本应用回滚
如仍需要该兼容入口，必须同时使用对应发布归档中的旧 Compose 与路由配置，不能混用当前 Compose。

首次复制配置：

```bash
cd build
cp .env.example .env
```

从仓库根目录执行生产命令时，统一使用：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml <command> <explicit-services>
```

不要省略服务集合；已经停止的 `archive-worker` 可能被无参数 `up -d` 重新拉起。

升级前备份 PostgreSQL、`PIXISHELF_DATA_PATH` 和 `DERIVED_MEDIA_HOST_PATH`。新镜像暗启动阶段必须保持：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED=false
WORKER_DISPATCH_ENABLED=false
```

生产部署必须先停止写入者、执行只读 cutover audit、创建数据库与媒体一致性备份，再启动 App 完成
migration 和 Worker 暗启动。最终同时打开两枚开关并停止旧消费者。阶段 1–7 的纯 Docker 审查、备份、
切换和验收门禁可参考
[生产切换归档](../docs/deployment/background-task-cutover-deployment.md)，但其中的 Thumbor 和 `/_video`
内容是当时的历史状态，当前服务清单、变量和挂载必须以本目录最新 Compose 与 `.env.example` 为准；
事故处理见 [回滚手册](../docs/deployment/background-task-cutover-rollback.md)。

两个开关用途不同：`CENTRAL_DISPATCHER_CUTOVER_ENABLED` 让 Next.js 只创建/控制统一队列任务；
`WORKER_DISPATCH_ENABLED` 才允许通用 Worker claim。开关默认 false，避免镜像升级时意外开始消费。
当前通用 Registry 已锁定全部 17 种 v1 capability，其中包括 `SCAN`、`LOCAL_DIRECTORY_IMPORT`、
`MIGRATION`、`PENDING_REPLACE` 四类高风险任务。阶段 1–7 的生产切换已完成；新部署仍须先以
`false/false` 暗启动并通过 READY/capability 门禁，然后才能恢复生产稳态的 `true/true`。

最终切换必须一次完成：停止新任务、排空并停止旧 `archive-worker`，确认不存在阻断状态，再同时
启用 Next 控制面与通用 Worker Dispatcher。旧镜像在阶段 8 稳定完成前继续保留用于应用级回滚，
但不能作为生产消费者运行。任何时候都禁止双消费者。

发生问题时先把两个开关恢复为 false 并重建 `app`/`worker`，停止新入队与领取；不要在存在
RUNNING、PAUSING 或 CANCELLING 任务时强制回滚 schema。数据库和媒体必须从同一时间点的已验证
快照恢复，不能只回滚其中一侧。

## 单独构建

从仓库根目录执行：

```bash
docker build -f build/Dockerfile --target production -t pixishelf .
docker build -f build/archive-worker.Dockerfile --target production -t pixishelf-archive-worker .
docker build -f build/worker.Dockerfile --target production -t pixishelf-worker .
```

CI 在过渡期发布上述三个镜像，并分别执行安全扫描。URL 归档网络请求读取
`ARCHIVE_HTTPS_PROXY`，未设置时兼容 `HTTPS_PROXY`、`HTTP_PROXY` 与 `NO_PROXY`。
