---
status: accepted
date: 2026-09-01
scope: 归档媒体下载的后台配置、启动快照与 Provider 限流一致性
last-verified: 2026-09-01
supersedes-in-part: ./0004-run-archive-resolution-in-a-separate-worker-lane.md
implementation: ../features/archive-intake.md
---

# Freeze database-configured archive media concurrency at execution start

## Context

`ARCHIVE_IMPORT` 位于全局并发 1 的 `BACKGROUND_WRITER` lane，但一个作品内部需要并行等待多个远端媒体流。ADR-0004 把这个内部并发固定为 2。固定值便于首次上线，却不能根据远端限流、带宽和部署机器能力调整；环境变量又会把一次产品设置变成 Worker 重启和 Compose 配置问题。

并发同时存在于 Executor worker 数量和 Provider Governor permit 容量。只改变其中一层会造成吞吐没有变化，或使实际远端请求超过任务承诺的上限。运行中动态改变还会让同一次执行缺少可解释的资源边界。

## Decision

- 使用现有 `Setting` 表的逻辑键 `archive_media_concurrency`，有效范围 1–8，缺失或历史无效值回退为 2；不增加环境变量或 Prisma migration。
- 管理后台使用显式保存。存在 `ARCHIVE_IMPORT` 的 `RUNNING`、`PAUSING` 或 `CANCELLING` SystemJob 时，服务端在事务内拒绝保存；排队、暂停、等待重试和终态任务不阻止修改。
- 设置保存与 Executor 启动使用同一个 PostgreSQL advisory transaction lock。Executor 在 fenced 启动事务中读取值并冻结到本次执行。
- 暂停后恢复、失败后重试或重新领取会开始新的执行并重新读取；已经运行的执行不响应后续配置变化。
- 冻结值同时控制 Executor 的媒体 worker 数量，并随每次下载请求传给 Provider Governor。Provider 的全局 lease、处罚和最小请求间隔仍然有效。
- `BACKGROUND_WRITER` lane 并发继续固定为 1；本决策不允许多个归档作品、多个 writer job 或多个 Worker 副本并行写媒体。

## Consequences

管理员无需重启 Worker 即可调节单作品远端并发，且每次执行的行为稳定、可审计。代价是 App 设置服务与 Worker 启动事务形成一项共享锁协议，修改任一侧时必须同时测试“先保存”和“先启动”的竞争顺序。

数据库设置属于控制面数据，应随 PostgreSQL 备份恢复。部署模板不需要出现该键；首次部署自然使用默认值 2。上线后提高到 3–4 前，应观察 Provider 限流、失败率和下载带宽。

