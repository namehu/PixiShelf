# PixiShelf

PixiShelf 是一个本地优先、自托管的个人媒体收藏系统。它把本地目录、来源元数据和归档任务组织成稳定的作品目录，并提供扫描、整理、检索、浏览和后台媒体处理能力。

当前项目面向个人、单实例部署；可存在多个账户，但所有已登录账户均属于同一管理员信任域。Pixiv 是重要来源之一，本地 Artwork 身份不由任何外部站点定义。开发前从[文档入口](./docs/README.md)选择阅读路径，术语见 [CONTEXT.md](./CONTEXT.md)。

## 核心能力

- 扫描本地图片和视频收藏，解析目录与来源元数据；
- 对 Pixiv metadata 生成只读来源一致性报告，并安全同步显式选中的新增或变化项；
- 管理作品、艺术家、系列、标签、来源引用和本地整理结果；
- 手动从 Pixiv 公共标签接口补全来源标签的翻译、Pixpedia 简介和本地封面；
- 提供响应式画廊、筛选、详情页和沉浸浏览；
- 通过持久 PostgreSQL 队列执行扫描、归档、迁移、替换和媒体维护；
- 通过持久归档收件箱持续添加 URL、FIFO 解析并自动归档新作品，保留仅解析与批量确认；
- 使用 FFmpeg/FFprobe 预生成视频封面、章节图和代表帧；
- 使用 ImgProxy 只读处理原图片和静态派生媒体；
- 使用 Better Auth 数据库会话保护 Web 与管理界面；
- 使用审计、租约、重试和回滚流程保护长任务与文件发布。

## 当前架构

| 组件                         | 责任                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `@pixishelf/next`            | Next.js 16 Web、API、tRPC、认证与任务控制面          |
| PostgreSQL / `@pixishelf/db` | Prisma Schema、migration、领域数据、会话与任务队列   |
| `@pixishelf/worker`          | 单通用 Worker；解析、下载与 writer 三个固定执行 lane |
| `@pixishelf/job-*`           | 后台任务契约、运行时和 Executor                      |
| ImgProxy                     | 只读图片与派生媒体处理                               |
| scheduler                    | 可选定时 tick，只调用 App，不直接访问数据库          |

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
- App 固定中央入队，Worker 启动即消费；本地维护时停止 Worker，不再依赖切换开关；
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

已有数据库若仍含艺术家或系列旧身份字段，先按[旧字段清理流程](./docs/features/legacy-identity-retirement.md)执行检查、准备和升级；不要直接用以下 `db:deploy` 命令跨过该版本。全新空库继续使用完整 migration 链。

已有一阶段后台任务数据库升级到二阶段时，先按[退役发布手册](./docs/deployment/background-task-retirement.md)停写、备份并执行 `--phase2-before`，再显式 deploy 和 `--phase2-after`；这是删列迁移，不能仅换旧镜像回退。普通容器启动会阻断尚未完成该流程的已有库。

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

Worker 必须通过 READY 和 capability 检查，后台任务页面应只显示一个当前 READY 实例。READY 须覆盖解析、下载与 writer 三个 lane；精确 type/version/lane 集合由上述审计命令与[生产能力清单](./packages/pixishelf-worker/src/production-capabilities.ts)核对，不在启动指南重复维护数量。

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

开发浏览可使用 `http://127.0.0.1:5430/artworks?entry=direct` 跳过内容提示；它不跳过登录验证。

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
pnpm docs:check        # 文档链接、锚点、路径大小写与代码围栏
pnpm docs:diagrams     # 从 Mermaid 源重建 SVG
pnpm docs:diagrams:check # 图源语法和 SVG 同步检查
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

生产升级以[部署基线](./docs/operations/deployment.md)为唯一操作入口；先判断是否需要专项迁移，再进行镜像升级。Worker 启动即消费任务，存在破坏性 migration 时不能把换旧镜像当作通用回滚。

完整检查点与恢复见[备份与恢复](./docs/operations/backup-and-recovery.md)，镜像与挂载资产见 [Build 说明](./build/README.md)，已有发布证据见[记录索引](./docs/records/README.md)。`scripts/update-production.sh` 的适用边界见[工具说明](./scripts/README.md)。

替换或上传中断后如出现 `REPLACE_WRITE_LOCK_BUSY`，应按[备份与恢复基线](./docs/operations/backup-and-recovery.md)先停掉所有 App 副本并核对媒体与替换 manifest，再处理对应目录的锁；不要按锁的时间戳自动清除。

## 仓库结构

```text
packages/
├── pixishelf/                 Next.js 主应用
├── pixishelf-db/              Prisma Schema、migration 和数据库客户端
├── pixishelf-job-contracts/   后台任务契约
├── pixishelf-job-runtime/     队列与 Worker 运行时
├── pixishelf-job-executors/   后台任务实现
├── pixishelf-worker/          通用 Worker 进程
└── pixishelf-webp-player/     浏览器 WebP Worker/WASM 播放器

build/                         Dockerfile、Compose 和环境模板
docs/                          架构、设计、ADR、运维和历史记录
scripts/                       仓库辅助脚本
todos/                         已收敛到根 TODO 的兼容入口
```

## 文档与贡献

- [文档入口](./docs/README.md)：按理解系统、修改功能、验证与部署选择权威文档；
- [文档维护](./docs/development/documentation.md)：正文职责、状态、图示与记录的维护规则；
- [代理规则](./AGENTS.md)：文件命名、测试组织、验证和文档门禁；
- [当前待办](./TODO.md)：下一步可执行工作。

修改产品边界、跨 package 依赖、数据库语义、认证/API、部署拓扑或不可逆技术选择时，必须同步相关文档。普通局部修复不要求创建长设计文档。

## License

[MIT](./LICENSE)
