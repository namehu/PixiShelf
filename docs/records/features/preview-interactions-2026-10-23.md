---
status: historical
scope: 详情首次定位、预览媒体标记布局和沉浸视频倍速的本地验证
last-verified: 2026-10-23
sources:
  - packages/pixishelf/app/artworks/[id]/_components/artwork-summary-context.tsx
  - packages/pixishelf/app/artworks/[id]/_components/adaptive-media-preview.tsx
  - packages/pixishelf/app/artworks/preview/page.tsx
  - packages/pixishelf/app/viewer/_components/viewer-video-controls.tsx
---

# 预览交互修复验证

适用版本为 2026-10-23 本地工作区未提交改动，不代表生产发布。

- 首次异步媒体索引加载不再触发首图锚点恢复；已有索引更新、显式媒体目标、续读及预览返回仍保留定位。
- 适配及原图预览的书签、喜欢移到右下角，避开窄屏播放栏、视频控制栏及错误提示。按压与选中动效遵循减少动态效果设置。
- 沉浸视频倍速按 1、1.25、1.5、2、3 循环，移除旧菜单及其专属交互锁。

## 本地检查

- 相关详情、标记及 viewer 聚焦回归通过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。
- `pnpm test` 首轮存在沙箱管道权限错误及并发超时；构建结束后提升权限，以 `pnpm test:unit --maxWorkers=2` 重跑：423 个文件通过，31 个文件跳过；3030 项通过，225 项跳过。未放宽断言或超时阈值。
- 首轮并行类型检查遇到构建生成文件变化，构建完成后独立重跑通过。
- `pnpm docs:check` 通过。默认 Playwright Chromium 缺失，使用已安装 Chrome 执行 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过。
- 路径大小写扫描与 `git diff --check` 通过。

## 浏览器范围与限制

使用已登录的本地开发实例，进入 URL 带 `entry=direct`。以既有「续读测试 03」样本确认标题与作者区停留顶部，390×844 及 1280×800 视口确认适配预览标记和播放栏不重叠；书签、喜欢切换成功并恢复测试前状态。以既有视频实测五档倍速循环并返回 1 倍，全程不弹菜单。

浏览器视口模拟不等于手机真机验证。跳过的数据库等环境相关套件未因此获得覆盖；未部署或验证生产实例。
