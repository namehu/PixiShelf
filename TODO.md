# TODO

## 权限与接口边界收尾

当前事实与风险说明见[权限与接口边界](./docs/security/access-control.md)。以下事项完成前，不把实例账户、App、PostgreSQL 或 ImgProxy 暴露给不可信网络或用户。

- [ ] 让 `initAdminAction` 在创建账户的同一原子边界内确认系统仍无用户，并覆盖并发初始化测试。
- [ ] 限制 PostgreSQL 与 ImgProxy 的宿主机端口；评估 ImgProxy 签名 URL 或受保护转发。
- [ ] 在反向代理清除外部 `x-user-session`/`x-pathname`，重写可信 `x-forwarded-for`，并检查生产 Cookie 安全属性。
- [ ] 轮换曾暴露的外部站点会话凭据，并在单独、有恢复依据的操作中清理 Git 历史。
- [ ] 建立代理公共路径、HTTP/tRPC/Server Action 未授权分支和敏感值脱敏的统一回归测试。

## 部署实例证据

本节是生产发布与恢复证据，不是待实现功能。详细检查项只在对应部署记录中维护，根 TODO 不再复制逐项清单。

- [ ] 按[归档收件箱切换记录](./docs/deployment/archive-intake-cutover-deployment.md)补齐 commit/tag、镜像 digest、同一停写检查点、migration/双 lane 证据和生产观察。
- [ ] 发布 Worker 健康面板调整，登记 App/Worker 镜像 ID、digest、切换与回归时间，并验证当前可用 Worker 数量和任务执行。
- [ ] 按[后台任务上线后续](./docs/deployment/background-task-follow-up.md)完成尚未登记的生产稳定观察与 scheduler/GC 核对。
- [ ] 保留至少一套最近、可验证恢复的 PostgreSQL/媒体/配置同点检查点，并在隔离环境完成恢复验证。

## 退役兼容控制面

- [ ] 在独立发布项目中退役后台任务切换兼容层：
  - 停止 `targetImageId`、`targetPath`、`mode` 与版本化 payload 的双写，再删除旧 UI/Router/轮询兼容读取；
  - 删除 `ScheduledTask.time`、`lastTriggeredAt`、`lastTriggeredDate` 兼容语义，并收敛为唯一 enqueue/claim/control/event 模型；
  - 在 legacy/central 分支全部退出后删除两枚 cutover 开关；
  - 先验证并修复历史数据，再用独立 migration 收紧 `availableAt`、租约、`SKIPPED` 和计划字段约束；
  - 旧列物理删除至少延后一个发布周期，并在删除前审计回滚消费者。
- [ ] 在生产数据副本完成 migration、28 类 job type / 31 个 type-version capability、任务竞态、媒体任务、GC 和应用回滚演练。
- [ ] 艺术家外部身份稳定运行一个发布周期后，审计回滚镜像并用独立 migration 删除 `Artist.userId`。
- [ ] 系列来源身份稳定运行一个发布周期后，审计 direct/join 漂移并用独立 migration 删除 `Artwork.seriesId`、`Series.source`、`Series.externalId`。
- [ ] 根据真实生产数据调整任务告警阈值、GC 批量、日志保留和 Worker 资源限制。

## 可选媒体格式扩展

- [ ] 评估 AVIF、HEIC、HEIF、JXL 的完整处理链路；当前上传、替换和扫描入口继续拒绝这些格式，后续仅在 Sharp、ImgProxy、MIME 和前端展示全部验证通过后逐项开放。
