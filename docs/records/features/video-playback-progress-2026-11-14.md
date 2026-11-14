---
status: historical
scope: 播放副本速度、编码 ETA、阶段耗时的本地验证
last-verified: 2026-11-14
sources:
  - packages/pixishelf-job-executors/src/video-playback/__tests__/media-process.test.ts
  - packages/pixishelf-job-executors/src/video-playback/__tests__/publication.postgres.test.ts
  - packages/pixishelf/app/admin/_components/__tests__/video-playback-progress.test.tsx
---

# 播放副本进度指标验证

本轮基于 `27f71817` 的工作区实现；未构建或部署生产镜像，未修改生产资源限制。当前行为维护于[播放副本](../../features/video-playback.md#生成进度与耗时)。

## 环境与验证

本地 macOS、PostgreSQL 15 临时容器、合成视频和临时文件目录。测试库 `playback_progress` 使用独立本机端口并应用完整现有 migration；没有新 migration、生产数据或私人媒体输入。

- 播放副本聚焦回归 26 项通过，含真实 FFmpeg、独立解码／滤镜／编码线程限制、完整分块进度解析、ETA、阶段边界、取消、原片保持和发布回滚。
- 前端任务控制台及媒体入口聚焦回归通过；最终指标组件与状态服务的 26 项通过，覆盖等待首次采样、过期采样、暂停／取消／失败、完成后的发布耗时、旧任务空指标及服务返回。契约的 2 项检查覆盖详情／SSE 一致性和非法／敏感字段拒绝。
- 主应用 lint、生产 build 通过；初次增量 typecheck 在既有认证模块报 TS2321，未修改认证代码，未改动 HEAD 的独立副本及本次工作区 `tsc --noEmit --incremental false` 均通过。
- 主应用全量测试当次 3,838 项通过、404 项按环境条件跳过，1 项日期解析在 America/Los_Angeles 时区失败。未改动 HEAD 上复现同一失败，`TZ=UTC` 聚焦重跑该文件的 18 项全部通过；未更改日期逻辑或放宽断言。
- Worker 依赖链 typecheck 与 build 通过；build 保留既有去重模块的 CJS／`import.meta` 警告。
- Chrome 组件夹具使用实际组件与构建 CSS，检查 1000px、390px 和 390px 深色模式：无水平溢出，阶段网格在宽屏为三列、窄屏为两列。使用合成状态，不能视为已登录后台端到端或真实生产 SSE 验收。

全量 Worker 回归的首次尝试中，归档恢复有一项 5 秒超时；随后 Docker 磁盘不足导致临时 PostgreSQL 写 WAL 失败并停止，扫描和后续 Worker 数据库用例受到影响。仅移除本轮临时容器及其专属卷后，以 tmpfs 重建同名测试库，重新应用迁移，串行复核受影响用例；未清理其他容器、镜像或业务数据，未修改测试超时和断言。

重跑归档、扫描和播放副本的 5 个文件，112 项全部通过；Worker 自身 132 项通过、1 项按环境条件跳过。其余依赖链首次运行已通过的用例未重复运行，不宣称首次全量零失败。验证结束后删除本轮临时数据库容器及其专属存储。

本地日志位于执行机器 `/tmp/pixishelf-playback-*.log`，包括 `focused`、`app-test`、`app-build`、`app-clean-typecheck`、`worker-test`、`db-retry`、`worker-final-test`；视觉夹具为 `/tmp/pixishelf-playback-{desktop,mobile,mobile-dark}.png`。它们是临时验证证据，不是长期附件或生产备份。

## 发布限制

旧任务无法回填未采集的速度和阶段时间。先升级能识别新进度契约的 App，再启用新 Worker；不更改现有 CPU、内存、线程或编码档位。生产持续负载、真实网络断线恢复和 NAS 转码表现未在本轮重跑。
