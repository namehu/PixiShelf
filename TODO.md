# TODO

只记录未完成行动。当前规则从[文档入口](./docs/README.md)查找，完成结果进入对应[验证或发布记录](./docs/records/README.md)，不在此累积调试日志。

## 权限与访问边界

- [ ] 限制 PostgreSQL 与 ImgProxy 宿主机端口；评估 ImgProxy 签名 URL 或受保护转发。
- [ ] 在反向代理清除外部 `x-user-session` / `x-pathname`，重写可信 `x-forwarded-for`，核查生产 Cookie 安全属性。
- [ ] 轮换曾暴露的外部站点凭据；Git 历史清理另行作为有恢复依据的显式操作。
- [ ] 补齐 HTTP/tRPC 领域错误映射、动态消息脱敏和未授权零副作用回归。

依据：[权限与接口边界](./docs/security/access-control.md)。当前仍为单一管理员信任域。

## 生产验证与恢复证据

- [ ] 补齐归档收件箱切换的 commit/tag、镜像 digest、同点检查点、migration、双 lane 验证与生产观察记录。
- [ ] 核对 Worker 健康面板调整的实际发布状态，登记 App/Worker 镜像及任务执行验证；没有发布证据时不直接宣称已发布。
- [ ] 补齐后台任务退役后的原始审计输出、镜像 digest、备份位置、scheduler/GC 稳定观察和恢复演练记录。
- [ ] 在生产数据副本完成 migration、当前 capability 清单、任务竞态、媒体任务、GC 和同点恢复演练；删列后不能只换旧镜像。
- [ ] 保留至少一套近期、已在隔离环境验证可恢复的数据库、原媒体、派生媒体、Pixiv data、配置与程序版本检查点。
- [ ] 根据真实数据调整告警阈值、GC 批量、日志保留与 Worker 资源限制。

操作入口：[部署基线](./docs/operations/deployment.md)、[备份与恢复](./docs/operations/backup-and-recovery.md)；已有证据从[记录索引](./docs/records/README.md)进入。

## 浏览与媒体

- [ ] 核对 WebP 已有用户发布确认与同版本线上集成证据；补齐播放、暂停续播、切图、自动浏览、回看缓存和至少十分钟温控观察，不把 USB 隔离结果当作线上验收。
- [ ] 对实际遇到的 WebP 回退慢播/长停顿选择少量样本复测，区分输入等待、解码吞吐和温控；110% 仅是调查信号。
- [ ] 条件优化：仅在中途独立帧回退的停顿确由历史重解码造成时评估受限 `ps_seek`；需要原生差分与合成状态验证，不能解决从首帧就顺序解码的持续慢播。
- [ ] 条件优化：仅在输入充分、解码为瓶颈且存在安全关键帧时评估依赖帧分组跳过；长依赖链仍不保证实时。
- [ ] 条件优化：仅在大文件内存压力、预算拒绝或进程终止证据支持时设计历史压缩输入释放，同时处理完整前缀、循环和回退。

依据：[WebP 播放器](./docs/architecture/webp-player.md)。OffscreenCanvas、额外并行与 ImageDecoder 由测量决定。

## 媒体格式与兼容

- [ ] 核验共享媒体推断契约的生产发布与历史 `UNKNOWN` 数据；仅在审计表明必要时使用既有 `VIDEO_MEDIA_PROBE` 分页处理，不无条件全库重写。
- [ ] 有明确格式查询或派生规则收益后再评估独立 `format` 字段及分批回填；低频后缀筛选不自动构成迁移理由。
- [ ] 只有生产审计证明分类完整、所有写入/恢复入口正确、回滚版本不再依赖缺失值时，才退役后缀 fallback。
- [ ] `Image` 改名 `Media` 保持为可独立迁移和恢复的候选，不与格式字段变更捆绑。
- [ ] 逐项评估 AVIF、HEIC、HEIF、JXL 的完整接纳链路；当前入口继续拒绝，须验证 Sharp、ImgProxy、MIME 和前端展示后才开放。

验收：App 与 Worker 对同一 fixture 的分类和探测意图一致；不把 migration 默认值当作真实类型。依据：[共享媒体契约](./packages/pixishelf-job-contracts/src/media-types.ts)。

## 性能与接口技术债

- [ ] 修复 `app/api/jobs/events/route.ts` 导出测试辅助函数导致的 Next 路由类型检查错误；在 F03 类型检查中复现，基线已存在，不与去重分批检索混改。
- [ ] 排查批处理 artist、tag、image、raw metadata 数据库写入热点；记录是否值得改及证据，避免重复调查。
- [ ] 逐对整理 API response 类型：Webhook GET 状态 DTO 先规划外部版本兼容，上传/分块、替换、scheduler 保留现有消费者对 `{ error }` 的依赖。目标是明确类型和稳定 `message`，不顺带改变接口行为。

开始前确认影响的产品/接口约束，按[测试策略](./docs/development/testing-strategy.md)选择验证范围。完成后从本页移除，保留结论和证据链接。

## 去重发布后跟进

当前版先上线观察，下列项仅登记，等待逐批授权。详细范围、依赖和验收统一见[去重后续计划](./docs/design/artwork-deduplication/matching-extension.md)。

- [ ] DEDUP-F03：继续压缩分段检索的数据库往返，再推进 10 万／50 万、密集模板、真实解码和并发业务测量。第一批 1 万／10,001 预制特征已验证有界及跨批续跑，但每档仍约 8 分钟／50 万 SQL，公开上限不提高；交付边界见[本批记录](./docs/records/artwork-deduplication-visual-batches-f03-2026-10-27.md)。
- [ ] DEDUP-F04：收集真实版本人工真值，记录漏检/误配后再安排小改进。
