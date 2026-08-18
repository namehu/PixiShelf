---
status: current
scope: 阶段 1–7 上线后的稳定观察、阶段 8 门禁和兼容清理待办
last-verified: 2026-08-18
---

# PixiShelf 本次上线后续待办事项

> 起点：2026-08-18 阶段 1–7 已上线并完成人工回归  
> 当前策略：先稳定运行一个完整发布周期，再单独启动阶段 8

## 1. 当前不再需要继续做的事情

- 不再重复阶段 1–7 的功能开发和本次全量人工验收。
- 不再让旧 `archive-worker` 参与正常生产消费。
- 不再进行第二次 Central Dispatcher 切换；生产稳态保持 `true/true`。
- 不因为使用 `latest` 而反复拉取和重建容器。任何新 `latest` 都应视为一次新的发布。
- 不立即删除旧镜像、旧列、兼容 Router 或升级前备份。

## 2. 上线后观察期

阶段 8 最早应在一个完整稳定发布周期之后开始。建议至少满足：

- 连续稳定运行 7–14 天。
- 至少经历一个完整的上海时区 `00:00–08:00` 自动任务窗口。
- 已启用的计划至少成功物化和执行一次；停用计划没有被误触发。
- Worker 心跳稳定，没有长期 `RUNNING`、异常 lease 或短时间大量 `FAILED/RETRY_WAIT`。
- 扫描、归档、视频和维护任务没有新增数据一致性问题。
- GC reconciliation 始终只读，正式 GC 只消费已登记且到期的条目。
- Docker 日志轮转正常，数据库卷和媒体卷容量正常。
- 回滚镜像、数据库 dump 和对应媒体快照仍然可读。

观察节奏：

| 时间 | 检查重点 |
| --- | --- |
| 上线后 24 小时 | App/Worker 错误、任务积压、心跳、租约、媒体 404、计划误触发。 |
| 上线后 72 小时 | 重试趋势、长任务耗时、日志和磁盘增长、派生媒体状态。 |
| 第一个完整自动窗口后 | 计划物化、deadline/SKIPPED、互斥和执行顺序。 |
| 7–14 天 | 决定是否进入阶段 8；未达标则继续观察。 |

常规检查命令：

```bash
cd <生产 Compose 目录>
sudo docker compose ps
sudo docker compose logs --since=24h app worker scheduler
sudo docker compose exec -T worker node dist/healthcheck.cjs --mode=ready
sudo docker compose exec -T worker node dist/capability-audit.cjs
sudo docker system df
sudo du -sh <原媒体宿主机目录>
sudo du -sh <派生媒体宿主机目录>
```

## 3. 近期运维待办

### P0：发布归档

- [ ] 在部署记录中补充生产容器的实际镜像 ID 和 digest，不能只写 `latest`。
- [ ] 记录升级前 PostgreSQL dump、媒体快照、配置备份和旧镜像包的位置及 SHA-256。
- [ ] 将生产 `.env` 权限保持为 `600`，确认它未进入 Git、聊天记录或普通日志。
- [ ] 明确本次上线的切换时间、回归完成时间和负责人。

### P1：运行健康

- [ ] 每日确认只有一个 READY 通用 Worker。
- [ ] 每日确认 `archive-worker` 没有运行。
- [ ] 每日检查非终态任务、租约过期、重试和失败增长。
- [ ] 检查 scheduler 容器状态与数据库计划启用数量一致。
- [ ] 对计划逐项启用；不要为了验证一次性开启全部高成本任务。
- [ ] 首次正式 GC 前审查到期的 `DerivedMediaGcEntry`；reconciliation 继续保持 dry-run。
- [ ] 观察 imgproxy 和 Traefik 的 404/5xx，特别是派生媒体 URL。

### P2：备份演练

- [ ] 在隔离数据库验证 PostgreSQL custom dump 可以成功恢复。
- [ ] 抽样验证 Synology 原媒体和派生媒体快照可以读取。
- [ ] 核对数据库备份与媒体快照属于同一停写时间点。
- [ ] 演练从本地 `pre-central-cutover` 标签或镜像包恢复旧镜像。

## 4. 阶段 8：清理兼容代码

阶段 8 不是本次上线的补丁，而是下一次独立发布。它的目标是删除已经确认不再需要的双轨兼容逻辑，同时确保本次成功版本仍可作为应用级回滚目标。

### 4.1 启动门禁

全部满足后才能立项：

- 观察期达标且没有未解决的 P0/P1 生产事故。
- Central Dispatcher 持续稳定，所有生产任务类型都只走统一队列。
- 没有任何旧 App、旧脚本或旧 Worker 仍在写兼容字段或旧任务状态。
- 数据库中不存在旧消费者依赖的非终态任务。
- 已确认本次版本在 additive schema 上仍能启动，且回滚资料完整。
- 阶段 8 有独立分支、独立 migration、独立测试和独立发布窗口。

### 4.2 代码清理范围

- [ ] 停止 `targetImageId`、`targetPath`、`mode` 与版本化 payload 的双写。
- [ ] 删除旧 `ScheduledTask.time`、`lastTriggeredAt`、`lastTriggeredDate` 语义和兼容读取。
- [ ] 删除旧互斥数组、独立消费者循环和 Next.js 进程内任务队列。
- [ ] 删除只服务旧任务 UI 的 Router、状态拼接和轮询兼容代码。
- [ ] 删除旧 archive-worker 的正常部署入口；是否同时停止构建旧镜像，应由回滚窗口决定。
- [ ] 删除 legacy/central 分支后，收敛为唯一 enqueue、claim、cancel、pause、resume 和事件模型。
- [ ] 评估两枚 cutover 开关是否可以删除；删除后默认行为必须是统一控制面和统一 Worker。

### 4.3 数据库约束与迁移

以下内容应使用独立、可审查的 migration，不要和大范围代码删除混成一次不可定位的变更：

- [ ] 验证现有 `NOT VALID` 历史 CHECK 约束，并先修复不合法历史数据。
- [ ] 在确认所有生产者都已迁移后，将 `availableAt` 收紧为 `NOT NULL`。
- [ ] 加入任务租约字段“全部为空或全部非空”的一致性约束。
- [ ] 加入 `SKIPPED` 状态与 `skipReason/skippedAt` 的一致性约束。
- [ ] 加入计划任务字段成对存在的约束。
- [ ] 旧列的物理删除再延后一个发布周期；先停止读写，再确认没有回滚消费者，最后单独删除。

禁止：

- 重新 baseline 生产数据库。
- 使用 `prisma db push` 代替生产 migration。
- 在同一次发布里删除旧字段、删除旧镜像并失去本次版本的回滚能力。
- 在未核对历史行前直接验证或收紧约束。

### 4.4 阶段 8 验证清单

- [ ] 所有 17 项 capability 仍精确匹配。
- [ ] 一个任务只能由一个 Worker claim。
- [ ] 取消/完成、暂停/恢复、租约过期竞争测试通过。
- [ ] scheduler 重复 tick、跨日、时区和 deadline 测试通过。
- [ ] 扫描、迁移和批量替换可从持久检查点恢复。
- [ ] 视频探测、封面、章节、代表帧和优化任务真实文件测试通过。
- [ ] GC 引用胜出、路径穿越、重新引用和 dry-run 测试通过。
- [ ] production Compose 中只有通用 Worker 是正常消费者。
- [ ] 生产数据副本 migration 和回滚演练通过。
- [ ] App、Worker、Contracts、Runtime、Executors 和 DB 包的类型检查、单测、构建通过。

### 4.5 阶段 8 发布策略

1. 先在生产数据副本验证历史数据与约束。
2. 创建新的数据库和媒体一致性备份。
3. 使用新 tag/digest 发布，不复用本次已经部署过的 `latest` 内容。
4. 保持 scheduler 关闭，先部署 App/Worker 并执行小范围冒烟。
5. 观察至少一个任务窗口，再决定是否删除旧镜像构建和更老备份。
6. 阶段 8 失败时优先回滚应用，不执行 destructive reverse migration。

## 5. 阶段 8 之后

阶段 8 稳定一个发布周期后再评估：

- 删除已经停止读写并确认无回滚消费者的旧数据库列。
- 停止发布 `pixishelf-archive-worker` 镜像并从 CI 中移除。
- 清理 `legacy-rollback` profile。
- 调整备份保留周期，删除不再需要的旧镜像包；至少保留一个最近可恢复版本。
- 根据真实生产数据调整任务 SLA、告警阈值、GC 批量和 Worker 资源限制。

这些工作不属于本次上线，不应提前执行。
