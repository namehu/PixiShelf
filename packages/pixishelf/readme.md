# @pixishelf/next

PixiShelf 的 Next.js 16 主应用，负责 Web 页面、Better Auth、HTTP/tRPC API、管理界面以及后台任务控制面。

项目级环境准备、数据库迁移、Worker 启动和生产部署以根目录 [README](../../README.md) 为准；本文件只描述主应用包。

## 目录边界

```text
app/         App Router 页面和 HTTP Route Handler
server/      tRPC context、procedure 和 routers
services/    领域服务与后台任务控制面
lib/         认证、Prisma 入口、日志和基础设施工具
schemas/     Zod 输入校验
components/  UI 与领域组件
hooks/       React hooks
store/       客户端状态
tests/       包级和集成测试
```

本包没有 `src/` 中间目录。Prisma Schema 和 migration 位于 `../pixishelf-db/`；中央队列由 `../pixishelf-worker/` 消费。

## 开发

先按根 README 启动 PostgreSQL、ImgProxy、migration 和 Worker，再执行：

```bash
pnpm dev
```

主应用通过 TypeScript、Vitest 与 Next.js 配置直接编译 job-contracts、job-runtime 和 job-executors 的
workspace 源码；本地启动和 App production build 不要求预先生成这些包的 `dist`。

主应用监听 `http://127.0.0.1:5430`。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

常用数据库脚本只是对 `@pixishelf/db` 的转发：

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:migrate
pnpm db:studio
```

这些脚本优先使用当前终端的 `DATABASE_URL`；未设置时会读取本目录的 `.env.local`。

普通启动和升级使用 `db:deploy`；`db:migrate` 只用于创建新 migration，`db:push` 不得用于共享、长期或生产数据库。

## 认证与任务边界

- 浏览器登录使用 Better Auth 数据库会话；
- 当前单用户部署中，已登录用户即实例管理员；
- Webhook 与 scheduler 分别使用独立 Bearer Token；
- `CENTRAL_DISPATCHER_CUTOVER_ENABLED=true` 时，App 创建和控制任务，但不消费中央队列；
- `/admin/archive/inbox` 持久接收 URL，远端解析由 Worker 的 `ARCHIVE_RESOLVE` lane 串行执行；
- `/admin/archive` 提供归档任务分页、筛选、明细和当前页批量控制；
- 任务执行、FFmpeg、扫描和受控文件写入由 `BACKGROUND_WRITER` lane 全局串行负责。

完整边界见[当前架构](../../docs/architecture/current-architecture.md)与
[归档收件箱](../../docs/features/archive-intake.md)。
