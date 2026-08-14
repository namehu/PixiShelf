# Build 构建配置目录

本目录包含了 PixiShelf 项目的所有构建和部署相关配置文件。

## 📁 目录结构

```
build/
├── README.md                    # 本说明文件
├── .env.example                 # 环境变量配置模板
├── Dockerfile                   # Web + API standalone 镜像
├── archive-worker.Dockerfile    # 独立归档 Worker 镜像
├── worker.Dockerfile            # 新通用 Worker 独立镜像（Phase 2 preview）
├── docker-compose.dev.yml       # 开发/本地构建用 Docker Compose
└── docker-compose.deploy.yml    # 生产部署用 Docker Compose (使用预构建镜像)
```

## 🔧 文件说明

### Dockerfile
- **用途**: 多阶段 Docker 构建文件
- **包含**: API 和 Web standalone 运行时
- **特性**: 支持多架构构建 (linux/amd64, linux/arm64)

### archive-worker.Dockerfile
- **用途**: 构建独立的 URL 归档 Worker 运行时
- **包含**: 编译后的 Worker JavaScript、生成后的 Prisma Client 和媒体处理依赖
- **不包含**: Next.js standalone、`tsx`、Prisma CLI 或应用源码目录

### worker.Dockerfile
- **用途**: 构建新的通用后台 Worker 运行时
- **包含**: `@pixishelf/db`、`@pixishelf/job-contracts`、`@pixishelf/job-runtime` 和 `@pixishelf/worker` 的编译产物
- **不包含**: `@pixishelf/next` 源码、Next.js、React、认证模块或 Web 路径别名
- **健康检查**: Docker 使用本地 `/livez`；部署冒烟额外检查 `/readyz`


### docker-compose.dev.yml
- **用途**: 开发环境基础设施
- **特点**: 默认只启动 PostgreSQL、ImgProxy、Thumbor；Next.js 应用通常在宿主机通过 `pnpm dev` 运行
- **适用**: 本机开发调试

### .env.example
- **用途**: 环境变量配置模板
- **特点**: 包含所有可配置项和详细说明
- **适用**: Docker 开发环境和生产部署的配置参考

### docker-compose.deploy.yml
- **用途**: 生产环境部署
- **特点**: 使用预构建镜像，默认加载 .env 文件
- **适用**: 快速部署、版本管理

## 🚀 使用方法

### 开发环境

```bash
# 进入 build 目录，让 Docker Compose 自动读取 build/.env
cd build
cp .env.example .env
# 编辑 .env，至少修改 PIXISHELF_DATA_PATH 和安全密钥
docker-compose -f docker-compose.dev.yml up -d

# 然后在另一个终端启动 Next.js
cd ../packages/pixishelf
cp .env.example .env.local
pnpm dev
```

如需调试容器化应用或 scheduler：

```bash
cd build
docker-compose -f docker-compose.dev.yml --profile container-app up -d --build app
docker-compose -f docker-compose.dev.yml --profile scheduler up -d scheduler
```

### 生产部署

```bash
# 进入 build 目录
cd build

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 启动服务
docker-compose -f docker-compose.deploy.yml up -d
```

`app` 保留数据库迁移职责，但 Prisma schema 与完整 migration 历史由 `@pixishelf/db` workspace 包拥有。entrypoint 会先执行 `prisma migrate deploy`，成功后才启动 Next.js standalone 服务。Worker 镜像绝不执行 migration。

当前业务实现仍复用 `packages/pixishelf/services/archive`，独立 workspace 包 `packages/pixishelf-archive-worker` 只提供进程入口和构建边界；Docker 构建时将依赖打包成 JavaScript，生产 Worker 镜像不会携带整个 Web 工程。

新的 `worker` 服务在 Phase 2 使用 `worker-preview` profile：它只验证独立包、启动预检、空闲心跳、健康端点和停机语义，不领取领域任务。完成 Central Dispatcher 与首批 Executor 迁移前，不能与 `archive-worker` 同时作为生产消费者启用。

### 生产升级与回滚准备

升级前先停止会写数据库的进程，再同时备份数据库和媒体目录。下面命令在 `build` 目录执行：

```bash
docker-compose -f docker-compose.deploy.yml stop archive-worker scheduler app

mkdir -p backups
docker-compose -f docker-compose.deploy.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/pixishelf-$(date +%Y%m%d-%H%M%S).dump"

# 对 PIXISHELF_DATA_PATH 做文件系统快照，或复制到另一块磁盘。
```

先启动 `app` 完成迁移并确认健康，再运行身份报告和其他长驻服务：

```bash
docker-compose -f docker-compose.deploy.yml pull
docker-compose -f docker-compose.deploy.yml up -d app
docker-compose -f docker-compose.deploy.yml logs --tail=200 app
docker-compose -f docker-compose.deploy.yml run --rm --no-deps archive-worker \
  node dist/archive-identity-report.cjs
docker-compose -f docker-compose.deploy.yml up -d archive-worker scheduler imgproxy thumbor
```

身份迁移报告中：

- `localStorageKeys` 是已搬到 `storageKey` 的本地作品数；
- `pixivReferences` 只统计有可信 Pixiv 证据后建立的 Source Reference；
- `unknownOrigins` 会保留为未知来源，不会因数字 ID 或历史默认值被猜成 Pixiv；
- `localRowsStillUsingLegacyExternalId` 在兼容期内是预期值。这些行以 `storageKey` 为权威本地身份，不会生成 E-Hentai 或 Pixiv Source Reference。

若迁移失败，不要启动新版 `app`/`archive-worker`；保留日志，使用已验证的 dump 和媒体快照恢复到一套新的 PostgreSQL 数据目录后，再切回旧镜像。不要在唯一一份生产卷上直接试错恢复。

### URL 归档 Worker

`app` 对媒体目录保持只读，只有 `archive-worker` 使用读写挂载。E-Hentai 归档默认每次只运行一个画廊、最多两个媒体请求；下载前不做磁盘空间预检，`ENOSPC` 会作为可恢复失败保留断点。

```bash
# 查看 Worker 日志
docker-compose -f docker-compose.deploy.yml logs -f archive-worker

# 本地容器化调试；数据库 Schema 仍由 @pixishelf/db 维护
docker-compose -f docker-compose.dev.yml --profile archive-worker up -d --build archive-worker

# 仅验证新通用 Worker 的独立镜像/健康/心跳边界；当前不领取任务
# 必须先执行 pnpm --filter @pixishelf/db db:deploy（或 db:migrate）。
# db:push 不写 _prisma_migrations，不能单独满足 Worker 的版本预检。
docker-compose -f docker-compose.dev.yml --profile worker-preview up -d --build worker
docker-compose -f docker-compose.dev.yml exec worker node dist/healthcheck.cjs --mode=ready
```

通用 Worker 以非 root 的 UID/GID `1001` 运行。镜像内默认目录已预创建并授权；若使用 bind mount，部署前仍需保证 `PIXISHELF_DATA_PATH` 和 `DERIVED_MEDIA_HOST_PATH` 已存在，且 UID/GID `1001` 对需要写入的目录具有读写权限。启动预检会在权限不满足时拒绝进入 READY，不会带病领取任务。

媒体根目录下的 `.archive-staging`、`.archive-publish` 和 `.trash` 是内部生命周期目录，不会通过图片 API 暴露。失败/取消暂存保留 7 天，暂停任务无限期保留，软删除作品在回收站保留 7 天。

### 单独构建镜像

```bash
# 构建 Web + API standalone 镜像
docker build -f build/Dockerfile --target production -t pixishelf .

# 构建独立的归档 Worker 镜像
docker build -f build/archive-worker.Dockerfile --target production -t pixishelf-archive-worker .

# 构建不复制 Next 源码的通用 Worker preview 镜像
docker build -f build/worker.Dockerfile --target production -t pixishelf-worker .

# Web 镜像也可以省略默认的 production target
docker build -f build/Dockerfile -t pixishelf .
```

## 📝 注意事项

1. **构建上下文**: 所有 Docker 构建都使用项目根目录作为构建上下文
2. **路径引用**: 配置文件中的路径都是相对于项目根目录
3. **环境变量**: Docker Compose 需要正确配置 `build/.env` 文件；本机运行 Next.js 使用 `packages/pixishelf/.env.local`
4. **网络配置**: 所有服务都在 `pixishelf-network` 网络中通信

URL 归档会读取 `ARCHIVE_HTTPS_PROXY`，未设置时兼容标准 `HTTPS_PROXY`/`HTTP_PROXY` 和 `NO_PROXY`。
Clash Verge 的 TUN/Fake-IP 模式可以直接使用；本机 `pnpm dev` 通常配置为
`http://127.0.0.1:7890`，Docker 中的 `app` 与 `archive-worker` 则应配置为
`http://host.docker.internal:7890`。

## 🔄 CI/CD 集成

GitHub Actions 工作流会自动使用这些配置文件：
- 使用 `build/Dockerfile` 构建 Web 镜像
- 使用 `build/archive-worker.Dockerfile` 构建独立的归档 Worker 镜像
- 使用 `build/worker.Dockerfile` 构建独立的通用 Worker preview 镜像
- 将 `build/docker-compose.deploy.yml` 发布到 Release

## 🛠️ 自定义配置

如需自定义配置，可以：
1. 修改相应的配置文件
2. 创建新的 docker-compose 文件用于特定环境
3. 通过环境变量覆盖默认设置

---

*将构建配置集中管理，让项目结构更加清晰和专业。*
