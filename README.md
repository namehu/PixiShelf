# PixiShelf

PixiShelf 是一个本地优先、自托管的个人媒体收藏系统。它把本地目录、来源元数据和归档任务组织成稳定的作品目录，并提供扫描、整理、检索、浏览和后台媒体处理能力。

当前项目面向单用户、单实例部署。Pixiv 是重要来源之一，但本地 Artwork 身份不由任何外部站点定义；相关领域术语见 [CONTEXT.md](./CONTEXT.md)。

## 核心能力

- 扫描本地图片和视频收藏，解析目录与来源元数据；
- 对 Pixiv metadata 生成只读来源一致性报告，并安全同步显式选中的新增或变化项；
- 管理作品、艺术家、系列、标签、来源引用和本地整理结果；
- 手动从 Pixiv 公共标签接口补全来源标签的翻译、Pixpedia 简介和本地封面；
- 提供响应式画廊、筛选、详情页和沉浸浏览；
- 通过持久 PostgreSQL 队列执行扫描、归档、迁移、替换和媒体维护；
- 通过持久归档收件箱持续添加 URL、FIFO 解析并多选入队；
- 使用 FFmpeg/FFprobe 预生成视频封面、章节图和代表帧；
- 使用 ImgProxy 只读处理原图片和静态派生媒体；
- 使用 Better Auth 数据库会话保护 Web 与管理界面；
- 使用审计、租约、重试和回滚流程保护长任务与文件发布。

## 当前架构

| 组件                         | 责任                                               |
| ---------------------------- | -------------------------------------------------- |
| `@pixishelf/next`            | Next.js 16 Web、API、tRPC、认证与任务控制面        |
| PostgreSQL / `@pixishelf/db` | Prisma Schema、migration、领域数据、会话与任务队列 |
| `@pixishelf/worker`          | 单通用 Worker；解析与 writer 两个固定执行 lane     |
| `@pixishelf/job-*`           | 后台任务契约、运行时和 Executor                    |
| ImgProxy                     | 只读图片与派生媒体处理                             |
| scheduler                    | 可选定时 tick，只调用 App，不直接访问数据库        |

完整组件图、workspace 依赖和数据流见[当前架构](./docs/architecture/current-architecture.md)。

## 技术基线

- Node.js 20 LTS、pnpm 8.15.1；
- Next.js 16.1.1、React 19、TypeScript 5；
- Tailwind CSS 4、Radix UI、TanStack Query、Zustand；
- PostgreSQL 15、Prisma 5、Zod；
- Docker Compose、ImgProxy、FFmpeg/FFprobe；
- Vitest、oxlint、Prettier。

## 本地开发

标准开发拓扑是：PostgreSQL、ImgProxy 和通用 Worker 运行在 Docker 中，Next.js 在宿主机通过 VS Code F5 或 `pnpm dev` 运行。

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
- `PIXISHELF_PUBLIC_DATA_PATH` 是既有 Pixiv 作者/标签图片目录；App 只读，Worker 对同一宿主目录读写；
- 本地完整功能验证时，App 的 `CENTRAL_DISPATCHER_CUTOVER_ENABLED` 与 Worker 的 `WORKER_DISPATCH_ENABLED` 必须同时为 `true`；
- 修改 `BETTER_AUTH_SECRET`、`INTERNAL_JOB_TOKEN` 和 `SCAN_WEBHOOK_TOKEN`，不要复用环境模板中保留的遗留 `JWT_SECRET`；
- `INIT_ADMIN_USERNAME`/`INIT_ADMIN_PASSWORD` 当前不会自动创建账户，首次账户在 `/login` 初始化页面设置；
- 本地 ImgProxy 地址使用 `NEXT_PUBLIC_IMGPROXY_URL=http://127.0.0.1:5431`。

### 3. 启动 PostgreSQL 和 ImgProxy

全新数据库迁移前不要启动 Worker：

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d postgres imgproxy
docker compose --env-file build/.env -f build/docker-compose.dev.yml ps
```

PostgreSQL 应显示 `healthy`，`http://127.0.0.1:5431/health` 应返回 200。

### 4. 生成 Prisma Client 并部署迁移

`db:generate` 只生成 Prisma Client，不要求数据库地址。其他需要数据库连接的 `@pixishelf/db` 脚本
优先使用当前终端显式提供的 `DATABASE_URL`；未提供时会读取 `packages/pixishelf/.env.local`。宿主机运行时
必须确认该文件使用 `127.0.0.1:5432` 或 `localhost:5432`，不要误用 Docker 容器内部的
`postgres:5432` 地址。

PowerShell：

```powershell
$env:DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db db:status
```

Bash：

```bash
export DATABASE_URL='postgresql://pixishelf:password@127.0.0.1:5432/pixishelf?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db db:status
```

普通启动和升级必须使用 `db:deploy`。`db:migrate` 只用于开发者创建 migration；`db:push` 只允许用于明确可丢弃的实验数据库，不能替代正式 migration 历史。

### 5. 启动通用 Worker

```bash
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
```

Worker 必须通过 READY 和 capability 检查。后台任务页面应只显示一个当前 READY 实例。
当前 capability inventory 为 28 个 job type；`SCAN` 支持 v1/v2/v3，`ARCHIVE_IMPORT` 支持 v1/v2，其余 26 类只支持 v1，
共 31 个 type/version 组合。READY 必须覆盖
`ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 两个 lane。

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

CI 当前验证 Prisma Schema 与完整 migration 链、Worker 依赖链的类型/测试/构建，以及在 job 包 `dist`
生成前执行 Web lint、typecheck、单元测试和 production build。主应用因此直接消费 workspace 源码，独立
`dist` 构建只保留为独立编译产物和类型声明的契约验证。CI 尚不能替代本地执行 Web 集成/E2E 和部署冒烟。

## 生产部署

生产只有一个通用 Worker 服务。它允许一项归档 URL 解析与一项 writer 工作同时推进，但所有媒体写仍在 writer lane 全局串行。执行 lane migration 前必须停止写入者、运行专用 audit 并建立数据库与媒体一致性检查点；迁移后不能启动旧消费者。

日常更新可以使用一键脚本，它会按独立 migration → Worker READY/capability → App 的顺序更新同一版本的两个镜像，并在存在执行中任务时默认拒绝操作：

```bash
sudo bash ./scripts/update-production.sh
```

升级、暗启动、消费者切换、验证和回滚入口见：

- [部署基线](./docs/operations/deployment.md)；
- [备份与恢复基线](./docs/operations/backup-and-recovery.md)；
- [Build 与部署资产](./build/README.md)；
- [归档收件箱](./docs/features/archive-intake.md)；
- [归档收件箱切换记录](./docs/deployment/archive-intake-cutover-deployment.md)；
- [阶段 1–7 切换记录](./docs/deployment/background-task-cutover-deployment.md)；
- [历史兼容回滚手册](./docs/deployment/background-task-cutover-rollback.md)。

## 仓库结构

```text
packages/
├── pixishelf/                 Next.js 主应用
├── pixishelf-db/              Prisma Schema、migration 和数据库客户端
├── pixishelf-job-contracts/   后台任务契约
├── pixishelf-job-runtime/     队列与 Worker 运行时
├── pixishelf-job-executors/   后台任务实现
├── pixishelf-worker/          通用 Worker 进程
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
- [权限与接口边界](./docs/security/access-control.md)：调用者、页面、API、服务与存储权限；
- [测试策略](./docs/development/testing-strategy.md)：按变更类型选择验证范围并理解 CI 缺口；
- [备份与恢复](./docs/operations/backup-and-recovery.md)：备份集合、恢复目标和演练门禁；
- [归档收件箱](./docs/features/archive-intake.md)：持续添加、双 lane、批量控制、维护和保留边界；
- [代理规则](./agents.md)：文件命名、测试组织、验证和文档门禁；
- [当前待办](./TODO.md)：下一步可执行工作。

修改产品边界、跨 package 依赖、数据库语义、认证/API、部署拓扑或不可逆技术选择时，必须同步相关文档。普通局部修复不要求创建长设计文档。

## License

[MIT](./LICENSE)
