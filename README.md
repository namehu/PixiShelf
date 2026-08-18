# PixiShelf

PixiShelf 是一个本地优先、自托管的个人媒体收藏系统。它把本地目录、来源元数据和归档任务组织成稳定的作品目录，并提供扫描、整理、检索、浏览和后台媒体处理能力。

当前项目面向单用户、单实例部署。Pixiv 是重要来源之一，但本地 Artwork 身份不由任何外部站点定义；相关领域术语见 [CONTEXT.md](./CONTEXT.md)。

## 核心能力

- 扫描本地图片和视频收藏，解析目录与来源元数据；
- 管理作品、艺术家、系列、标签、来源引用和本地整理结果；
- 提供响应式画廊、筛选、详情页和沉浸浏览；
- 通过持久 PostgreSQL 队列执行扫描、归档、迁移、替换和媒体维护；
- 使用 FFmpeg/FFprobe 预生成视频封面、章节图和代表帧；
- 使用 ImgProxy 只读处理原图片和静态派生媒体；
- 使用 Better Auth 数据库会话保护 Web 与管理界面；
- 使用审计、租约、重试和回滚流程保护长任务与文件发布。

## 当前架构

| 组件                         | 责任                                               |
| ---------------------------- | -------------------------------------------------- |
| `@pixishelf/next`            | Next.js 16 Web、API、tRPC、认证与任务控制面        |
| PostgreSQL / `@pixishelf/db` | Prisma Schema、migration、领域数据、会话与任务队列 |
| `@pixishelf/worker`          | 单通用 Worker 和 Central Dispatcher                |
| `@pixishelf/job-*`           | 后台任务契约、运行时和 Executor                    |
| ImgProxy                     | 只读图片与派生媒体处理                             |
| scheduler                    | 可选定时 tick，只调用 App，不直接访问数据库        |
| `archive-worker`             | 阶段 8 前的回滚兼容消费者，生产稳态必须停止        |

完整组件图、workspace 依赖和数据流见[当前架构](./docs/architecture/current-architecture.md)。

## 技术基线

- Node.js 20 LTS、pnpm 8.15.1；
- Next.js 16.1.1、React 19、TypeScript 5；
- Tailwind CSS 4、Radix UI、TanStack Query、Zustand；
- PostgreSQL 15、Prisma 5、Zod；
- Docker Compose、ImgProxy、FFmpeg/FFprobe；
- Vitest、oxlint、Prettier。

## 本地开发

标准开发拓扑是：PostgreSQL、ImgProxy 和通用 Worker 运行在 Docker 中，Next.js 在宿主机通过 VS Code F5 或 `pnpm dev` 运行。当前版本没有 Thumbor、5433 服务或 `/_video` 请求时截帧路由。

### 1. 准备环境

需要 Git、Node.js 20、pnpm 8.15.1、Docker 24+ 和 Docker Compose V2.20+。

```bash
corepack enable
corepack prepare pnpm@8.15.1 --activate
pnpm install --frozen-lockfile
```

### 2. 配置环境变量

PowerShell：

```powershell
Copy-Item build/.env.example build/.env
Copy-Item packages/pixishelf/.env.example packages/pixishelf/.env.local
```

Bash：

```bash
cp build/.env.example build/.env
cp packages/pixishelf/.env.example packages/pixishelf/.env.local
```

两份环境文件不能直接互换：

- `build/.env` 在 Docker 中使用 `postgres:5432`；
- `packages/pixishelf/.env.local` 在宿主机使用 `127.0.0.1:5432`；
- `PIXISHELF_DATA_PATH`、`SCAN_PATH` 与 `ARCHIVE_STORAGE_PATH` 应指向同一份原媒体；
- `DERIVED_MEDIA_HOST_PATH` 与 `DERIVED_MEDIA_STORAGE_PATH` 应指向同一份持久化派生媒体目录；
- 本地完整功能验证时，App 的 `CENTRAL_DISPATCHER_CUTOVER_ENABLED` 与 Worker 的 `WORKER_DISPATCH_ENABLED` 必须同时为 `true`；
- 修改 `BETTER_AUTH_SECRET`、管理员密码、`INTERNAL_JOB_TOKEN`、`SCAN_WEBHOOK_TOKEN` 和环境模板中保留的遗留 `JWT_SECRET`；
- 本地 ImgProxy 地址使用 `NEXT_PUBLIC_IMGPROXY_URL=http://127.0.0.1:5431`。

### 3. 启动 PostgreSQL 和 ImgProxy

全新数据库迁移前不要启动 Worker：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d postgres imgproxy
docker compose --env-file build/.env -f build/docker-compose.dev.yml ps
```

PostgreSQL 应显示 `healthy`，`http://127.0.0.1:5431/health` 应返回 200。

### 4. 生成 Prisma Client 并部署迁移

Prisma CLI 不会自动读取 `.env.local`，需要在当前终端显式提供宿主机数据库地址。

PowerShell：

```powershell
$env:DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db exec prisma migrate status --schema prisma/schema.prisma
```

Bash：

```bash
export DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db exec prisma migrate status --schema prisma/schema.prisma
```

普通启动和升级必须使用 `db:deploy`。`db:migrate` 只用于开发者创建 migration；`db:push` 只允许用于明确可丢弃的实验数据库，不能替代正式 migration 历史。

### 5. 启动通用 Worker

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
```

Worker 必须通过 READY 和 capability 检查。后台任务页面应只显示一个当前 READY 实例。

### 6. 启动 Next.js

在 VS Code 中选择 `PixiShelf: debug full stack` 或 `PixiShelf: debug server-side`，也可以执行：

```bash
cd packages/pixishelf
pnpm dev
```

访问：

- 主应用：`http://127.0.0.1:5430`；
- 管理后台：`http://127.0.0.1:5430/admin`；
- ImgProxy：`http://127.0.0.1:5431`。

### 7. 可选 scheduler

确认 App 已运行，且两份环境文件中的 `INTERNAL_JOB_TOKEN` 一致：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml --profile scheduled up -d scheduler
```

### 8. 停止环境

先停止 F5 或 `pnpm dev`，再执行：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml down
```

该命令保留 PostgreSQL 命名卷。除非明确要永久删除本地数据库，否则不要添加 `-v`。

遇到 `P3009`、重复列、migration 校验失败或 Schema 漂移时应立即停止，不要使用 `db:push`、删除数据库卷或盲目标记 migration 完成。

## 常用命令

从仓库根目录执行：

```bash
pnpm check:quick       # 主应用 lint + typecheck
pnpm check:full        # 主应用 lint + typecheck + unit test + build
pnpm worker:typecheck  # Worker 及其 workspace 依赖类型检查
pnpm worker:test       # Worker 及其 workspace 依赖测试
pnpm worker:build      # 构建 Worker 依赖链
pnpm format            # 格式化仓库
```

主应用：

```bash
cd packages/pixishelf
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

浏览器扩展：

```bash
cd packages/pixishelf-extension
pnpm compile
pnpm build
```

CI 当前验证 Prisma Schema 与完整 migration 链、Worker 依赖链的类型/测试/构建，以及 Web lint、typecheck 和单元测试。CI 尚不能替代本地执行 Web 集成/E2E、生产构建和扩展验证。

## 生产部署

生产发布不能简化成无参数的 `docker compose up -d`：生产 Compose 仍包含回滚兼容 `archive-worker`，而生产稳态只允许通用 Worker 消费。

升级、暗启动、消费者切换、验证和回滚入口见：

- [部署基线](./docs/operations/deployment.md)；
- [备份与恢复基线](./docs/operations/backup-and-recovery.md)；
- [Build 与部署资产](./build/README.md)；
- [阶段 1–7 切换记录](./docs/deployment/background-task-cutover-deployment.md)；
- [兼容回滚手册](./docs/deployment/background-task-cutover-rollback.md)。

## 仓库结构

```text
packages/
├── pixishelf/                 Next.js 主应用
├── pixishelf-db/              Prisma Schema、migration 和数据库客户端
├── pixishelf-job-contracts/   后台任务契约
├── pixishelf-job-runtime/     队列与 Worker 运行时
├── pixishelf-job-executors/   后台任务实现
├── pixishelf-worker/          通用 Worker 进程
├── pixishelf-archive-worker/  回滚兼容消费者
├── pixishelf-extension/       WXT 浏览器扩展
├── pixiv-standalone-scanner/  独立元数据路径扫描服务
└── zip-convert/               Pixiv zip/APNG 转换工具

build/                         Dockerfile、Compose 和环境模板
docs/                          架构、设计、ADR、运维和历史记录
scripts/                       仓库辅助脚本
todos/                         尚待收敛的旧 TODO 与技术债材料
```

## 文档与贡献

- [文档索引](./docs/README.md)：所有文档的状态、权威范围和迁移登记；
- [产品基线](./docs/product/product-baseline.md)：目标用户、核心流程、质量优先级和非目标；
- [当前架构](./docs/architecture/current-architecture.md)：组件、依赖、数据流和不变量；
- [领域语境](./CONTEXT.md)：统一业务术语；
- [测试策略](./docs/development/testing-strategy.md)：按变更类型选择验证范围并理解 CI 缺口；
- [备份与恢复](./docs/operations/backup-and-recovery.md)：备份集合、恢复目标和演练门禁；
- [代理规则](./agents.md)：文件命名、测试组织、验证和文档门禁；
- [当前待办](./TODO.md)：下一步可执行工作。

修改产品边界、跨 package 依赖、数据库语义、认证/API、部署拓扑或不可逆技术选择时，必须同步相关文档。普通局部修复不要求创建长设计文档。

## License

[MIT](./LICENSE)
