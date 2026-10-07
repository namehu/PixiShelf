# Build 与部署

本目录维护 PixiShelf 的容器构建、Compose 和发布配置。通用 `pixishelf-worker` 是唯一后台消费者；
同一个 Node.js 进程运行 `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 两个固定并发为 1 的执行 lane。

当前标准发布、启动、验证和回滚入口见[部署基线](../docs/operations/deployment.md)。本文件只说明
`build/` 内的镜像、Compose、挂载和运行边界。

## 文件边界

- `Dockerfile`：Web/API 的 Next.js standalone 镜像，负责启动前执行数据库迁移。
- `worker.Dockerfile`：通用后台 Worker 镜像，包含数据库客户端、任务契约、运行时和当前全部
  33 个 job type；`SCAN` 支持 v1/v2/v3，`ARCHIVE_IMPORT` 支持 v1/v2，`ARCHIVE_SEARCH_SCAN` 支持 v1/v2/v3，其余 30 类只支持 v1，共 38 个 type/version 组合。
- `docker-compose.dev.yml`：本地构建与开发环境。
- `docker-compose.deploy.yml`：使用预构建镜像的生产环境。
- `.env.example`：部署变量模板；Worker 启动即消费，维护窗口必须保持容器停止。

App 固定中央入队，Worker 启动即消费；维护通过停止服务完成。旧 `archive-worker` 镜像、workspace、Compose
服务和 CI 发布入口已退出当前部署边界；双 lane migration 后也不能在新 schema 上启动旧消费者。

`worker.Dockerfile` 不复制 `packages/pixishelf`（Next.js 应用）源码。Worker 只从独立 workspace
包构建，并以非 root UID/GID `1001` 运行。它不会执行 migration；数据库 schema 仍由 Web
镜像的 entrypoint 或显式 `pnpm --filter @pixishelf/db db:deploy` 管理。

Web `Dockerfile` 直接由 Next.js 编译 job-contracts、job-runtime 和 job-executors 的 workspace 源码，
不依赖或复制宿主机 `dist`。三个包的独立 `dist`、类型声明和公开包依赖由 GitHub CI 的独立 Worker job 按顺序构建，
与 Web 源码边界验证并行执行；它们不是 Web 镜像的构建前置条件。

## Web 构建缓存

`APP_VERSION` / `NEXT_PUBLIC_APP_VERSION` 在依赖安装、源码复制与 Prisma Client 生成之后，紧邻 Next.js build 注入。新版本号会重新生成前端版本信息，但不会单独使前面的依赖层失效；依赖、源码或基础镜像变化仍按 Docker 缓存规则重新执行相应层。

发布后用两个不同版本标签、相同依赖的构建日志确认依赖安装层命中缓存，并核对前端显示的新版本号。此调整不改变镜像运行入口、数据库或媒体；恢复依据是 Git 中修改前的 Dockerfile，回退其指令位置并重建即可恢复原构建方式。生产版本回退仍遵循部署与备份恢复基线。

## GitHub 发布流水线

`.github/workflows/build-and-deploy.yml` 对同一次 tag/manual 运行并行执行：

- `validate`：依赖安装、Prisma generate/validate、PostgreSQL 空库完整迁移与 status、Worker 依赖链 typecheck/test、共享包与 Worker 构建；各阶段独立计时。
- `Build pixishelf` / `Build pixishelf-worker`：独立 runner 构建 `linux/amd64` OCI 镜像包，各自复用原 GHCR `:cache`。构建阶段只更新构建缓存，不推送版本、SHA 或 `latest` 镜像标签。
- `Publish pixishelf` / `Publish pixishelf-worker`：必须等待 `validate` 和两个构建全部成功。下载本次运行的镜像包、校验 SHA-256 后，用 `skopeo copy --all --preserve-digests` 原样复制到 GHCR 与 Docker Hub；保留镜像清单及构建证明，不重新执行 Docker build。
- 两个发布都成功后才创建 Release 和扫描镜像。`Release timings` 在成功或失败后汇总当前 attempt 的 job、step 耗时；并行步骤时间不能相加当作总耗时。

镜像 artifact 不做额外 ZIP 压缩，保留 3 天；名称包含镜像名和 workflow run ID。完整重跑会覆盖对应产物，重跑失败 job 可以复用同次运行成功的产物；过期后必须重跑全部 jobs，不能从其他运行借用镜像。版本标签和镜像标签规则保持一致。

验收应比较多次运行的端到端时间，并分别记录验证、构建及缓存导出、artifact 上传/下载、工具安装、推送和扫描耗时；OCI 传输和额外 runner 初始化会抵消部分并行收益，不预先承诺固定节省比例。

发布仍不是跨镜像、跨仓库的原子事务：验证失败时不会进入推送；推送中途失败可能已有部分标签更新，此时不会创建 Release，需修复后重跑失败发布 job。`latest` 的更新顺序仍不保证跨不同 workflow run 串行，生产部署应使用明确版本或 digest。本次不修改数据库、媒体或运行时；恢复流水线可回退此工作流配置，生产恢复继续遵循[备份与恢复基线](../docs/operations/backup-and-recovery.md)。

## 存储与运行边界

Worker 需要以下挂载：

- `PIXISHELF_DATA_PATH` → `/app/data:rw`：原始媒体、归档 staging 与发布目录；
- `DERIVED_MEDIA_HOST_PATH` → `/app/.local-data/derived-media:rw`：视频代表帧等派生媒体；
- `PIXISHELF_PUBLIC_DATA_PATH` → `/app/pixiv-data:rw`：Pixiv 作者图片、标签封面与作品元数据快照目录；宿主机目录不迁移，容器内不进入 Next `public`；
- PostgreSQL：任务队列、租约、事件、领域检查点与最终发布状态。

启动预检会验证数据库版本、原媒体、归档、派生媒体和 Pixiv data 目录的读写权限、FFmpeg 与 FFprobe。原始媒体目录必须可写，
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

动画图片识别的内部探测池由 `ANIMATION_SCAN_CONCURRENCY` 控制，允许 1–8，默认 4。它不会增加
`BACKGROUND_WRITER` lane 的任务并发；只是同一个 `WEBP_ANIMATION_SCAN` 内并行读取媒体。生产先以 1 建立分类和
吞吐基线，再测试 4；提升不足 20%或存储压力不可接受时立即回退为 1。

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
# 修改数据库口令、PIXISHELF_DATA_PATH、安全密钥，并在准备恢复消费后启动 Worker

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

开发模板启动 Worker 即消费，测试应使用隔离数据库与临时媒体。
`db:push` 不写 `_prisma_migrations`，不能代替 migration deploy 满足 Worker 预检。

## 生产部署与恢复边界

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

升级前备份 PostgreSQL、`PIXISHELF_DATA_PATH`、`DERIVED_MEDIA_HOST_PATH` 和 `PIXISHELF_PUBLIC_DATA_PATH`。执行 migration 和预检期间停止全部写入者，准备消费后才启动 Worker。

数据库 dump、三个媒体快照、配置和镜像 digest 必须组成同一套恢复点；频率、验证和演练要求见
[备份与恢复基线](../docs/operations/backup-and-recovery.md)。

生产部署必须先停止写入者、执行专用 `archive:lane-cutover-audit`、创建数据库与媒体一致性备份，再以
一次性新 Web 镜像执行 migration 和 Worker 启动。lane migration 应用后，旧 Worker 不再是应用级回滚
选项；事故处理和完整 checkpoint 恢复边界见[部署基线](../docs/operations/deployment.md)与
[备份与恢复](../docs/operations/backup-and-recovery.md)。

当前通用 Registry 已锁定 33 个 job type、38 个 type/version 组合，并校验 job type、definition version 和
lane；任务清单中包括 `SCAN`、`LOCAL_DIRECTORY_IMPORT`、`MIGRATION`、`PENDING_REPLACE` 四类高风险任务，
`SCAN` 支持 v1/v2/v3，`ARCHIVE_IMPORT` 支持 v1/v2，`ARCHIVE_SEARCH_SCAN` 支持 v1/v2/v3，其余 30 类只支持 v1。新部署应完成迁移与备份后启动 Worker，验证 READY/capability，再开放 App 和 scheduler。
`SCAN@v3` 专用于来源核对后的写入型 `AUDIT_APPLY`；只支持 v2 的旧 Worker 不会领取它。滚动部署的版本隔离不能
替代发布门禁，开放新 App 写入口前仍必须确认目标 Worker 同时报告 SCAN v1/v2/v3。

归档收件箱切换必须一次完成：停止新任务和旧写入者，通过 audit 和一致性 checkpoint，应用 lane migration，
验证双 lane READY 与当前 capability inventory，再同时启用 Next 控制面与通用 Worker Dispatcher。

发生问题时先停止 scheduler、App 和 Worker，停止新入队与领取；不要在存在
RUNNING、PAUSING 或 CANCELLING 任务时强制回滚 schema。数据库和媒体必须从同一时间点的已验证
快照恢复，不能只回滚其中一侧。

## 单独构建

从仓库根目录执行：

```bash
docker build -f build/Dockerfile --target production -t pixishelf .
docker build -f build/worker.Dockerfile --target production -t pixishelf-worker .
```

CI 构建并扫描 App 与通用 Worker 镜像。归档、来源扫描、服务端预览 HTML，以及 Pixiv 艺术家资料和图片、作品 metadata、标签资料和封面、系列缺少有效本地快照时的请求，共用 `ARCHIVE_HTTPS_PROXY`。作品同步不会因此下载原图；浏览器远程图片/脚本、本地任务和内部服务不在此范围。

优先顺序为 `ARCHIVE_HTTPS_PROXY > HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy`。专用变量显式为空时强制直连；只有未设置专用变量时才遵循 `NO_PROXY/no_proxy`。仅支持无凭据、无路径/query/hash 的 HTTP(S) 代理，代理失败不降级直连。Pixiv 经逐请求 dispatcher 使用代理，不修改全局 dispatcher；目标主机由代理解析，HTTPS 443、精确域名和逐跳重定向校验仍然生效，归档的本地 DNS/SSRF/fake-IP 检查不变。

Compose 的 App/Worker 已通过 `env_file` 读取 `build/.env`，修改后须重新创建相应容器。本地 App 在 `packages/pixishelf/.env.local` 配置并重启；Compose Worker 仍需单独配置 `build/.env`。代理地址必须能从实际运行环境访问，容器内的 `127.0.0.1` 不是宿主机。发布与回滚见[部署基线](../docs/operations/deployment.md#环境文件边界)。

后台任务退役第一阶段的升级和 v0.50.8 回退见[发布手册](../docs/deployment/background-task-retirement.md)。
