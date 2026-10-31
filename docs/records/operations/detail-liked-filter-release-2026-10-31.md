---
status: historical
scope: v0.55.10 作品详情喜欢筛选与视频评分层叠修复的 patch 发布交接
last-verified: 2026-10-31
sources:
  - packages/pixishelf/app/artworks/[id]/_components/artwork-media-section.tsx
  - packages/pixishelf/hooks/use-media-mark.ts
  - packages/pixishelf/services/media-mark-service.ts
  - packages/pixishelf/components/players/video-player.tsx
  - .github/workflows/build-and-deploy.yml
---

# v0.55.10 作品详情发布交接

用户授权提交本次修改、打 patch tag 并推送。远程核对后 main 与本地基线 `d473ab3c` 一致，最新正式标签为 `v0.55.9`，本次准备 `v0.55.10` 附注标签并与 main 原子推送，不移动旧标签或强推。版本沿用 tag 注入 `APP_VERSION`，不修改包版本或锁文件；远程推送结果以 Git 返回为准，本记录不宣称 CI、镜像或生产部署成功。

## 本次行为

详情右上角菜单新增“只看喜欢的图片”，使用当前账户的完整单图喜欢集合，保留原顺序与序号；与只看未读互斥切换，取消后恢复全部。完整列表、堆叠及详情预览沿用筛选结果；取消喜欢保存成功后刷新。补齐加载、失败重试、空态和账户隔离，读取不会受首屏分页或 200 项批量标记上限截断。

内联视频在自身层叠上下文内显示控件，避免覆盖页面悬浮操作和作品评分面板；网页全屏仍可覆盖视口。当前规则见[单图标记](../../features/media-marks.md)、[视频显示](../../features/video-display.md)与[权限边界](../../security/access-control.md)。

## 本地验证与限制

- macOS、Node.js 20.19.4、pnpm、Chrome。8 个相关测试文件共 78 项通过；最后调整喜欢 hook 的测试后，7 项 hook 测试复跑通过。覆盖完整喜欢 ID、逻辑媒体身份、账户切换与迟到响应、取消喜欢后刷新、筛选切换及空态、阅读续接和视频播放。
- 主应用 `pnpm lint`、`pnpm typecheck`、提升权限 `pnpm build` 通过。`pnpm docs:check`、使用已安装 Chrome 的 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、路径大小写与 `git diff --check` 通过；默认图示检查因未安装 Playwright Chromium 改用 Chrome。
- 提升权限 `pnpm test` 首次 480 文件通过、3 文件失败、50 文件跳过；3560 tests 通过、6 失败、361 跳过。361 项依赖未配置的隔离数据库。管理页选择上限超时单独复跑所在文件 47 项全通过；未改动的 `artwork-dedup-display.test.ts` 仍有 5 项断言失败，`video-keyframe-service.test.ts` 仍因 `node:fs/promises` mock 缺少 default 导出无法加载。本次未修复这些既有失败，不能登记为全量通过。
- 使用合成视频、真实 VideoPlayer／ArtworkRatingPanel 及构建 CSS，在 Chrome 1200×794 和 390×844 验证评分面板位于视频之上、键盘选档和窄屏无横向溢出；网页全屏进入和退出正常。临时页面与服务已关闭。该样本不连接业务数据库；本地应用未登录，未完成登录后的整页浏览器验收，也未验证真机或原生容器全屏。

## 发布与恢复边界

没有 Schema、数据库迁移、媒体文件或 Worker 任务契约变更，没有操作 NAS、业务数据库或原媒体。tag 推送将触发现有 CI 与双镜像发布工作流，产物及发布状态须另行核验。实际升级按[部署基线](../../operations/deployment.md)执行；保留升级前的配套 App／Worker 镜像与[一致性恢复依据](../../operations/backup-and-recovery.md)，本次不执行生产升级或恢复。
