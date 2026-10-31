---
status: historical
scope: 视频播放副本的隔离迁移、FFmpeg、PostgreSQL、Web 播放器和限速验证
last-verified: 2026-10-31
sources:
  - packages/pixishelf-job-executors/src/video-playback/__tests__/
  - packages/pixishelf/services/__tests__/video-playback-service.test.ts
  - packages/pixishelf/services/background-task/__tests__/video-playback-commands.postgres.test.ts
  - packages/pixishelf/hooks/__tests__/use-video-playback-source.test.tsx
---

# 视频播放副本验证（2026-10-31）

适用版本为基于 `9e2764fa` 的本次未提交工作区，不代表该提交或生产实例已经包含功能。当前规则见[功能规格](../../features/video-playback.md)。

## 环境与恢复依据

macOS arm64、Node 20.19.4、pnpm、CPU FFmpeg/libx264、系统 Chrome headless；Next.js 16.1.1 生产构建。使用独立 `postgres:16-alpine` 容器、回环端口 56439、专用 `playback_feature_test` 与 `playback_upgrade_test` 数据库，媒体全部为 `/tmp` 合成 fixture，浏览器使用合成账户及隔离 profile。没有修改真实收藏、生产数据库、部署配置或环境文件。

空库完整 `prisma migrate deploy` 成功。非空升级先复制迁移目录并排除新增迁移，部署旧 schema，插入一个 Artwork/Image sentinel，再添加 `20261031003000_video_playback` 并 deploy：原 Image ID、路径、VIDEO 分类保持，新增发布表为 0 行，无历史回填。没有使用 `db:push`。本次恢复单位是可丢弃的测试容器与临时媒体，不构成生产备份演练。

## 自动验证

| 范围                                  | 实际结果                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma validate/generate              | 通过，增量迁移在空库及非空旧库 deploy 成功                                                                                                                                         |
| 主应用 lint、typecheck                | 通过；lint 0 warnings / 0 errors                                                                                                                                                   |
| 主应用 `pnpm run test --maxWorkers=4` | 489 文件通过；3,638 测试通过，372 跳过；后续新增管理控件与最终共享 Hook/自动浏览聚焦组 34 项通过                                                                                   |
| 主应用提升权限 `pnpm build`           | 编译、TypeScript、页面生成通过；生产构建在隔离设置下启动并用于浏览器验证                                                                                                           |
| Worker 链 typecheck/build             | DB、contracts、runtime、executors、Worker 全部通过；Worker CJS 打包保留已有 3 条 import.meta 警告                                                                                  |
| Worker 链串行测试                     | contracts 183、DB 193、runtime 35、executors 1,002、Worker 116 项通过；未配置相应服务的 PostgreSQL 项单独跳过，不计作通过                                                          |
| 真实 PostgreSQL 队列                  | queue-repository 86、media-content-control 11 项通过，覆盖领取竞争、发布围栏、取消与写入门禁                                                                                       |
| 副本发布 PostgreSQL                   | 9 项通过：旧 UNKNOWN 视频免回填兼容、真实 FFmpeg 完整发布／取消、同大小覆盖、生成中删除／受控写入、较大输出跳过、换代及级联 GC、事务回滚、发布失败文件的意图保留、实际 GC 引用检查 |
| Schema 就绪门禁                       | 43 项通过（含真实 PostgreSQL）；要求新迁移已完成和副本表存在                                                                                                                       |
| 文档与路径                            | docs:check、Chrome 下 docs:diagrams:check、主应用路径大小写及 git diff --check 通过                                                                                                |
| 副本命令 PostgreSQL                   | 并发普通提交与并发 retry 复用活动任务，取消后重试，路径变化拒绝；1 项通过                                                                                                          |
| 编码规则                              | 单元 9 项，真实 FFmpeg 4 项通过，包含横竖屏、小尺寸、有／无音轨、60fps、真实 PQ 标记拒绝、faststart 与源 SHA-256 不变                                                              |
| API/播放器                            | 认证零 I/O、单 Range/206/416、固定 generation、原片版本、错误暂停不记为用户暂停、隐藏路径/越界链接、缺失回退；两套播放器切源状态、原有手势、自动浏览、阅读上报回归通过             |

首次全量 App 在受限沙箱和并行重负载下遇到 IPC/监听 EPERM、超时及新增异步源解析尚未适配的组件测试；补齐异步接口 fixture 后，提升权限并限制 4 workers 全量通过。首次把所有 PostgreSQL 套件并行跑到一个库，出现既有全局锁竞争、测试残留根绑定，以及旧专项测试强制固定库名/端口的拒绝；没有放宽安全限制，改为 Worker 单元链串行及独立库中的相关 PostgreSQL 套件。未声称所有历史专项数据库套件均已验证。

## 合成样本与画质指标

样本用 FFmpeg `testsrc2` 生成：2560×1440、60fps、12 秒，正弦音轨，原片为 `libx264 -crf 0 -preset ultrafast`。副本使用实际固定编码档位、2 个编码线程。

| 指标       | 结果                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 原片字节数 | 166,882,180（约 166.88 MB）                                                    |
| 副本字节数 | 6,330,039（约 6.33 MB，原片的 3.79%）                                          |
| 编码耗时   | 4.584 秒；本地 CPU 合成样本，不是 NAS 性能承诺                                 |
| SSIM       | All 0.990894；参考先缩到 1920×1080，再与副本比较，不衡量降分辨率丢失的原始细节 |

目视检查真实详情页画面及控制栏；测试图形的画质指标不能代替人物、纹理、暗部、快速运动等真实收藏的人工评估。没有取用用户真实媒体，也没有声称该压缩率普遍成立。

## 真实 Chrome 播放

以 `entry=direct` 进入隔离 App。详情页默认加载带 generation 的副本；暂停于 4 秒、音量 0.25、静音、1.5 倍速后切原片，所有状态保留。播放中切回副本仍继续播放且保留音量、静音与倍速。沉浸页暂停于 3 秒、音量 0.35 切原片，也保留位置与暂停状态。无浏览器 pageerror。

CDP 设置稳定下载 750,000 bytes/s（6 Mbps）、80 ms latency、禁用网络缓存。以下为一次合成样本观察，不是统计性能基准：

- 副本 loadstart 到首次 playing：349.8 ms；约 4 秒连续观察推进至 4.312 秒，期间重新缓冲 0 次。
- 拖动到第 8 秒：约 1,516 ms 后恢复推进；随后达到 9.607 秒并持续播放。
- 原片获得元数据约 790 ms；实际发起播放到首次 playing 约 3,404 ms，15 秒观察窗仅推进 0.573 秒，发生 3 次 waiting。首次测量因切源恢复暂停状态，未实际播放，已作废；这里登记重新发起播放后的数据。
- 模拟源解析完成后副本文件消失，播放器自动重新解析并加载原片；旧 generation 请求返回 409，无同 URL 换文件。
- 临时移走原片后重新加载，页面显示「原视频不存在或不可读取」。

## 证据与未验证范围

本次会话原始日志和合成脚本位于 `/tmp/playback-*`，包括 `playback-next-build-final.log`、`playback-app-final-tests.log`、`playback-worker-tests-final.log`、`playback-runtime-pg.log`、`playback-upgrade-evidence.log`、`playback-browser-evidence.json`、`playback-browser-final-evidence.json` 与 `playback-benchmark.json`；临时路径不作为长期外部证据库。本文保存可复核的样本、结果和边界，不保存会话 Cookie 或账户凭据。

生产 NAS 同路径替换行为、真实几 GB 收藏的画质、生产代理/外网吞吐、生产 App/Worker 成组升级、备份恢复与回退演练尚未验证。Android、实时转码、硬件编码和 HDR 色调映射不在本版范围内。发布仍需按[备份与恢复](../../operations/backup-and-recovery.md)及[功能回退说明](../../features/video-playback.md#发布与回退)执行。
