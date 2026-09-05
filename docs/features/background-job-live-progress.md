---
status: current
scope: 后台任务结构化进度、动画识别实时反馈、SSE 降级和事件保留
last-verified: 2026-09-05
sources:
  - packages/pixishelf-job-contracts/src/job-progress-data.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - packages/pixishelf-worker/src/dispatcher.ts
  - packages/pixishelf-job-executors/src/maintenance/webp-animation-scan.ts
  - packages/pixishelf/app/admin/_components/background-job-event-provider.tsx
  - packages/pixishelf/app/admin/tasks/_components/maintenance-card.tsx
---

# 后台任务实时进度

后台任务仍以 PostgreSQL 的 `SystemJob`、`SystemJobEvent` 和全局单调事件 ID 为唯一事实源。管理后台复用
`GET /api/jobs/events`；没有新增 WebSocket、Redis 或第二套领域通知协议。SSE 只减少重复读取，断线和刷新后仍从数据库快照与持久游标恢复。

## 写入与传输契约

- `SystemJob.progressData` 是可空、版本化 JSON。旧任务保持 `null`。
- Worker 在同一个 fenced transaction 中更新 `progress/progressData` 并插入事件；失去 lease/fence 时两者都不写。动画识别的领域微批次把图片状态、任务行聚合检查点和对应的持久游标事件放进同一事务，因此崩溃恢复与已连接 SSE 都不会落在领域状态之后。
- `REALTIME` 普通快照最多每 2 秒持久化一次；`STANDARD` 在变化至少 5%且距离上次写入至少 5 秒时写入，并以 30 秒作为最长静默兜底。
- 阶段真实变化、WARN/ERROR、取消相关状态、强制快照和终态不受普通限频影响。被合并的最后快照在结算前刷新。
- SSE envelope、事件名和游标版本保持 v1；实时摘要新增 `progressData`，仍不返回 payload、result、error 或 lease token。

两秒窗口描述的是普通观察快照的持久化频率，不是领域写入的恢复粒度。动画识别的领域微批次必须
通过 atomic checkpoint 同时提交图片状态、任务聚合和事件；观察快照会等待该提交屏障，避免展示尚未
成为 durable state 的计数。

`animation-scan@v1` 只包含初始化数、总数、已尝试、成功、失败、动图、静态、剩余、活动探测数、并发上限、滚动速率、ETA 和采样时间。不得写入路径、标题、URL 或凭据。消息、错误和失败样本路径继续由隐私模式组件处理，聚合数字不遮挡。

## 动画识别

`WEBP_ANIMATION_SCAN` 依次进入 `INITIALIZING`、`SCANNING`、`COMPLETED`。初始化每 500 条提交并反馈；探测使用 1–8 的内部有界 worker pool，默认由 `ANIMATION_SCAN_CONCURRENCY=4` 控制。分类结果累计 20 条或等待 2 秒即在 fenced 微批次中提交；图片状态、对应的 `progressData` 检查点和事件同事务提交。进程在领域提交后立即退出时，下一次 claim 也会从同一检查点恢复，不能漏计该批；若终态进度已经写入但通用结算尚未完成，也保留 `COMPLETED` 检查点重放结算。

WebP/GIF 的 Sharp 探测运行在任务私有的有界子进程池中，输出管线使用原生 60 秒超时，父进程同时保留硬终止兜底。取消、租约丢失或 Worker 关停时必须终止对应进程并等待退出，避免不可取消的 native metadata 操作越过 Dispatcher 的取消宽限期。该子进程只做媒体探测，不领取任务、不访问 PostgreSQL。单项超过 10 秒只产生一次不含媒体身份的 WARN。失败项继续保持 pending，后续执行会重试；路径 realpath 边界和取消检查不变。生产应先以并发 1 建立基线，再比较并发 4；代表性存储吞吐提升不足 20%时将环境变量回退为 1。

暂停、租约恢复或同一任务重试时，下一次 claim 会把已持久的 `progressData` 交回 Executor。恢复执行保留原总数以及已提交的成功、动图和静态计数，只扫描仍为 pending 的项目；暂停期间新出现的未初始化候选会扩展总数，且初始化数不得超过总数。先前失败项会重新探测，但不会重复累计。中止路径在探测池排空后 best-effort 强制写入 `activeProbes=0`，fence 已失效时安全忽略该尾部快照。

速率取最近 30 秒。只有采样跨度至少 10 秒且存在至少 3 个推进样本时才计算 ETA；初始化、暂停、重试等待和停滞时隐藏 ETA，并显示最近存活采样时间。

## 运行核验记录

2026-09-05 在隔离 PostgreSQL 与临时媒体根上完成了 12,000 项混合 GIF/WebP/PNG/APNG
回归：并发 1 与并发 4 的动图、静态图、失败项计数一致（分别为 5,994 / 5,994 / 12），
并发 4 用时约 10.5 秒，相对并发 1 的约 18.3 秒吞吐提升约 75%、耗时下降约 43%。事件样本中的
`activeProbes` 没有超过冻结的并发上限。真实开发库另完成了 8 张媒体扫描、刷新与多标签恢复、
隐私遮罩和 retention dry-run 核验；暂停/继续、取消、错误恢复和事件分页在隔离库中验证。
开发库中的真实冒烟记录予以保留，但不代表生产 NAS 或反向代理已经完成同等 I/O/网络验证。

## 客户端与保留

admin layout 每标签页只有一个 `BackgroundJobEventProvider`。任务卡、后台 dashboard、详情和事件历史按 `jobType/jobId` 合并同一事件源；mutation 使用返回的准确 job ID。`ready/reset` 触发快照恢复。SSE 正常时停止任务状态高频轮询；断线时活动任务每 3 秒、空闲页每 30 秒兜底。

任务状态合并比较 `updatedAt`：只有更新的 SSE 摘要才能覆盖查询快照，相同时间保留完整查询结果，避免断线时缓存事件遮盖轮询得到的终态。计划任务收到对应类型的入队、启动或控制事件后重新读取计划列表，由数据库确认最新 `lastJobId`；同类型的多个计划不按事件类型猜测归属，普通进度事件不触发计划列表重查。

`JOB_EVENT_RETENTION_CLEANUP` 对 INFO 级 `job.progress` 保留 7 天，对阶段、警告、错误、控制和终态事件保留 90 天，每批事务删除最多 5,000 条，并循环处理至本次过期集合清空。计划默认关闭；首次手动执行固定为 dry-run，核对候选数和 SSE 重连后再启用计划，计划执行才会删除。

## 发布边界

部署 migration 前按备份基线建立并验证 PostgreSQL 检查点。回滚 App/Worker 时保留新增可空列和事件索引。首次生产验证必须记录并发 1/4 的相同分类结果、吞吐比较、事件 dry-run 数量和 SSE 断线重连结果。
