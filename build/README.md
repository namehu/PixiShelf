# Build 与部署

本目录维护 PixiShelf 的容器构建、Compose 和发布配置。通用 `pixishelf-worker` 是唯一后台消费者；
同一个 Node.js 进程运行 `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 两个固定并发为 1 的执行 lane。

当前标准发布、暗启动、验证和回滚入口见[部署基线](../docs/operations/deployment.md)。本文件只说明
`build/` 内的镜像、Compose、挂载和运行边界。

## 文件边界

- `Dockerfile`：Web/API 的 Next.js standalone 镜像，负责启动前执行数据库迁移。
- `worker.Dockerfile`：通用后台 Worker 镜像，包含数据库客户端、任务契约、运行时和当前全部
  20 个 job type；`SCAN` 支持 v1/v2/v3，其余 19 类只支持 v1，共 22 个 type/version 组合。
- `docker-compose.dev.yml`：本地构建与开发环境。
- `docker-compose.deploy.yml`：使用预构建镜像的生产环境。
- `.env.example`：部署变量模板；为防止新环境误消费，Central Dispatcher 开关仍安全地默认关闭。

生产稳态中 `CENTRAL_DISPATCHER_CUTOVER_ENABLED=true` 与 `WORKER_DISPATCH_ENABLED=true` 必须成对设置。
暗启动或故障隔离使用 `false/false`，不允许只切换一枚开关。旧 `archive-worker` 镜像、workspace、Compose
服务和 CI 发布入口已退出当前部署边界；双 lane migration 后也不能在新 schema 上启动旧消费者。

`worker.Dockerfile` 不复制 `packages/pixishelf`（Next.js 应用）源码。Worker 只从独立 workspace
包构建，并以非 root UID/GID `1001` 运行。它不会执行 migration；数据库 schema 仍由 Web
镜像的 entrypoint 或显式 `pnpm --filter @pixishelf/db db:deploy` 管理。

Web `Dockerfile` 直接由 Next.js 编译 job-contracts、job-runtime 和 job-executors 的 workspace 源码，
不依赖或复制宿主机 `dist`。三个包的独立 `dist`、类型声明和公开包依赖仍由 GitHub CI 在 Web 源码边界
验证完成后按顺序构建；它们不是 Web 镜像的构建前置条件。

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

通用 Worker 固定为一个服务，内部运行两个 Dispatcher loop。数据库按 lane 的执行态唯一索引与
`lane/archive-resolve`、`lane/background-writer` 资源租约提供第二道保护：最多一个 resolver 和一个 writer
可以同时执行，同 lane 不得重叠。Compose 不配置副本数；停止宽限期为 45 秒，业务 drain 默认 30 秒。
日志使用 Docker `json-file` 轮转：单文件 10 MB、最多 5 个文件。

领域发布使用短 PostgreSQL 事务，默认连接等待上限由
`WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS=5000` 控制，事务执行上限由
`WORKER_QUEUE_TRANSACTION_TIMEOUT_MS=30000` 控制。事务超时必须严格小于
`WORKER_JOB_LEASE_DURATION_MS`，启动配置校验不满足时会直接拒绝启动。文件下载、探测和 FFmpeg
等长操作不得放入事务，只允许短检查点或最终领域发布使用该事务窗口。

Pixiv 目录发现的安全上限由 `SCAN_DISCOVERY_MAX_ENTRIES` 控制，默认 `10000000`。该计数包含遍历到的目录、
metadata 和媒体文件，不等于作品数；冻结进数据库的 metadata 输入仍受独立的 100000 行上限保护。生产目录若
接近默认上限，应先在 Worker 容器内统计实际条目数，再为该变量保留增长余量，不能通过取消所有安全上限处理。
发现默认不进入 SCAN_PATH 根目录下的 `local-imports`、`sources`、`.archive-staging` 和 `.trash`；可用
`SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES` 提供逗号分隔的完整替代清单，空值表示不排除。该规则只匹配根目录
的直接子目录，不会排除更深层同名目录；来源核对也不会把排除目录内的既有 inventory 误报为 `MISSING`。

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
`db:push` 不写 `_prisma_migrations`，不能代替 migration deploy 满足 Worker 预检。

## 生产部署与恢复边界

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

高风险发布仍建议显式指定服务集合，便于审查本次实际重建范围。

升级前备份 PostgreSQL、`PIXISHELF_DATA_PATH` 和 `DERIVED_MEDIA_HOST_PATH`。新镜像暗启动阶段必须保持：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED=false
WORKER_DISPATCH_ENABLED=false
```

数据库 dump、两个媒体快照、配置和镜像 digest 必须组成同一套恢复点；频率、验证和演练要求见
[备份与恢复基线](../docs/operations/backup-and-recovery.md)。

生产部署必须先停止写入者、执行专用 `archive:lane-cutover-audit`、创建数据库与媒体一致性备份，再以
一次性新 Web 镜像执行 migration 和 Worker 暗启动。lane migration 应用后，旧 Worker 不再是应用级回滚
选项；事故处理和完整 checkpoint 恢复边界见[部署基线](../docs/operations/deployment.md)与
[备份与恢复](../docs/operations/backup-and-recovery.md)。

两个开关用途不同：`CENTRAL_DISPATCHER_CUTOVER_ENABLED` 让 Next.js 只创建/控制统一队列任务；
`WORKER_DISPATCH_ENABLED` 才允许通用 Worker claim。开关默认 false，避免镜像升级时意外开始消费。
当前通用 Registry 已锁定 20 个 job type、22 个 type/version 组合，并校验 job type、definition version 和
lane；20 类中包括 `SCAN`、`LOCAL_DIRECTORY_IMPORT`、`MIGRATION`、`PENDING_REPLACE` 四类高风险任务，
`SCAN` 支持 v1/v2/v3，其余 19 类只支持 v1。新部署仍须先以
`false/false` 暗启动并通过 READY/capability 门禁，然后才能恢复生产稳态的 `true/true`。
`SCAN@v3` 专用于来源核对后的写入型 `AUDIT_APPLY`；只支持 v2 的旧 Worker 不会领取它。滚动部署的版本隔离不能
替代发布门禁，开放新 App 写入口前仍必须确认目标 Worker 同时报告 SCAN v1/v2/v3。

归档收件箱切换必须一次完成：停止新任务和旧写入者，通过 audit 和一致性 checkpoint，应用 lane migration，
验证双 lane READY 与当前 capability inventory，再同时启用 Next 控制面与通用 Worker Dispatcher。

发生问题时先把两个开关恢复为 false 并重建 `app`/`worker`，停止新入队与领取；不要在存在
RUNNING、PAUSING 或 CANCELLING 任务时强制回滚 schema。数据库和媒体必须从同一时间点的已验证
快照恢复，不能只回滚其中一侧。

## 单独构建

从仓库根目录执行：

```bash
docker build -f build/Dockerfile --target production -t pixishelf .
docker build -f build/worker.Dockerfile --target production -t pixishelf-worker .
```

CI 构建并扫描 App 与通用 Worker 镜像。URL 归档网络请求读取
`ARCHIVE_HTTPS_PROXY`，未设置时兼容 `HTTPS_PROXY`、`HTTP_PROXY` 与 `NO_PROXY`。
