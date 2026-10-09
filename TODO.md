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

## WebP 播放后续（2026-10-09）

当前实现与验证见[生产接入记录](./docs/design/webp-mobile-production.md)。以下优化按触发条件决定，不是本次发布的遗留缺陷，也不要求全部实施。

- [x] 不透明全画布 VP8 flags=0/2 准入扩大，自动化及三张新增素材手机验收通过；提交 `b22655be`，用户确认已发布。
- [ ] 线上作品详情复核播放、暂停续播、切图、自动浏览；连续浏览至少 10 分钟，观察发热后速度、停顿和省略比例。USB 测试不替代应用集成及温控验证。
- [ ] 对剩余回退类别选少量样本测手机吞吐，优先复现实际遇到的慢播／长停顿。输入充分时反复出现明显异常即可进入定位，不必等待全库统计；110% 仅用作调查信号，不承诺所有文件达标。
- [ ] **条件优化：受限 ps_seek 恢复。** 当真实文件在 independent→sequential 回退时反复长停顿，且诊断确认历史帧重解码是主因，再实施。只减少恢复历史画布的解码；需改 C/WASM ABI、状态恢复、预编译及原生差分测试，防止透明／清除／循环画面错误。不能解决从首帧就走顺序路径的持续慢播，也不能自然释放历史输入。
- [ ] **条件优化：依赖帧分组跳过。** 当输入充分的顺序文件持续慢播、解码是主因，并有可安全跳转的关键帧时再评估。需通用时间／依赖索引及合成状态验证；可能减少显示帧数，长依赖链仍不保证实时。复杂度和回归风险高于受限恢复。
- [ ] **独立条件优化：历史压缩输入释放。** 只有大文件内存压力、预算拒绝或进程终止证据支持时再设计；需处理 demux 完整前缀、循环重读和输入预算，不能顺带删掉旧字节。

判断原则：正常浏览没有异常时保留待办即可；可复现的用户体验问题优先于覆盖率数字。OffscreenCanvas、增加并行和 ImageDecoder 仍由瓶颈测量决定，不作为默认下一步。
