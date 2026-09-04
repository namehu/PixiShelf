---
status: accepted
date: 2026-09-01
scope: 管理后台通用 Worker Job 事件 SSE transport
last-verified: 2026-09-04
implementation: ../architecture/current-architecture.md
---

# Stream Worker job events over a persistent cursor

## Context

管理页面原先各自轮询任务和明细。归档下载增加字节速度后，继续提高轮询频率会重复传输整页快照，并把实时性成本转移到数据库和 tRPC。Worker 已经把生命周期、阶段、警告和进度持久写入 `SystemJobEvent`，因此不应再建立一套仅归档可用的临时消息协议。

当前部署没有 Redis 或独立消息基础设施。PostgreSQL `LISTEN/NOTIFY` 可以作为唤醒优化，但不能替代持久游标；断线期间的通知不能重放。

## Decision

- 提供会话双层鉴权的 `GET /api/jobs/events`，面向 definition version ≥ 1 的全部 JobType，不创建归档专用 SSE Route。
- 传输版本化 `JobEventDto` 和脱敏 Job 实时摘要；不返回 payload、result、error、lease token 或 lease expiry。
- 使用全局单调 `SystemJobEvent.id` 十进制字符串作为游标。每批最多 200 条，积压时连续追赶；追平后当前 PostgreSQL source 每 500ms 查询一次。
- 事件名为 `jobs.ready`、`jobs.events`、`jobs.reset` 和 `ping`。超前游标触发 reset；15 秒心跳用于穿过代理空闲超时。
- Route 只依赖通用事件源接口。未来可以用 `LISTEN/NOTIFY` 或其他机制唤醒读取，但重放、批次和客户端契约不变。
- admin layout 每个标签页只挂载一个 `BackgroundJobEventProvider`，保留最近 500 条并提供通用订阅数据。页面切换不创建新连接；断线期间页面恢复原有轮询。
- 归档页、任务计划页和后台任务控制台消费同一实时流，并按 JobType/jobId 更新各自缓存；不得把领域判断加入通用 Route。
- `SystemJob.progressData` 作为实时摘要中的版本化聚合数据传输，禁止包含路径、标题、URL 或凭据。它与数值进度和事件在同一个 fenced transaction 中更新。
- 不引入 Redis。当前读取负载由单标签页连接、持久游标、两秒写入限频和断线轮询降级约束；只有实测 PostgreSQL 轮询成为瓶颈时，才考虑 `LISTEN/NOTIFY` 作为唤醒优化，持久事件表仍负责重放。

## Consequences

实时速度和生命周期校准不再依赖高频整页请求，断线仍可从持久游标追赶。代价是 `SystemJobEvent` 写入量增加，因此实时进度使用独立的两秒限频；普通阶段、警告、控制和终态事件不受此限频影响。INFO 进度事件保留 7 天，其余审计事件保留 90 天。

SSE 是传输优化而不是新的事实源。客户端必须忽略未知版本或无效遥测，并定期获取快照；数据库异常关闭连接，客户端重连或回退轮询。反向代理必须禁用响应缓冲和压缩转换。
