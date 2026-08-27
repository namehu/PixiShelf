# TODO

## 权限与接口边界收尾

当前事实与风险说明见[权限与接口边界](./docs/security/access-control.md)。以下事项完成前，不把实例账户、App、PostgreSQL 或 ImgProxy 暴露给不可信网络或用户。

- [ ] 让 `initAdminAction` 在创建账户的同一原子边界内确认系统仍无用户，并覆盖并发初始化测试。
- [ ] 为媒体替换、分块上传、章节增删等写 Route 增加 Route 内 Session 复核与未授权零写入测试。
- [ ] 将 `exportNoSeriesArtworksAction`、`updateTagStatsAction` 迁移到受保护 Action Client。
- [ ] 明确单一信任域账户政策；在没有角色模型前，用户管理和系统设置不得提供给不可信账户。
- [ ] 限制 PostgreSQL 与 ImgProxy 的宿主机端口；评估 ImgProxy 签名 URL 或受保护转发。
- [ ] 在反向代理清除外部 `x-user-session`/`x-pathname`，重写可信 `x-forwarded-for`，并检查生产 Cookie 安全属性。
- [ ] 轮换 `zip-convert` 源码中暴露的外部站点会话凭据，从当前代码与 Git 历史移除，并改为运行时秘密注入。
- [ ] 建立代理公共路径、HTTP/tRPC/Server Action 未授权分支和敏感值脱敏的统一回归测试。

## 归档收件箱与双 lane 上线证据

当前功能、资源边界和回滚规则见[归档收件箱](./docs/features/archive-intake.md)。以下是部署实例需要补齐的证据，不是待实现功能：

- [ ] 在[归档收件箱切换记录](./docs/deployment/archive-intake-cutover-deployment.md)填入实际 commit/tag、App/Worker digest、审计时间和切换时间。
- [ ] 登记 PostgreSQL dump、原媒体快照、派生媒体快照、配置副本和校验值，证明它们属于同一停写检查点。
- [ ] 保存非空 PostgreSQL migration 演练的历史任务/领域/媒体计数、迁移耗时、锁/WAL/容量观测与迁移后断言。
- [ ] 保存新 Worker READY、两个 lane、25 类 job type / 27 个 type-version capability、resolver+writer 同时推进和 writer 单执行证据。
- [ ] 完成收件连续添加、刷新恢复、部分失败、多选入队、批量控制、每日 `02:05` 维护和 `02:15` 保留任务的生产观察。

## 2026-08-18 后台任务统一切换历史收尾

状态：旧消费者兼容期已结束。本节保留尚未闭环的历史发布证据；已经被归档收件箱切换取代的代码清理项不再作为当前计划。

详细执行边界见：

- [本次上线后续待办](./docs/deployment/background-task-follow-up.md)
- [最终部署文档](./docs/deployment/background-task-cutover-deployment.md)
- [历史回滚手册](./docs/deployment/background-task-cutover-rollback.md)

### 近期收尾

- [ ] 提交并发布 Worker 健康面板调整：默认只展示当前实例，陈旧心跳折叠为中性“历史实例”；生产验证当前可用 Worker 数量和任务执行不受影响。
- [ ] 在部署记录中补齐生产 App/Worker 的实际镜像 ID、digest、切换时间和回归完成时间，不能只记录可变的 `latest` 标签。
- [ ] 记录升级前 PostgreSQL dump、媒体快照、Compose/环境变量备份、旧镜像包的位置和 SHA-256。
- [ ] 确认生产 `.env` 权限为 `600`，且没有进入 Git、普通日志或非受控文档。
- [ ] 按备份保留策略保留至少一套最近且验证可恢复的完整检查点；旧消费者镜像不能单独作为当前 schema 的回滚依据。

### 稳定观察期

- [ ] 完成上线后 24 小时检查：App/Worker 错误、心跳、任务积压、租约、媒体 404、计划误触发和磁盘容量。
- [ ] 完成上线后 72 小时检查：失败/重试趋势、长任务耗时、日志增长、派生媒体和 GC 状态。
- [ ] 至少经历一个完整的上海时区 `00:00–08:00` 自动任务窗口，核对计划物化、deadline 和 `SKIPPED` 行为。
- [ ] 连续稳定运行 7–14 天；期间每日确认只有一个 READY 通用 Worker 服务，两个 lane 没有同 lane 重叠。
- [ ] 核对 scheduler 容器状态、管理页“自动计划已启用”数量和数据库中的计划启用状态一致。
- [ ] 派生媒体 reconciliation 始终保持 `dryRun=true,reconcile=true`；正式 GC 只消费已登记且到期的条目。
- [ ] 在隔离数据库完成一次 PostgreSQL custom dump 恢复验证，并抽样验证对应 Synology 媒体快照可读。

### 兼容清理与仍保留的 contract 技术债

旧 `archive-worker` workspace、镜像、Compose、CI 和独立循环已经退出当前完成态；其他通用队列兼容字段与约束仍按下面的独立工作项处理。

- [ ] 停止 `targetImageId`、`targetPath`、`mode` 与版本化 payload 的双写。
- [ ] 删除旧 `ScheduledTask.time`、`lastTriggeredAt`、`lastTriggeredDate` 语义和兼容读取。
- [x] 删除旧归档独立消费者循环和正常部署入口。
- [ ] 删除只服务旧任务 UI 的 Router、状态拼接和轮询兼容代码。
- [ ] 收敛为唯一的 enqueue、claim、cancel、pause、resume 和事件模型。
- [ ] 评估并删除两枚 cutover 开关；删除后默认行为必须是统一控制面与通用 Worker。
- [ ] 验证现有 `NOT VALID` 历史 CHECK 约束，并先处理所有不合法历史行。
- [ ] 使用独立 migration 收紧 `availableAt NOT NULL`、租约字段成组、`SKIPPED` 字段一致性和计划字段成对约束。
- [ ] 旧数据库列的物理删除继续延后一个发布周期，不能与阶段 8 的代码清理混在同一次 migration。
- [ ] 在生产数据副本完成 migration、25 类 job type / 27 个 type-version capability、任务竞态、媒体任务、GC 和兼容双 lane schema 的应用回滚演练。
- [ ] 艺术家外部身份稳定运行一个发布周期后，先审计旧消费者与回滚镜像，再用独立 migration 删除 `Artist.userId`。
- [ ] 系列来源身份稳定运行一个发布周期后，审计旧消费者与 direct/join 漂移，再用独立 migration 删除 `Artwork.seriesId`、`Series.source` 和 `Series.externalId`。

### 后续数据库 contract

- [x] 停止构建和发布 `pixishelf-archive-worker` 镜像。
- [x] 从生产 Compose 和 CI 删除旧消费者入口。
- [ ] 删除已经停止读写且确认没有回滚消费者依赖的旧数据库列。
- [ ] 根据真实生产数据调整任务告警阈值、GC 批量、日志保留和 Worker 资源限制。
- [ ] 按备份保留策略清理过期旧镜像和快照，但始终保留至少一个最近且验证可恢复的版本。

## 可选媒体格式扩展

- [ ] 评估 AVIF、HEIC、HEIF、JXL 的完整处理链路；当前上传、替换和扫描入口继续拒绝这些格式，后续仅在 Sharp、ImgProxy、MIME 和前端展示全部验证通过后逐项开放。
