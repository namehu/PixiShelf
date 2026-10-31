---
status: current
scope: Web 视频播放副本的生成、选择、失效、清理与升级边界
last-verified: 2026-10-31
sources:
  - packages/pixishelf-job-executors/src/video-playback/
  - packages/pixishelf/services/video-playback-service.ts
  - packages/pixishelf/hooks/use-video-playback-source.ts
  - packages/pixishelf-db/prisma/schema.prisma
---

# 视频播放副本

原片保留，只读生成较小的播放副本，改善高码率视频在带宽受限网络中的播放。第一版覆盖 Web 作品详情与沉浸浏览，浏览不触发转码。MP4 无损优化仍是独立功能：它调整原片封装，本功能重新编码到派生存储。

## 操作与播放

作品管理媒体列表支持单视频及多选「生成播放副本」，显示任务状态、进度、已发布副本大小和失败／跳过原因，并提供重试、取消、清理入口。每个视频独立创建 `VIDEO_PLAYBACK_GENERATION`，同视频已有活动任务则复用；普通入队和重试共用媒体 advisory lock。沿用串行 `BACKGROUND_WRITER` 队列，其他维护任务可能等待。失败不自动重复高成本编码，手动重试从头开始；暂停后恢复也重新编码。

有效副本默认以「流畅」播放，可切换「原片」。切换保留时间位置、播放或暂停状态、音量、静音及倍速；选择仅属于当前视频。原片路径、媒体 ID、媒体计数、章节、书签和阅读记录不因副本变化而改变。尚未分类的旧视频沿用扩展名识别，不在生成或读取时回填分类。

没有副本或源绑定失效时播放原片；副本读取失败时重新解析源并回退原片。原片正在受控写入时显示暂不可用，缺失时显示缺失状态。原片失效后不自动重建副本。管理列表只查数据库，不逐项访问 NAS；实际准备播放时才检查文件证据。列表显示已发布记录，不保证其尚未被外部 NAS 操作失效。

## 固定编码档位

策略 `SDR_1080P_V1`：MP4、H.264 `libx264 veryfast`、faststart，CPU 编码；横屏上限 1920×1080、竖屏上限 1080×1920，保持显示比例，不放大，输出偶数尺寸。保留原帧率与完整时间轴。视频目标和 VBV 最大码率均 4 Mbps、缓冲 8 Mb；默认音轨优先，否则首条音轨，AAC 双声道 128 kbps；无音频则不添加音轨。

普通 SDR 可生成；PQ、HLG、Dolby Vision 明确拒绝，暂不提供色调映射、字幕烧录或多音轨切换。不新增实时转码、HLS、多档自适应、Android 选择副本或硬件加速配置。输出不小于原片时跳过发布并说明原因。4 Mbps 是编码档位，不承诺任意外网环境下均不卡顿。

## 存储与一致性

副本位于现有派生媒体根下 `video/playback/<imageId>/<generation>.mp4`，不与原片同目录；容器使用既有共享派生挂载。一个 `Image` 最多关联一条 `MediaVideoPlayback` 当前发布记录，保存 generation、源内容版本、文件 stat 证据、策略版本、输出路径和媒体参数；生成状态仍在 `SystemJob`。

生成前检查活动作品、源路径、写入门禁和文件证据，捕获目录快照，并预登记临时文件与最终路径的 GC 意图。编码后验证封装可读性、编码、时长、尺寸和大小；在 Worker 发布围栏内锁定作品、复核源与目录快照，rename 后提交发布记录及任务结果。文件完成不代表发布成功。失败、取消、进程中断及数据库发布回滚不发布半成品；旧有效副本一直保留到新副本成功发布。

源绑定检查包含 revision、作品 mediaEpoch、路径、size、mtime/ctime、device/inode。正常 NAS 同路径同大小覆盖、替换或删除由轻量 stat 识别，播放前不读取几 GB 文件做完整哈希。它不是对能伪造全部文件证据的外部修改的密码学保证。

发现不匹配时按当前 generation 条件删除记录。删除、换代与 `Image` 级联删除由数据库触发器登记旧文件 GC；旧副本宽限 1 小时，失败尝试的意图宽限 24 小时，随后由既有派生 GC 再检查引用并回收。手动清理立即停用副本，物理文件延后删除，不触碰原片。

## 读取与权限

管理 tRPC 使用 `adminProcedure`，操作者取自会话，目标必须是当前可管理视频。Web 源解析和字节流路由独立核验会话：`/api/v1/media/<id>/playback/source` 返回受控同源 URL，`/api/v1/media/<id>/playback?generation=<uuid>` 固定对应一个副本；旧 generation 被拒绝，不重定向或在后续 Range 中换文件。原片 URL 使用源版本标识。

字节流支持单 Range、206 和 416；解析真实根内路径，拒绝隐藏路径和非普通文件，响应 `private, no-store`、`Vary: Cookie`、`no-referrer`。视频副本不经过 ImgProxy。公共权限规则见[安全边界](../security/access-control.md)。

## 发布与回退

正式增量迁移为 `20261031003000_video_playback`，无历史回填、不改原片。按[备份与恢复](../operations/backup-and-recovery.md)取得成组恢复点，再运行现有 generate/deploy 流程；就绪门禁要求新增迁移已完成；App 与 Worker 配套升级，核对新能力和派生根共享访问。禁止用 `db:push` 替代 migration。

回退前先停止新增生成请求，让运行任务取消／完成并停止 Worker，再核对 `VIDEO_PLAYBACK_GENERATION` 未终结任务和 `VIDEO_PLAYBACK` GC 意图。旧 Worker 不理解这些类型，不能直接接管；须由新版本处理或在明确恢复方案下保留隔离，不能删除意图后遗留无主文件。新增表和触发器保留时，旧版本删除 Image 仍可能产生新 GC 意图，因此旧版 GC 必须停用，直至恢复支持版本。需要撤销迁移时恢复匹配的数据库及媒体快照，不直接删表模拟回退。

## 验证

编码、发布、取消、源变更和回收用 PostgreSQL／临时文件 fixture；播放源与 Range 有服务／路由测试，两套播放器验证切换与原有手势、暂停、阅读行为。实际命令、样本和未验证边界单独登记于[验证记录](../records/features/video-playback-2026-10-31.md)。
