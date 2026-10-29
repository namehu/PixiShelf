---
status: historical
scope: 作品详情短视频完成事件、适配预览输入与底部布局的本地验证
last-verified: 2026-10-29
---

# 作品详情阅读交互修复验证

适用版本：从 `main` 的 `7c45f3c8` 创建的 `codex/artwork-reader-interactions` 分支工作区。环境为本机 macOS、Node.js 20、Vitest/jsdom 和 Chrome；未部署生产，也未访问生产媒体或修改业务数据。

## 修复与回归范围

- [播放器组件测试](../../../packages/pixishelf/components/players/__tests__/video-player.component.test.tsx)覆盖 0.3、4.8、5、5.2 秒视频，模拟末次进度仅到 80%、Artplayer 循环先归零再触发 `video:ended`，确认补交总时长完成证据，销毁后迟到事件无效。seek/durationchange 事件对象不能误当完成标记。
- [适配预览测试](../../../packages/pixishelf/app/artworks/[id]/_components/__tests__/adaptive-media-preview.test.tsx)覆盖空格切换喜欢、双击添加喜欢、关闭双击缩放、禁用／重复／修饰键保护，以及单图底部计数。自动浏览回归确认预览空格不会同时触发暂停／继续。
- 保持 90% 视频完成规则、现有账户媒体标记状态管理及 API；不涉及数据库迁移。

## 执行结果

| 检查 | 结果 |
| --- | --- |
| 首轮播放器、阅读 hook、预览核心、适配预览、邻图阅读与自动浏览组件测试 | 6 文件、60 项通过 |
| 主应用 `pnpm lint`、`pnpm typecheck`、提升权限 `pnpm build` | 通过 |
| 主应用 `pnpm test` | 3398 项通过、7 项失败、336 项按既有环境门禁跳过；失败复查如下 |
| 仅复查四个失败文件，提升权限并使用 `--maxWorkers=2` | 45 项全部通过；safe-http 的 3 项与 cutover CLI 的 2 项原为端口／IPC EPERM，discovery 的 2 项原为 5 秒超时；未放宽测试断言或超时阈值 |
| `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` | 通过；默认 Playwright Chromium 未安装，改用本机 Chrome |
| 路径大写检查、`git diff --check`、变更 UI 的 impeccable detector | 通过 |

## 浏览器范围与限制

合成页面使用实际 `VerticalMediaPreviewCore`、Swiper、Dialog、`MediaMarkActions`、自动浏览控件及应用构建 CSS，媒体为合成 SVG，标记读写使用内存替身。Chrome 在 1280×800 和 375×812 视口验证空格双向切换、滚轮前后切图、双击喜欢且不缩放、已喜欢时再次双击保持状态、切图后的独立标记、初始键盘焦点以及底部布局。组间距分别为 24px／12px，手机按钮组位于 x=80.5–294.5，未溢出；检查了桌面和手机截图，无浏览器运行错误。

本机临时证据位于 `/tmp/pixishelf-reader-browser/` 及 `/tmp/pixishelf-reader-*.log`，不作为持久发布证据。此次浏览器验证未覆盖实际账户 API、实体触屏双指缩放或生产短视频文件；短视频结束／循环由组件事件回归验证。PostgreSQL 集成用例因未提供隔离数据库而跳过，主应用 `test` 本身不包含独立 integration 套件。生产需刷新客户端后复核实际短视频读完提示。
