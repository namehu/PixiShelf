# PixiShelf 后台任务架构设计

> 状态：已确认，待分阶段实施
> 决策日期：2026-08-14
> 关联文档：[数据模型](./background-task-data-model.md) · [运行手册](./background-task-runbook.md) · [ADR-0003](../adr/0003-unify-background-jobs-under-a-durable-single-worker.md)

## 1. 结论

PixiShelf 的后台任务应统一为 **PostgreSQL 持久化队列 + 单通用 Worker + 全局并发 1**。

- Next.js 只负责管理员 API、任务入队、状态查询和取消等控制请求，不再承载长任务。
- scheduler 只负责按日历与运行窗口物化任务，不直接执行业务。
- 通用 Worker 从 SystemJob 中原子领取任务，并调用按任务类型注册的 Executor。
- Worker 保持在同一 monorepo，但必须成为可独立构建、测试、发布的 workspace package 和容器，禁止继续跨目录引用 Next.js 包源码。
- Worker 第一阶段继续使用 TypeScript/Node；FFmpeg、Sharp、文件系统和数据库才是主要成本，不在缺少性能证据时重写为 Go/Python。
- 部署只启动一个 Worker；数据库全局执行槽租约继续保证即使误启动多个实例，也只有一个任务进入 RUNNING。
- 自动任务统一在 Asia/Shanghai 的 00:00–08:00 窗口内竞争；08:00 后不再领取，未开始的实例标记为 SKIPPED。
- 手动任务可以在窗口外提交和执行，优先级高于自动任务，但不抢占正在运行的任务。
- 任务状态、结构化事件和进程日志分别承担实时状态、审计时间线和运维排障职责。

这是一项架构迁移，不要求一次性重写所有领域服务。现有扫描、归档、FFmpeg、封面和关键帧实现继续作为领域 Executor 使用，先统一生命周期，再逐个优化内部算法。

## 2. 范围

### 2.1 纳入统一队列

- 管理后台“任务管理”页面可触发的维护任务。
- ScheduledTask 管理的所有每日任务。
- 视频探测、封面、章节预览、代表帧和 MP4 优化。
- 归档导入、扫描、本地导入、迁移、批量替换等已使用 SystemJob 的长任务。
- 派生媒体 GC、任务历史清理、事件历史清理。

### 2.2 暂不处理

- 不引入 Redis、RabbitMQ 或云队列。
- 不做多节点高吞吐并行调度。
- 不把所有领域表替换为通用 JSON 任务表；领域检查点仍保留在各自的强类型表中。
- 不在第一阶段建立可由用户任意编排的 DAG 工作流编辑器。

## 3. 现状模块地图

### 3.1 当前入口

真正的任务管理页面是 packages/pixishelf/app/admin/tasks/page.tsx，而 packages/pixishelf/app/admin/page.tsx 是后台概览入口。

当前前端主要集中在：

| 模块 | 当前职责 | 主要问题 |
| --- | --- | --- |
| maintenance-card.tsx | 查询、轮询、Mutation、计划配置、多个任务的结果展示 | 文件过大，任务协议与展示耦合，重复状态映射和表单逻辑 |
| video-keyframe-section.tsx | 代表帧过滤、预览、批量入队、队列控制 | 同时承担配置、队列、候选选择和展示 |
| job.ts Router | 所有任务 tRPC 入口 | 路由数量多；普遍使用 authProcedure，缺少明确 adminProcedure 边界 |
| scheduled-task-service.ts | 定时判定、互斥判断、手动触发 | 同时负责调度和启动业务；“到点即启动”而不是“物化后排队” |
| scheduled-task-registry.ts | 默认任务、说明和 Handler | 多数 Handler 在 Next.js 内启动 fire-and-forget Promise |
| job-service.ts | SystemJob 创建、查询、状态转换以及部分队列 | 多种任务生命周期平铺在同一文件，状态更新缺少统一所有权校验 |
| archive-worker.ts | 归档与关键帧 Worker 进程入口 | 两个消费循环通过 Promise.all 并行，并非全局并发 1 |

### 3.2 当前执行模型

~~~mermaid
flowchart LR
  Admin["Admin Tasks UI"] --> TRPC["job tRPC router"]
  Cron["scheduler container"] --> Tick["Next.js scheduler tick API"]
  Tick --> Schedule["scheduled-task-service"]
  TRPC --> Registry["scheduled-task-registry"]
  Schedule --> Registry
  Registry --> Detached["Next.js 内异步 IIFE<br/>维护任务"]
  TRPC --> MemoryQueue["Next.js 内存消费者<br/>MP4 优化"]
  Detached --> DB["PostgreSQL / SystemJob"]
  MemoryQueue --> DB

  WorkerHost["archive-worker process"] --> ArchiveLoop["Archive loop"]
  WorkerHost --> KeyframeLoop["Keyframe loop"]
  ArchiveLoop --> DB
  KeyframeLoop --> DB
~~~

当前实际存在三套语义：

1. 多数维护任务由 Next.js 中的异步 IIFE 执行。HTTP 请求返回后任务仍依赖 Web 进程存活。
2. MP4 优化写入 SystemJob，但消费者由 Next.js 进程内的单飞 Promise 驱动。
3. 代表帧和归档由独立 Worker 消费；它们已有租约、心跳或领域检查点，是迁移参考。

### 3.3 当前任务清单

| 任务类型 | 触发方式 | 当前执行位置 | 持久恢复能力 | 目标处理 |
| --- | --- | --- | --- | --- |
| REFILL_META_SOURCE | 手动 | Next.js | 无完整租约 | 迁入通用 Worker |
| MEDIA_DERIVED_TAG_SYNC | 手动 | Next.js | 无完整租约 | 迁入通用 Worker |
| WEBP_ANIMATION_SCAN | 手动/定时 | Next.js IIFE | 重启可能滞留 | 迁入通用 Worker |
| VIDEO_MEDIA_PROBE | 手动/定时 | Next.js IIFE | 重启可能滞留 | 拆成工作流并迁入 Worker |
| VIDEO_POSTER_GENERATION | 探测后串行调用 | Next.js IIFE | 领域状态部分可恢复 | 独立 Executor，不再每次全量 GC |
| VIDEO_CHAPTER_PREVIEW_GENERATION | 手动/定时 | Next.js IIFE | 重启可能滞留 | 迁入通用 Worker |
| VIDEO_STREAMING_OPTIMIZATION | 手动 | Next.js 内存消费者 | 有心跳但重启后依赖再次唤醒 | 迁入通用 Worker |
| VIDEO_KEYFRAME_DISCOVERY | 手动/定时 | Worker | 有持久队列 | 接入统一 Dispatcher |
| VIDEO_KEYFRAME_GENERATION | 手动/发现任务 | Worker | 租约、心跳、检查点较完整 | 保留领域能力，统一生命周期 |
| ARCHIVE_IMPORT | 手动/API | Worker | 持久任务与检查点 | 接入统一 Dispatcher |
| SCAN / LOCAL_DIRECTORY_IMPORT | 手动 | Next.js/服务层 | 部分 SystemJob 状态 | 分阶段迁移 |
| MIGRATION / PENDING_REPLACE | 手动 | Next.js/服务层 | 领域级互斥和恢复 | 分阶段迁移 |
| SCAN_RUN_RETENTION_CLEANUP | 定时 | Next.js IIFE | 可重跑 | 迁入 Worker |
| TRIGGER_LOG_RETENTION_CLEANUP | 定时 | Next.js IIFE | 可重跑 | 迁入 Worker |
| DERIVED_MEDIA_GC | 当前隐含在生成任务中 | Next.js/服务层 | 无独立队列 | 新增增量 GC Executor |

## 4. 现状问题与优先级

### P0：正确性与可恢复性

- fire-and-forget 任务随 Next.js 重启中断，SystemJob 可能永久停在 RUNNING 或 CANCELLING。
- completeJob、failJob 等终态更新未统一校验 workerId、attempt 和 leaseToken，旧执行者可能覆盖新执行者结果。
- “只部署一个进程”无法形成正确性保证；当前 Worker 内两个循环本身就在并行。
- 不同任务分别维护互斥数组、advisory lock 和活动状态集合，关系容易遗漏。
- 普通已登录用户即可调用任务 Router；管理操作应收敛到 adminProcedure。

### P1：性能与资源治理

- 视频封面任务每次启动先遍历封面目录清理孤儿文件，工作量与目录总量相关，而不是与本次增量相关。
- 视频探测会把全部 FAILED 重置为 PENDING，可能形成永久失败文件的重复风暴。
- FFprobe、FFmpeg 子进程需要统一超时、取消和输出缓冲上限。
- 多处轮询和逐条数据库更新需要批处理、节流和稳定游标。

### P2：维护性与可观察性

- 页面和 Router 随任务类型线性膨胀。
- 每个任务自行定义进度、取消、失败文案，前后端类型容易漂移。
- SystemJob 只有当前 message/result，没有可查询的结构化执行时间线。
- 默认 Logger 与迁移 Logger 策略不一致；migration.log 当前没有大小或数量限制。

## 5. 目标架构

~~~mermaid
flowchart TB
  subgraph Clients["控制面"]
    UI["Admin Tasks UI"]
    API["Next.js adminProcedure APIs"]
    Scheduler["Scheduler tick"]
  end

  subgraph Application["应用层"]
    Catalog["Task Definition Registry"]
    Enqueue["Job Command Service"]
    Query["Job Query Service"]
    Materializer["Schedule Materializer"]
  end

  subgraph Persistence["PostgreSQL"]
    Scheduled["ScheduledTask"]
    Jobs["SystemJob"]
    Events["SystemJobEvent"]
    Lease["JobResourceLease<br/>global/background-worker"]
    GC["DerivedMediaGcEntry"]
    Domain["领域检查点表"]
  end

  subgraph Worker["pixishelf-worker"]
    Dispatcher["Central Dispatcher<br/>concurrency = 1"]
    Lifecycle["Job Lifecycle + Heartbeat"]
    Executors["Executor Registry"]
    DomainServices["现有领域 Services"]
  end

  UI --> API
  API --> Enqueue
  API --> Query
  Scheduler --> Materializer
  Materializer --> Scheduled
  Materializer --> Jobs
  Enqueue --> Jobs
  Query --> Jobs
  Query --> Events
  Dispatcher --> Lease
  Dispatcher --> Jobs
  Dispatcher --> Lifecycle
  Lifecycle --> Events
  Lifecycle --> Executors
  Executors --> DomainServices
  DomainServices --> Domain
  DomainServices --> GC
~~~

### 5.1 组件职责

| 组件 | 只负责 | 不负责 |
| --- | --- | --- |
| Admin UI | 展示、过滤、配置、提交控制命令 | 推断后端状态、执行任务 |
| Next.js Router | 鉴权、Zod 校验、调用 Command/Query Service | 直接运行 FFmpeg、扫描目录或循环处理数据 |
| Task Definition Registry | 任务元数据、输入 Schema、默认优先级、超时、重试和 Executor 映射 | 保存运行状态 |
| Schedule Materializer | 在每日窗口开始时幂等创建任务实例、窗口结束时跳过未开始任务 | 调用业务 Executor |
| Job Command Service | 入队、取消、暂停、恢复、重试 | 执行业务 |
| Job Query Service | 列表、详情、事件、统计和 Worker 健康状态 | 修改任务 |
| Central Dispatcher | 领取一个任务、持有全局租约、调用 Executor | 包含具体业务逻辑 |
| Job Lifecycle | 心跳、事件、进度节流、状态机、CAS 终态、重试恢复 | 领域数据处理 |
| Executor | 一个任务类型的薄适配器 | 重复实现队列和日志框架 |
| Domain Service | 探测、扫描、生成、归档等领域算法 | 决定全局调度 |

### 5.2 Worker 代码与容器边界

当前 archive-worker 已经是独立容器，但不是独立代码单元：

- 入口直接通过 ../../pixishelf 引用主包的 Prisma、Logger 和 Services。
- 构建复用 packages/pixishelf/tsconfig.json。
- Docker builder 必须复制整个 packages/pixishelf。
- Worker 的实际依赖由 esbuild 跨包打包隐式决定，而不是 package.json 和 TypeScript project boundary 显式约束。

目标依赖图：

~~~mermaid
flowchart TB
  Next["@pixishelf/next<br/>UI / API / admin auth"]
  Worker["@pixishelf/worker<br/>dispatcher / executors"]
  Contracts["@pixishelf/job-contracts<br/>types / Zod payloads / DTOs"]
  Runtime["@pixishelf/job-runtime<br/>queue / lease / lifecycle / events"]
  DB["@pixishelf/db<br/>Prisma schema / migrations / client"]
  Domain["worker-owned domain executors"]

  Next --> Contracts
  Next --> DB
  Worker --> Contracts
  Worker --> Runtime
  Worker --> DB
  Worker --> Domain
  Runtime --> Contracts
  Runtime --> DB
  Next -. forbidden .-> Worker
  Worker -. forbidden .-> Next
~~~

包职责：

| 包 | 内容 | 约束 |
| --- | --- | --- |
| @pixishelf/db | Prisma Schema、migrations、生成 Client | 移动目录不改变表名、列名和既有 migration 历史 |
| @pixishelf/job-contracts | 任务类型、状态、Payload Schema、DTO、错误码 | 不依赖 Next.js、React、Prisma 和文件系统 |
| @pixishelf/job-runtime | claim、租约、心跳、CAS、事件和恢复 | 不包含视频、扫描、归档等具体业务 |
| @pixishelf/worker | Dispatcher、Executor Registry 和后台领域执行器 | 独立 tsconfig/package/container；不从 @pixishelf/next 导入 |
| @pixishelf/next | UI、adminProcedure、任务入队和查询 | 不直接访问媒体写目录或启动长进程 |

拆分采用同一 pnpm monorepo，不拆成独立 Git 仓库。这样既能独立部署，又能原子修改数据库契约、任务协议和调用方。

语言选型：

- TypeScript/Node 继续承担任务编排、数据库状态机和外部进程控制。
- FFmpeg/FFprobe、Sharp/libvips、网络和磁盘 I/O 是主要性能成本；换语言不会直接加速这些组件。
- Go 只在性能剖析证明 Node 调度、内存或进程管理本身成为瓶颈后评估。
- Python 仅在未来引入模型推理、OCR 或计算机视觉算法时作为专用 Executor 服务评估。
- task type、definitionVersion、payload 和事件协议保持语言无关，因此未来可以添加异构 Worker，而无需现在承担双技术栈成本。

### 5.3 Worker 数量与锁

生产部署的期望副本数是 1，但仍必须有数据库栅栏：

1. Dispatcher 在短事务中序列化 claim。
2. 事务验证 global/background-worker 执行槽不存在或已过期。
3. 按有效优先级选择一个可运行 SystemJob。
4. 同一事务写入 RUNNING、workerId、attempt、leaseToken、leaseExpiresAt，并占用全局执行槽。
5. Worker 每 30 秒续租任务与全局执行槽。
6. 完成、失败、取消和重试都使用 id + workerId + attempt + leaseToken 做 CAS。
7. 终态事务成功后释放执行槽。

不在整个任务期间持有 PostgreSQL 事务锁或 advisory session lock。长锁会占用连接，并在连接池切换时产生不可控行为。

~~~mermaid
sequenceDiagram
  participant W as Worker
  participant DB as PostgreSQL
  participant E as Executor

  W->>DB: claimNextEligibleJob()
  Note over DB: 短事务：检查全局执行槽<br/>选择任务并写入租约
  DB-->>W: job + leaseToken
  W->>DB: append STARTED event
  W->>E: execute(context)
  loop every 30s
    W->>DB: CAS heartbeat job + global lease
  end
  E-->>W: result
  W->>DB: CAS complete + event + release lease
~~~

### 5.4 调度窗口、优先级与老化

全局策略：

- 时区：Asia/Shanghai。
- 自动窗口：00:00（含）到 08:00（不含）。
- 每日首次 scheduler tick 幂等物化所有启用的 DAILY 任务。
- 每个自动实例复制 ScheduledTask 的 priority 和 config 快照。
- 自动实例的 availableAt 是当天 00:00，deadlineAt 是当天 08:00。
- 08:00 后仍为 PENDING 或 RETRY_WAIT 的自动实例进入 SKIPPED，skipReason 为 WINDOW_EXPIRED。
- 已经 RUNNING 的任务不强杀，允许软完成；后续自动任务不再领取。
- 手动实例 deadlineAt 为空，因此窗口外也可执行。
- 手动任务不抢占当前 RUNNING，只影响下一次 claim 顺序。

排序规则为：

1. effectivePriority 升序，数值越小越优先。
2. availableAt 升序。
3. createdAt 升序。
4. id 升序，保证稳定顺序。

有效优先级采用缓存老化：

effectivePriority = max(0, queuePriority - floor(waitMinutes / 30))

Dispatcher 每次 claim 前只更新一小批候选任务的 effectivePriority，避免全表更新。手动任务使用更高优先级带，但仍通过同一排序和全局执行槽。

~~~mermaid
flowchart TD
  Tick["scheduler tick"] --> Window{"00:00 <= now < 08:00?"}
  Window -- No --> Expire["将过期自动实例标记 SKIPPED"]
  Window -- Yes --> Materialize["幂等物化今日自动实例"]
  Materialize --> Queue["PENDING queue"]
  Manual["手动提交"] --> Queue
  Queue --> Slot{"全局执行槽空闲?"}
  Slot -- No --> Wait["等待下次轮询"]
  Slot -- Yes --> Claim["按有效优先级领取 1 个"]
  Claim --> Run["RUNNING"]
  Run --> Finish["完成 / 失败 / 取消 / 重试"]
~~~

### 5.5 状态机

~~~mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> RUNNING: claim
  PENDING --> PAUSED: pause before claim
  PENDING --> CANCELLED: cancel
  PENDING --> SKIPPED: window expired
  RETRY_WAIT --> PENDING: availableAt reached
  RUNNING --> COMPLETED: CAS success
  RUNNING --> FAILED: terminal error
  RUNNING --> RETRY_WAIT: recoverable error
  RUNNING --> PAUSING: pause requested
  PAUSING --> PAUSED: executor checkpointed
  PAUSED --> PENDING: resume
  RUNNING --> CANCELLING: cancel requested
  CANCELLING --> CANCELLED: executor stopped
  RUNNING --> PENDING: expired lease and attempts remain
  RUNNING --> FAILED: expired lease and attempts exhausted
~~~

任务终态为 COMPLETED、FAILED、CANCELLED、SKIPPED。终态不可被普通进度更新覆盖。

## 6. 任务关系与资源影响

### 6.1 不做通用 DAG 的原因

当前关系主要是固定领域流水线，而不是用户自定义工作流。第一阶段在代码 Registry 中声明 prerequisites、produces、resourceScope 和 defaultRetryPolicy；运行时通过 parentJobId 表示流水线归属。只有前置步骤成功后，父 Executor 才创建下一子任务。这样能明确关系，又避免过早引入通用依赖图引擎。

### 6.2 视频维护流水线

~~~mermaid
flowchart LR
  Parent["VIDEO_MEDIA_MAINTENANCE<br/>parent job"] --> Classify["CLASSIFY_UNKNOWN_MEDIA"]
  Classify --> Probe["VIDEO_MEDIA_PROBE"]
  Probe --> Poster["VIDEO_POSTER_GENERATION"]
  Probe --> Discovery["VIDEO_KEYFRAME_DISCOVERY"]
  Discovery --> Keyframes["VIDEO_KEYFRAME_GENERATION"]
  Poster -. old reference .-> GC["DERIVED_MEDIA_GC"]
  Keyframes -. old generation .-> GC
~~~

规则：

- VIDEO_MEDIA_PROBE 不再隐式执行目录级孤儿清理。
- 默认封面生成作为独立子任务，失败不会抹掉探测结果。
- 代表帧发现依赖可用的 duration/source fingerprint；缺少时可以创建明确的探测前置任务。
- 领域子任务的结果分别保存，父任务汇总成功、部分失败和告警。

### 6.3 资源影响矩阵

全局并发 1 已阻止后台任务相互并行，但仍记录资源范围，作为审计、未来扩容和 API 直接写入保护。

| 任务类别 | 数据库 | 原始媒体目录 | 派生媒体目录 | 网络 | 外部进程 | 关系 |
| --- | --- | --- | --- | --- | --- | --- |
| 元数据补全/标签同步 | 读写 | 只读或不访问 | 不访问 | 否 | 否 | 可重试、幂等 |
| WebP 动画识别 | 读写 | 只读 | 不访问 | 否 | Sharp | 与扫描共享媒体快照 |
| 视频探测 | 读写 | 只读 | 不访问 | 否 | ffprobe | 为封面/关键帧提供元数据 |
| 视频封面 | 读写 | 只读 | 读写 | 否 | ffmpeg | 替换引用时写入 GC |
| 章节预览 | 读写 | 只读 | 读写 | 否 | ffmpeg | 源指纹变化后重建 |
| 代表帧 | 读写 | 只读 | 读写 | 否 | ffprobe/ffmpeg | 保留 staging/published 语义 |
| MP4 优化 | 读写 | 读写 | 不访问 | 否 | ffmpeg | 必须使用临时文件和原子替换 |
| 归档导入 | 读写 | 读写 | 可选 | 是 | 可选 | 保留 staging/revision 发布 |
| 扫描/本地导入 | 读写 | 读写 | 不访问 | 否 | 可选 | 与媒体根写操作互斥 |
| GC | 读写 | 不访问 | 删除 | 否 | 否 | 删除前再次验证无引用 |

## 7. 派生媒体 GC

### 7.1 为什么不能每次视频探测都全量清理

当前 runVideoPosterGenerationJob 在每次执行开始时调用 cleanupOrphanedPosters，遍历整个封面目录并逐个查询引用。媒体量增加后，这会让一次增量探测承担与总目录规模相关的成本。

目标采用两级策略：

1. **增量 GC**：封面、章节或关键帧引用被替换/删除时，在同一数据库事务中写入 DerivedMediaGcEntry。GC Executor 小批量删除，并在删除前再次验证没有任何有效引用。
2. **周期对账**：每周执行一次 reconciliation，默认 dry-run，比较数据库引用和派生目录。只有管理员确认或配置开启后才删除发现的额外孤儿文件。

删除必须满足：

- 相对路径通过派生媒体根目录安全校验。
- 文件不属于临时生成中的活动任务。
- 数据库中没有存活引用。
- notBefore 已到，给并发提交和回滚预留保护期。
- 失败按有限次数退避重试，最终进入 FAILED 并告警。

## 8. 可观察性

### 8.1 三层数据

| 层 | 内容 | 消费者 | 保留 |
| --- | --- | --- | --- |
| SystemJob | 当前状态、汇总进度、租约、结果 | 列表、Dispatcher | 365 天 |
| SystemJobEvent | 状态变化、阶段、节流进度、重试、告警 | 任务详情时间线、审计 | 90 天 |
| stdout JSON log | 结构化上下文、错误栈、运行耗时 | Docker/运维 | 10 MB × 5/容器 |

事件和日志都必须包含 jobId、taskType、attempt、workerId、stage 和 event。日志额外保留错误栈；数据库事件只保存适合界面展示的已截断信息。

进度写入策略：

- 状态、阶段、告警和终态始终写事件。
- 百分比至少变化 5%，且距上一条进度事件至少 30 秒，才写新的进度事件。
- 心跳只更新租约，不写事件和 info 日志。
- 单条媒体处理细节使用 debug，生产默认关闭。

### 8.2 前端实时更新

第一阶段保留 TanStack Query 轮询，但统一为一个 dashboard 查询：

- 有活动任务时每 2 秒查询一次。
- 仅有排队任务时每 5 秒。
- 无活动任务时每 30 秒或窗口聚焦时刷新。
- 任务详情按 jobId 增量读取 afterEventId 后的事件。

后续如果增加 SSE，只替换传输方式，不改变 SystemJobEvent 协议。

## 9. 前端重构

建议目录：

~~~text
app/admin/tasks/
  page.tsx
  _components/
    task-dashboard.tsx
    task-summary.tsx
    task-group.tsx
    task-card.tsx
    task-status-badge.tsx
    task-progress.tsx
    task-actions.tsx
    task-schedule-form.tsx
    task-event-timeline.tsx
    video-keyframe-config.tsx
    video-maintenance-result.tsx
  _hooks/
    use-task-dashboard.ts
    use-task-actions.ts
    use-job-events.ts
  _lib/
    task-view-model.ts
    task-result-formatters.ts
~~~

拆分原则：

- page.tsx 只负责页面框架。
- dashboard hook 统一查询和自适应轮询，不让每张卡单独建立查询。
- 通用 TaskCard 接收 view model，不认识具体 tRPC procedure。
- 任务特有配置和结果通过 Registry slot 注入，不在一个 900 行组件里堆条件分支。
- Server 返回规范化 JobSummary、JobDetail、JobEvent DTO，前端不再手写与 Prisma 相似但不一致的类型。
- 破坏性操作使用确认对话框；图标按钮提供 aria-label；运行状态不能只靠颜色表达。

## 10. 后端建议目录

~~~text
services/background-jobs/
  task-registry.ts
  job-command-service.ts
  job-query-service.ts
  job-lifecycle.ts
  job-event-service.ts
  schedule-materializer.ts
  worker-dispatcher.ts
  worker-lease.ts
  executors/
    refill-meta-source-executor.ts
    media-derived-tag-sync-executor.ts
    webp-animation-scan-executor.ts
    video-media-maintenance-executor.ts
    video-chapter-preview-executor.ts
    video-streaming-optimization-executor.ts
    video-keyframe-executor.ts
    archive-import-executor.ts
    derived-media-gc-executor.ts
~~~

迁移期间 Executor 只适配现有服务，不复制领域实现。例如 video-keyframe-service.ts 继续拥有代表帧策略，Executor 只把统一 JobContext 转换成它需要的回调。

## 11. 安全边界

- 所有任务管理 Mutation 和敏感 Query 使用 adminProcedure。
- scheduler tick 继续使用 INTERNAL_JOB_TOKEN，且只能物化任务，不能传入任意 task type/payload。
- 所有 task payload 由 Registry 对应的 Zod Schema 验证。
- 文件路径先转换为允许根目录下的规范相对路径，不把任意绝对路径保存为可直接执行输入。
- FFmpeg/FFprobe 使用 spawn 或 execFile 参数数组，禁止 shell 拼接。
- 子进程统一设置超时、输出缓冲上限，并响应 AbortSignal。
- Worker 日志不记录 Token、Cookie、完整环境变量或未经脱敏的用户输入。

## 12. 目标验收标准

- Next.js 重启不会让已入队任务丢失，也不会让维护任务永久停在 RUNNING。
- Worker 镜像不复制或编译 @pixishelf/next 源码，并能独立执行 build、test 和启动健康检查。
- @pixishelf/worker 不存在指向 packages/pixishelf 的相对源码导入。
- 即使同时启动两个 Worker，也只能有一个 SystemJob 处于有效执行租约中。
- 所有终态更新都有 leaseToken CAS，过期 Worker 不能覆盖新结果。
- 自动任务只在 00:00–08:00 被领取，未轮到的任务可解释地进入 SKIPPED。
- 管理员能看到任务排队、领取、阶段、进度、重试、取消、失败和完成时间线。
- 视频探测不再触发目录级孤儿封面全量扫描。
- GC 删除前总是复核数据库引用和路径边界。
- 生产日志自动轮转，单个容器最多保留约 50 MB。
- 管理页面不再为每个任务复制查询、轮询、状态和操作逻辑。
- 现有关键帧检查点、归档 staging 和原子发布能力不退化。
