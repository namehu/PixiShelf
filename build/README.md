# Build 与部署

本目录维护 PixiShelf 的容器构建、Compose 和发布配置。当前阶段采用兼容过渡：旧
`archive-worker` 继续承担线上消费，新 `pixishelf-worker` 以
`WORKER_DISPATCH_ENABLED=false` 暗启动并验证独立运行边界。

## 文件边界

- `Dockerfile`：Web/API 的 Next.js standalone 镜像，负责启动前执行数据库迁移。
- `worker.Dockerfile`：通用后台 Worker 镜像，包含数据库客户端、任务契约、运行时和 Phase 4
  已迁移的 13 个 Executor：Archive/Keyframe、五类维护任务、视频探测/封面/派生媒体 GC，以及
  章节预览/流媒体优化。
- `docker-compose.dev.yml`：本地构建与开发环境。
- `docker-compose.deploy.yml`：使用预构建镜像的生产环境。
- `.env.example`：部署变量模板，所有 Central Dispatcher 开关默认关闭。
- `archive-worker.Dockerfile`：过渡期生产消费者；Compose 与 CI 继续构建、发布和扫描，直到
  所有旧任务类型迁移完毕后，在最终原子切换提交中删除。

两个 Worker 容器可以同时存在，但此阶段通用 Worker 的 Dispatcher 必须保持关闭。严禁让旧
`archive-worker` 与 `WORKER_DISPATCH_ENABLED=true` 的通用 Worker 同时消费。

`worker.Dockerfile` 不复制 `packages/pixishelf`（Next.js 应用）源码。Worker 只从独立 workspace
包构建，并以非 root UID/GID `1001` 运行。它不会执行 migration；数据库 schema 仍由 Web
镜像的 entrypoint 或显式 `pnpm --filter @pixishelf/db db:deploy` 管理。

## 存储与运行边界

Worker 需要以下挂载：

- `PIXISHELF_DATA_PATH` → `/app/data:rw`：原始媒体、归档 staging 与发布目录；
- `DERIVED_MEDIA_HOST_PATH` → `/app/.local-data/derived-media:rw`：视频代表帧等派生媒体；
- PostgreSQL：任务队列、租约、事件、领域检查点与最终发布状态。

启动预检会验证数据库版本、目录权限、FFmpeg 与 FFprobe。任一条件不满足时 Worker 不进入
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

```bash
cd build
cp .env.example .env
# 修改数据库口令、PIXISHELF_DATA_PATH 和安全密钥

docker compose -f docker-compose.dev.yml up -d postgres imgproxy thumbor

cd ../packages/pixishelf
pnpm db:generate
pnpm db:migrate
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

默认 `WORKER_DISPATCH_ENABLED=false`，所以启动通用 Worker 只进行预检、健康服务和进程心跳，
不会领取任务；旧 `archive-worker` 仍是当前消费者。`db:push` 不写 `_prisma_migrations`，不能
代替 migration deploy 满足 Worker 预检。

## 生产部署与兼容过渡

首次复制配置：

```bash
cd build
cp .env.example .env
```

升级前备份 PostgreSQL、`PIXISHELF_DATA_PATH` 和 `DERIVED_MEDIA_HOST_PATH`。Phase 4 暗发布必须保持：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED=false
WORKER_DISPATCH_ENABLED=false
```

按以下顺序部署：

```bash
# 1. 拉取镜像；先启动 Web，让 entrypoint 完成 migration。
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d postgres app
docker compose -f docker-compose.deploy.yml logs --tail=200 app

# 2. 继续运行旧消费者，同时启动通用 Worker 暗发布并确认 READY。
docker compose -f docker-compose.deploy.yml up -d archive-worker worker
docker compose -f docker-compose.deploy.yml exec worker \
  node dist/healthcheck.cjs --mode=ready
```

两个开关用途不同：`CENTRAL_DISPATCHER_CUTOVER_ENABLED` 让 Next.js 只创建/控制统一队列任务；
`WORKER_DISPATCH_ENABLED` 才允许通用 Worker claim。开关默认 false，避免镜像升级时意外开始消费。
当前通用 Registry 覆盖 13 种任务，但 `SCAN`、`LOCAL_DIRECTORY_IMPORT`、`MIGRATION`、
`PENDING_REPLACE` 四类高风险任务仍未切换。此阶段不能打开全局开关，否则这些任务会被中央入口
拒绝或积压。只有全部 17 类任务完成迁移和最终回归后，才允许执行下述原子切换。

最终切换必须在所有 Executor 迁移、回归和发布门禁完成后一次完成：停止新任务、排空并停止旧
`archive-worker`，确认无 RUNNING/PAUSING/CANCELLING 旧任务，再同时启用 Next 切换与通用 Worker
Dispatcher。旧服务/镜像的移除也只能在这个最终提交发生，不能提前。任何时候都禁止双消费者。

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
