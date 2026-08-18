# TODO

## 2026-08-18 后台任务统一切换上线后续处理

状态：阶段 1–7 已上线并完成人工回归，先进入稳定观察期；阶段 8 必须作为后续独立发布处理。

详细执行边界见：

- [本次上线后续待办](./docs/deployment/background-task-follow-up.md)
- [最终部署文档](./docs/deployment/background-task-cutover-deployment.md)
- [回滚手册](./docs/deployment/background-task-cutover-rollback.md)

### 近期收尾

- [ ] 提交并发布 Worker 健康面板调整：默认只展示当前实例，陈旧心跳折叠为中性“历史实例”；生产验证当前可用 Worker 数量和任务执行不受影响。
- [ ] 在部署记录中补齐生产 App/Worker 的实际镜像 ID、digest、切换时间和回归完成时间，不能只记录可变的 `latest` 标签。
- [ ] 记录升级前 PostgreSQL dump、媒体快照、Compose/环境变量备份、旧镜像包的位置和 SHA-256。
- [ ] 确认生产 `.env` 权限为 `600`，且没有进入 Git、普通日志或非受控文档。
- [ ] 保留 `pre-central-cutover` 旧镜像、升级前数据库 dump 和对应媒体快照，阶段 8 稳定完成前不得删除。

### 稳定观察期

- [ ] 完成上线后 24 小时检查：App/Worker 错误、心跳、任务积压、租约、媒体 404、计划误触发和磁盘容量。
- [ ] 完成上线后 72 小时检查：失败/重试趋势、长任务耗时、日志增长、派生媒体和 GC 状态。
- [ ] 至少经历一个完整的上海时区 `00:00–08:00` 自动任务窗口，核对计划物化、deadline 和 `SKIPPED` 行为。
- [ ] 连续稳定运行 7–14 天；期间每日确认只有一个 READY 通用 Worker，旧 `archive-worker` 没有运行。
- [ ] 核对 scheduler 容器状态、管理页“自动计划已启用”数量和数据库中的计划启用状态一致。
- [ ] 派生媒体 reconciliation 始终保持 `dryRun=true,reconcile=true`；正式 GC 只消费已登记且到期的条目。
- [ ] 在隔离数据库完成一次 PostgreSQL custom dump 恢复验证，并抽样验证对应 Synology 媒体快照可读。

### 阶段 8：清理兼容代码

只有稳定观察期完成、没有未解决的 P0/P1 生产问题，并确认所有生产任务都只走统一队列后才能启动。

- [ ] 停止 `targetImageId`、`targetPath`、`mode` 与版本化 payload 的双写。
- [ ] 删除旧 `ScheduledTask.time`、`lastTriggeredAt`、`lastTriggeredDate` 语义和兼容读取。
- [ ] 删除旧互斥数组、独立消费者循环和 Next.js 进程内任务队列。
- [ ] 删除只服务旧任务 UI 的 Router、状态拼接和轮询兼容代码。
- [ ] 收敛为唯一的 enqueue、claim、cancel、pause、resume 和事件模型。
- [ ] 评估并删除两枚 cutover 开关；删除后默认行为必须是统一控制面与通用 Worker。
- [ ] 验证现有 `NOT VALID` 历史 CHECK 约束，并先处理所有不合法历史行。
- [ ] 使用独立 migration 收紧 `availableAt NOT NULL`、租约字段成组、`SKIPPED` 字段一致性和计划字段成对约束。
- [ ] 旧数据库列的物理删除继续延后一个发布周期，不能与阶段 8 的代码清理混在同一次 migration。
- [ ] 在生产数据副本完成 migration、17 项 capability、任务竞态、媒体任务、GC 和应用回滚演练。

### 阶段 8 稳定之后

- [ ] 确认不再需要应用级旧消费者后，停止构建和发布 `pixishelf-archive-worker` 镜像。
- [ ] 从生产 Compose 删除 `legacy-rollback` profile，并清理对应 CI 配置。
- [ ] 删除已经停止读写且确认没有回滚消费者依赖的旧数据库列。
- [ ] 根据真实生产数据调整任务告警阈值、GC 批量、日志保留和 Worker 资源限制。
- [ ] 按备份保留策略清理过期旧镜像和快照，但始终保留至少一个最近且验证可恢复的版本。

## 可选媒体格式扩展

- [ ] 评估 AVIF、HEIC、HEIF、JXL 的完整处理链路；当前上传、替换和扫描入口继续拒绝这些格式，后续仅在 Sharp、ImgProxy、MIME 和前端展示全部验证通过后逐项开放。

## 移除 Thumbor 视频截帧服务

状态：待处理

### 背景

视频封面链路已经调整为：

- 使用 FFmpeg 提前生成静态 WebP 封面。
- 使用 ImgProxy 对静态封面进行缩放、格式处理和缓存。
- 静态封面不存在或生成失败时显示占位图，不再实时截帧。
- 作品详情、全屏预览和沉浸浏览继续通过视频播放器加载原始视频。

因此，Thumbor 已经不在正常业务链路中使用。目前仅在 `packages/pixishelf/lib/image-loader.js` 中保留一个兼容兜底：当原始视频路径被直接传给 `next/image` 时，通过 Thumbor 的 `filters:still(1)` 实时截帧。

### 后续清理事项

- [ ] 再次确认所有封面和缩略图入口都使用 `MediaThumbnail`，不存在把原始视频路径传给 `next/image` 的场景。
- [ ] 移除 `image-loader.js` 中的 Thumbor 地址和视频实时截帧分支，并为误传视频路径保留明确的占位或错误处理。
- [ ] 移除 `NEXT_PUBLIC_THUMBOR_VIDEO_URL`、`THUMBOR_HOST_PORT` 及构建时环境变量替换逻辑。
- [ ] 从开发和部署 Docker Compose 中移除 Thumbor 服务、端口、卷挂载及相关路由。
- [ ] 删除 `build/thumbor` 镜像构建配置。
- [ ] 更新 `README.md`、`DEPLOYMENT.md`、架构文档和代理启动说明中的 Thumbor 内容。
- [ ] 停止并删除现有 `thumbor_video` 容器。
- [ ] 回归验证普通图片、静态视频封面、封面缺失占位、视频播放以及 GIF/WebP 处理链路。

### 注意

在代码、环境变量和部署配置清理完成前，不直接永久删除 Thumbor 配置，以免遗留页面触发旧兜底后出现不可定位的图片加载失败。
