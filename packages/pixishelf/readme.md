---
status: current
scope: Next.js 主应用包职责、目录、包级命令与归档读取诊断
last-verified: 2026-10-22
sources:
  - packages/pixishelf/package.json
  - packages/pixishelf/proxy.ts
  - packages/pixishelf/server/trpc.ts
  - packages/pixishelf/lib/trpc-transport.ts
  - packages/pixishelf/lib/archive-read-timing.ts
---

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
- 所有有效会话账户具有相同的实例管理员能力，没有角色隔离；
- Webhook 与 scheduler 分别使用独立 Bearer Token；
- App 固定创建和控制中央任务，Worker 启动即消费；维护时停止 Worker，两枚切换开关已退役；
- `/admin/archive/inbox` 持久接收 URL，远端解析由 Worker 的 `ARCHIVE_RESOLVE` lane 串行执行；
- `/admin/archive` 提供归档任务分页、筛选、明细和当前页批量控制；
- 归档下载与校验由 `ARCHIVE_DOWNLOAD` lane 执行；正式发布、FFmpeg、扫描和维护由 `BACKGROUND_WRITER` lane 串行负责。三条 lane 可同时推进，各有效并发 1。

完整边界见[当前架构](../../docs/architecture/current-architecture.md)与
[归档收件箱](../../docs/features/archive-intake.md)。

## 归档列表读取诊断

2026-11-12 局部核验：`archive.listTasks`、`job.backgroundDashboard`、`archiveInbox.summary`
分别使用独立 HTTP 请求，概况或统计耗时不会阻塞同批列表返回；其他查询沿用既有传输策略。

以上三个接口每次在 App stdout 输出一条 `message: "archive.read-timing"` 的 info 日志。
浏览器 Network 中查看慢请求响应头 `x-request-id`，按同值 `requestId` 查找对应日志。
该 ID 由服务端生成；请求输入、来源 URL、账户信息、Cookie 和原始错误均不进入耗时日志。

| 字段或阶段                                           | 含义                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `operations`、`status`、`success`                    | tRPC 操作名、HTTP 状态及是否成功                                                                        |
| `durationMs`                                         | Route Handler 开始处理至响应对象生成的总耗时，包含 context 会话校验和 tRPC JSON 编码                    |
| `session`                                            | tRPC context 的会话读取                                                                                 |
| `tasks.records`、`tasks.creators`、`tasks.serialize` | 列表及关联读取、艺术家摘要读取、DTO 组装；未绑定筛选另记 `tasks.unboundIds`                             |
| `dashboard.*`                                        | 状态统计、运行中任务、最近任务、Worker、批次、失败任务及未完成归档计数分别计时，`serialize` 为 DTO 组装 |
| `summary.*`                                          | 收件箱各项统计、当前/最早任务、控制状态、来源事实和 DTO 组装分别计时                                    |
| `phases[].startedAfterMs`、`durationMs`、`success`   | 阶段相对请求开始的偏移、阶段耗时和执行结果                                                              |

并行阶段会重叠，不能把阶段耗时相加作为总耗时。数据库阶段包含连接池等待、传输和 Prisma
处理，不等同于 PostgreSQL 执行计划中的纯 SQL 时间；失败请求记录已结束的阶段。
总耗时不包含 Next.js proxy 会话校验、模块首次加载、反向代理排队、响应传输和浏览器渲染。
如果浏览器等待明显大于日志总耗时，应继续对照这些边界；若某个数据库阶段明显慢，再采集其生产执行计划。

从仓库根目录读取生产日志，实际 Compose 路径按[部署基线](../../docs/operations/deployment.md)核对：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml logs --since=15m --no-color app
```

无需开启全局 SQL 或请求参数日志，也无需新增环境变量。
