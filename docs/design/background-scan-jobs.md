# PixiShelf 后台任务化扫描设计

## 背景

当前 Pixiv 扫描由 `POST /api/scan/stream` 直接启动并执行。这个接口同时负责：

- 创建 `system_jobs` 运行锁。
- 创建 `ScanRun` 审计记录。
- 调用 `scan()` 执行真实扫描。
- 通过 SSE 推送进度。
- 在完成、失败、取消时更新 `system_jobs` 和 `ScanRun`。

这种实现能工作，但扫描生命周期仍绑定在一次页面连接上。页面关闭、浏览器刷新、代理断开或移动端休眠时，前端无法自然恢复同一个扫描任务的进度和结果。已有的 `system_jobs` 已经能保存运行状态、进度、取消信号，`ScanRun` 已经能保存长期审计历史，因此下一步应该把“启动任务”和“订阅任务进度”拆开。

## 目标

- 扫描开始后不依赖设置页 SSE 连接持续存在。
- 用户刷新页面或重新打开设置页后，可以恢复看到当前扫描进度。
- 取消扫描通过 `system_jobs.status = CANCELLING` 传播到扫描服务。
- 保留现有扫描历史能力，`ScanRun` 继续承载业务审计。
- 兼容现有 `/api/scan/stream`，允许分阶段迁移前端。
- 第一阶段优先使用当前 Next.js 进程内的异步任务，不引入队列服务。

## 非目标

- 不在本设计阶段修改生产代码。
- 不引入 Redis、BullMQ、MQ 或独立 worker 进程。
- 不实现跨进程任务抢占、断点续扫或失败自动重试。
- 不改变 `ScanRun` / `ScanRunItem` 已有审计字段语义。
- 不把扫描历史保留策略和后台任务化绑定到同一次改造。

## 现有职责分工

### `SystemJob`

`system_jobs` 是运行态任务表，适合保存短期状态：

- `type`：任务类型，例如 `SCAN`、`LOCAL_DIRECTORY_IMPORT`。
- `status`：`PENDING`、`RUNNING`、`CANCELLING`、`COMPLETED`、`FAILED`、`CANCELLED`。
- `progress` / `message`：当前进度。
- `result` / `error`：终态结果或错误。

扫描任务应继续用 `SystemJob` 做互斥锁、进度源和取消信号。

### `ScanRun`

`scan_runs` 是业务审计表，适合保存长期历史：

- 一次扫描、导入或 rescan 的开始、结束、耗时和汇总统计。
- 作品级成功、跳过、失败明细。
- 与 `system_jobs` 通过 `systemJobId` 可空关联。

扫描任务不应把长期历史塞回 `system_jobs.result`。`result` 只保留运行态消费需要的简短结果快照。

## 目标架构

```text
设置页 / webhook / 客户端列表扫描
        |
        v
startScanJob(input)
        |
        |-- createScanJob() -> system_jobs
        |-- startScanRun()  -> scan_runs
        |-- fire-and-forget runScanJob()
        |
        v
返回 { jobId, scanRunId }

设置页
        |
        |-- status 查询或 SSE 订阅 system_jobs
        |-- 历史详情查询 scan_runs
        |-- cancel mutation 更新 system_jobs.status = CANCELLING
```

核心变化是：启动接口只负责创建任务并触发后台执行；进度订阅接口只读 `system_jobs`，不再负责持有真实扫描调用栈。

## 后端设计

### 新增扫描任务服务

建议新增 `services/scan-job-service.ts`，封装扫描任务生命周期。

主要入口：

```ts
export interface StartPixivScanJobInput {
  mode: 'FULL' | 'INCREMENTAL' | 'CLIENT_LIST'
  force?: boolean
  metadataList?: string[]
  trigger: 'settings_page' | 'webhook' | 'client_extension'
}

export interface StartPixivScanJobResult {
  jobId: string
  scanRunId: string
}

export async function startPixivScanJob(input: StartPixivScanJobInput): Promise<StartPixivScanJobResult>
export async function runPixivScanJob(args: { jobId: string; scanRunId: string; input: StartPixivScanJobInput }): Promise<void>
export async function cancelActivePixivScanJob(): Promise<{ success: boolean; jobId?: string }>
export async function getPixivScanJobStatus(jobId?: string): Promise<ScanJobStatusDto | null>
```

`startPixivScanJob()` 负责：

- 校验 scan path。
- 通过 `JobService.createScanJob()` 获取互斥锁。
- 创建 `ScanRun`，写入 `systemJobId`。
- `void runPixivScanJob(...)` 异步执行。
- 返回 `jobId` 和 `scanRunId`。

`runPixivScanJob()` 负责：

- 创建 `ScanRunItem` buffer。
- 调用现有 `scan()`。
- 在 `onProgress` 中节流更新 `system_jobs.progress/message`。
- 在 `checkCancelled` 中读取 `system_jobs.status`。
- 完成时 flush audit buffer，调用 `completeJob()` 和 `completeScanRun()`。
- 取消时 flush audit buffer，调用 `markAsCancelled()` 和 `cancelScanRun()`。
- 失败时 flush audit buffer，调用 `failJob()` 和 `failScanRun()`。

这样 `/api/scan/stream`、webhook scan、未来计划任务都可以复用同一套任务执行逻辑。

### 任务状态 DTO

建议对前端暴露一个稳定 DTO，而不是直接透出 Prisma record：

```ts
export interface ScanJobStatusDto {
  jobId: string
  scanRunId: string | null
  status: 'PENDING' | 'RUNNING' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  progress: number
  message: string | null
  result: unknown
  error: string | null
  startedAt: string
  updatedAt: string
}
```

`scanRunId` 可从 `ScanRun.systemJobId` 反查。若历史记录创建失败，不应阻塞状态查询，返回 `null` 即可。

### API 形态

优先用 tRPC 管理按钮和轮询状态：

- `scan.start(input)`：启动全量、增量、客户端列表扫描。
- `scan.status({ jobId? })`：查询指定 job，或当前/最近一次 scan job。
- `scan.cancel({ jobId? })`：请求取消指定或当前 active scan job。

保留 HTTP/SSE 入口用于兼容：

- `POST /api/scan/stream`：短期内仍可工作。
- 后续兼容实现可以改成：启动后台 job 后，SSE 只订阅 `system_jobs` 状态并转发 progress/terminal 事件。

### 进度订阅策略

第一阶段推荐使用轮询，不急着保留强 SSE 依赖：

- 设置页每 1 到 3 秒调用 `scan.status`。
- `status` 为 `RUNNING` / `CANCELLING` 时持续轮询。
- 终态后停止轮询，并刷新 `ScanHistoryCard`。
- 对实时日志要求不高，日志可以先继续来自前端状态事件和最终结果。

如果要保留 SSE：

- 新增 `GET /api/scan/events?jobId=...`。
- 该接口只循环读取 `system_jobs`，推送 `progress`、`complete`、`error`、`cancelled`。
- SSE 断开不影响真实扫描，因为真实扫描已经在后台任务中执行。

轮询更简单，足够解决页面关闭后恢复问题；SSE 可作为第二阶段体验优化。

## 页面关闭后恢复

设置页挂载时：

1. 调用 `scan.status()` 或现有 `localImport.status` 的扩展版本。
2. 如果存在 `SCAN` 类型 active job，则恢复 UI：
   - `RUNNING`：显示进度、禁用扫描按钮、显示取消按钮。
   - `CANCELLING`：显示“正在取消”，禁用重复取消。
   - `PENDING`：显示“等待执行”。
3. 如果没有 active job，但最近一次 job 是终态，则可显示最后结果，同时 `ScanHistoryCard` 展示长期历史。

恢复不依赖浏览器内存里的 `useScanStore`。`useScanStore` 可以继续负责本页临时展示，但 authoritative state 应来自 `system_jobs`。

## 取消传播

取消流程：

1. 用户点击取消。
2. 前端调用 `scan.cancel({ jobId })`。
3. 后端调用 `JobService.cancelJob(jobId)`，把状态改为 `CANCELLING`。
4. `scan()` 通过 `checkCancelled` 周期性读取 job 状态。
5. 扫描服务检测到取消后返回取消错误或取消结果。
6. runner 统一将 `SystemJob` 标记为 `CANCELLED`，将 `ScanRun` 标记为 `CANCELLED`。

前端不能只 abort 请求来代表取消。abort 只能关闭订阅连接；真正取消必须落库到 `system_jobs`。

## 兼容与迁移

### 阶段一：抽出后台 runner

- 新增 `scan-job-service.ts`。
- `POST /api/scan/stream` 内部调用 `startPixivScanJob()`。
- SSE 连接改为订阅 job 状态，直到终态结束。
- webhook scan 改为复用 `runPixivScanJob()` 或 `startPixivScanJob()`，减少重复审计逻辑。

验收：

- 关闭设置页后扫描仍继续执行。
- 重新打开设置页能看到 active scan job。
- 取消按钮能取消后台扫描。
- 现有扫描历史仍正常写入。

### 阶段二：前端切到 start/status/cancel

- 新增 `useBackgroundScan()` 替代 `useSseScan()`。
- 启动扫描 mutation 返回 `jobId` / `scanRunId`。
- 使用 React Query 轮询 `scan.status`。
- 终态后刷新 scan run list/detail。

验收：

- 全量、增量、客户端列表扫描按钮行为不变。
- 页面刷新后恢复进度。
- 网络短暂断开不导致扫描被误判失败。

### 阶段三：清理旧 stream 语义

- `/api/scan/stream` 保留为兼容层或标记废弃。
- 删除前端对“abort SSE 即取消扫描”的依赖。
- 将扫描、local import、维护任务的状态展示逐步统一到 job status DTO。

验收：

- 旧客户端仍能收到 terminal event。
- 新前端只依赖 start/status/cancel。

## 与现有 local import 的关系

`localImportRouter.start` 已经是 fire-and-forget 模式，并通过 `localImport.status` 轮询状态。后台扫描应优先对齐这个模式，而不是继续扩大 `/api/scan/stream` 的职责。

后续可以把 Pixiv scan 和 local directory import 抽象为同一种 media activity：

```ts
{
  activity: {
    scan: ScanJobStatusDto | null,
    localImport: ScanJobStatusDto | null
  }
}
```

这样设置页可以统一判断媒体扫描忙碌状态，避免 Pixiv scan 和 local import 同时执行。

## 数据库与迁移

第一阶段不需要新增表。

可以考虑的后续字段，但不是后台任务化的前置条件：

- `system_jobs.startedAt` / `finishedAt`：当前只能用 `createdAt` / `updatedAt` 推断运行时间。
- `system_jobs.request`：保存任务输入摘要，例如 mode、trigger、metadataList 数量。注意不要保存大体量 metadataList 或绝对路径。

如果保存 request，应只存安全摘要：

```json
{
  "mode": "CLIENT_LIST",
  "trigger": "settings_page",
  "metadataCount": 120
}
```

不要在 `system_jobs` 中保存用户真实绝对路径或完整 metadata payload。

## 风险与边界

- Next.js 进程重启会中断进程内后台任务。第一阶段接受这个限制，任务可能停在 `RUNNING`，后续需要启动时清理 stale job。
- 多实例部署下，进程内任务不适合跨实例调度。当前 Docker/本地使用模式可以先接受；若要多实例，需要引入外部队列或 worker。
- `metadataList` 如果很大，不应长期存入数据库。启动时可以直接传给 runner；若将来要真正队列化，需要改为临时文件或独立 payload 表。
- `SystemJob.result` 不应成为审计事实来源，只能作为 UI 快速展示的终态快照。
- 后台任务 runner 中任何审计写入失败都应记录日志，但不应掩盖主扫描结果。

## 测试建议

单元测试：

- `startPixivScanJob()` 创建 job、创建 scan run，并返回两个 id。
- 已有 active media scan job 时返回冲突。
- scan path 未配置时返回前置条件错误。
- `runPixivScanJob()` 完成时调用 `completeJob()` / `completeScanRun()`。
- `runPixivScanJob()` 取消时调用 `markAsCancelled()` / `cancelScanRun()`。
- `runPixivScanJob()` 失败时调用 `failJob()` / `failScanRun()`。

集成测试：

- 启动扫描后立即断开订阅，扫描仍能完成。
- 页面恢复查询能读到 active job。
- 点击取消后，下一次 `checkCancelled` 能观察到 `CANCELLING`。
- 终态后扫描历史列表出现对应 `ScanRun`。

手工验证：

- 设置页启动增量扫描，刷新页面，确认进度恢复。
- 启动全量扫描后关闭标签页，稍后打开设置页，确认任务继续或已终态。
- 启动扫描后取消，确认 job 和 scan run 都是取消态。
- 客户端列表扫描仍能写入 `CLIENT_LIST` 模式历史。

## 推荐落地顺序

1. 新增 `scan-job-service.ts`，先让 webhook 和 stream route 共用 runner。
2. 给扫描任务补 `status` / `cancel` tRPC 接口。
3. 把 `/api/scan/stream` 改为兼容订阅层。
4. 新增 `useBackgroundScan()`，设置页切换到 start/status/cancel。
5. 移除前端 “abort SSE = 取消扫描” 的旧行为。
6. 补充页面刷新恢复和取消传播测试。
