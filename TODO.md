# TODO

## 权限与接口边界收尾

当前事实与风险说明见[权限与接口边界](./docs/security/access-control.md)。以下事项完成前，不把实例账户、App、PostgreSQL 或 ImgProxy 暴露给不可信网络或用户。

- [ ] 限制 PostgreSQL 与 ImgProxy 的宿主机端口；评估 ImgProxy 签名 URL 或受保护转发。
- [ ] 在反向代理清除外部 `x-user-session`/`x-pathname`，重写可信 `x-forwarded-for`，并检查生产 Cookie 安全属性。
- [ ] 轮换曾暴露的外部站点会话凭据，并在单独、有恢复依据的操作中清理 Git 历史。
- [x] 补齐代理公共路径与伪造上下文头、共享 tRPC 认证门禁、作品媒体 HTTP 写入口、受保护维护 Action 和 scheduler Token 的隔离回归测试；验证拒绝请求不进入业务服务。
- [ ] 扩展其余 HTTP/tRPC/Server Action 的未授权覆盖，并验证真实 Next.js 异常响应、已授权业务错误与日志的敏感值脱敏；已有范围见[权限回归测试](./docs/security/access-control.md#权限回归测试)。

## 部署实例证据

本节是生产发布与恢复证据，不是待实现功能。详细检查项只在对应部署记录中维护，根 TODO 不再复制逐项清单。

- [ ] 按[归档收件箱切换记录](./docs/deployment/archive-intake-cutover-deployment.md)补齐 commit/tag、镜像 digest、同一停写检查点、migration/双 lane 证据和生产观察。
- [ ] 发布 Worker 健康面板调整，登记 App/Worker 镜像 ID、digest、切换与回归时间，并验证当前可用 Worker 数量和任务执行。
- [ ] 按[后台任务上线后续](./docs/deployment/background-task-follow-up.md)完成尚未登记的生产稳定观察与 scheduler/GC 核对。
- [ ] 保留至少一套最近、可验证恢复的 PostgreSQL/媒体/配置同点检查点，并在隔离环境完成恢复验证。
- [x] 按[艺术家与系列旧字段清理](./docs/features/legacy-identity-retirement.md)在生产完成停写备份、audit/prepare/upgrade 和配套 App/Worker 验证。

## 退役兼容控制面

- [x] 完成艺术家旧字段 `Artist.userId` 的清理实现（另一分叉已完成）。
- [x] 完成系列旧字段 `Artwork.seriesId`、`Series.source`、`Series.externalId` 的清理实现（另一分叉已完成）。
- [x] 后台任务退役第一阶段实现：固定中央执行、移除两枚开关、迁移历史展示与查询，保留旧列双写；见[退役规格](./docs/features/background-task-retirement.md)。
- [ ] 按[退役发布手册](./docs/deployment/background-task-retirement.md)完成 v0.50.8 基线确认、生产升级及至少 7 天观察。
- [ ] 观察通过后独立实施第二阶段：停止目标字段双写、删除旧任务/计划列、审计并收紧数据库约束；不能提前发布删列 migration。
- [ ] 在生产数据副本完成 migration、33 类 job type / 38 个 type-version capability、任务竞态、媒体任务、GC 和应用回滚演练。
- [ ] 根据真实生产数据调整任务告警阈值、GC 批量、日志保留和 Worker 资源限制。

## 可选媒体格式扩展

- [ ] 评估 AVIF、HEIC、HEIF、JXL 的完整处理链路；当前上传、替换和扫描入口继续拒绝这些格式，后续仅在 Sharp、ImgProxy、MIME 和前端展示全部验证通过后逐项开放。
