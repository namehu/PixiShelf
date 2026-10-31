---
status: historical
scope: 视频播放副本的独立代码审查、修复和真实 Chrome 复核
last-verified: 2026-10-31
sources:
  - packages/pixishelf/components/players/video-player.tsx
  - packages/pixishelf/hooks/use-video-playback-source.ts
  - packages/pixishelf/app/viewer/_components/image-slide.tsx
  - packages/pixishelf/services/video-playback-service.ts
---

# 视频播放副本审查与浏览器复核（2026-10-31）

适用版本为基于 `9e2764fa` 的本次未提交工作区。承接[初次实施验证](./video-playback-2026-10-31.md)，不表示已部署生产。按用户要求，由 GPT-6.1 Sol（xhigh）独立审查，主智能体修复，再由 GPT-6.1 Terra（high）操作真实 Chrome 验证。

## 环境与恢复依据

使用独立 PostgreSQL 16 容器、回环端口 56440、专用 `playback_review_test`，从空库完整 `migrate deploy`；Next.js 生产构建运行在 5468，配套 Worker 健康端口 5469。媒体全部为 `/tmp/pixishelf-playback-review` 内合成的 12 秒 1440p/60fps 视频，浏览器使用隔离 profile 和合成会话。没有操作用户已有服务、生产库、真实收藏或环境文件；恢复单位为可丢弃的专用容器与合成目录。

## 发现与修复

| 来源              | 问题与影响                                                                       | 修复及证据                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sol，P2           | 详情页错误后“重新加载”在重新解析源时清空恢复快照，从零开始并丢失播放意图         | 快照随逻辑媒体身份重置，解析结果绑定 retryKey；播放／暂停两种回归先失败后通过，Chrome 恢复到约 4.21 秒并继续播放 |
| Sol，P2           | 沉浸页 MISSING、WRITING、HTTP 失败只显示提示，未通知自动浏览暂停                 | 转发现有媒体错误通知；三类回归先失败后通过，Chrome 显示暂停和跳过入口                                            |
| Terra，真实浏览器 | 副本在首帧前失败，回退原片却停在 0 秒                                            | 在 play 事件记录播放意图；修复前原片 readyState=4、paused=true，修复后原片实际推进并循环                         |
| Terra，真实浏览器 | 副本失败留下 play() 拒绝状态，随后开始自动浏览仍立即暂停                         | 副本媒体错误交由源回退处理，不提前上报终止播放；组件回归先失败后通过                                             |
| 生产构建服务日志  | 切源取消请求时 Node 20 Readable.toWeb 向已关闭控制器写入，产生 uncaughtException | 改为按 64 KB 拉取；完成、错误、响应取消和 HTTP abort 均显式关闭句柄；覆盖连续取消与请求中止                      |

## 真实浏览器结果

使用系统 Chrome headless、独立会话和 `entry=direct`。业务操作通过真实 App/Worker；失败注入使用浏览器 route 或临时移走合成原片，不代表真实 NAS 故障。

| 场景                             | 结果                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 默认副本与固定 URL               | 默认使用 generation URL；旧 generation 返回 409                                                                          |
| 详情与沉浸切源                   | 播放／暂停均保留位置、音量和 UI 选择的 1.5 倍速；不会因暂停切源自行播放                                                  |
| 详情错误重试                     | 约第 4 秒出错后重新加载，恢复至约 4.21 秒并继续播放                                                                      |
| 首帧前副本失败                   | generation 请求 500 后回退原片并推进；开始自动浏览后时间 8.73→11.73 秒，没有残留暂停提示                                 |
| 解析 HTTP 失败／MISSING／WRITING | 均显示对应错误、暂停自动浏览；点击跳过后切到第二视频并实际推进约 2 秒                                                    |
| 单个／多选提交                   | 管理页单条真实转码完成；旧 UNKNOWN 分类的 second.mp4 无需回填即可生成约 6 MB 副本；多选两条分别入队                      |
| 取消和清理                       | 取消重新生成后保留已有副本；单独清理停用副本，原片保留                                                                   |
| 失败与重试                       | 暂移 second.mp4 使任务失败，恢复后点击“重试副本”，真实 Worker 重新编码并完成                                             |
| 请求退出与句柄                   | 切源、seek、关闭页面后，App 的 lsof 未残留合成媒体句柄；最终日志无 Controller already closed、DEP0137 或 GC 关闭句柄警告 |

验证过程中错误地并行操作共用 fixture 曾导致第二视频缺失，并触发接口限流；这些播放观察作废，原片恢复、限流恢复后严格串行复测。服务旧流转接实现曾产生异常；最终结论仅引用修复后生产构建及其日志。

## 静态与自动检查

- 主应用 lint 为 0 warnings / 0 errors，typecheck 和提升权限生产 build 通过。
- 最终独立执行 `pnpm run test --maxWorkers=4`：490 文件、3,652 项通过；53 文件中的 372 项按环境约定跳过，不计为已验证。此前并行负载下的 maintenance-card-live-events 失败在此轮全量通过。
- 两套播放器、共享 Hook、自动浏览聚焦组 4 文件 73 项通过。副本服务与 HTTP 路由 2 文件 23 项通过，覆盖真实文件读取、Range、取消、请求预先中止及读取中止；每个服务用例核对已打开文件的 `fd === -1`。
- Worker 依赖链 typecheck/build 通过。后续修复只涉及 Web 播放器和 HTTP 读取；本轮未重复执行初次记录中的全部 PostgreSQL/Worker 测试。
- 文档检查通过（372 Markdown）；图示检查通过（34 图源、23 内嵌 Mermaid）；主应用路径大小写和 `git diff --check` 通过。
- 某次全量运行与浏览器、转码争用资源时，既有 maintenance-card-live-events 两项等待 UI 失败；该文件独立复测 5 项通过。未删除断言或修改该功能代码。

隔离开发诊断为 Next 临时添加的 tsconfig include 已移除；专用 App、Worker、开发实例、容器、合成视频和会话文件均已清理，保留日志、脚本与截图。没有停止已有开发实例或删除它的锁文件。

## 验证边界

本记录仅登记本轮隔离验证。编码档位、迁移升级、发布围栏、GC 和 NAS 一致性的初次测试证据仍见[初次实施验证](./video-playback-2026-10-31.md)，不能用本轮浏览器操作代替生产 NAS、真实几 GB 收藏、生产代理、备份恢复与成组升级验收。浏览器没有等待 GC 宽限期后的物理回收。

本地生产构建的沉浸页偶发 React 水合错误 #418；无搜索条件时也出现，页面仍可播放。独立开发构建连续三次没有复现，根因尚未定位，不能认定为既有问题，也不能宣称浏览器完全无错误。该告警保留为未关闭项，证据为 `playback-review-terra-hydration-final.json` 和 `playback-review-terra-dev.json`。

原始脚本、JSON、截图与运行日志位于本机会话的 `/tmp/playback-review-*`，其中 Terra 浏览器证据使用 `playback-review-terra-*` 前缀；临时路径不是长期证据库，本文不记录 Cookie 或账户凭据。
