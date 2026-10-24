---
status: historical
scope: 视频缩放的本地组件、浏览器及构建验证
last-verified: 2026-10-24
---

# 视频画面缩放验证

日期：2026-10-24。适用版本：基于 `15928225` 的本次工作区改动，未核验生产发布。当前规则见[视频画面显示](../../features/video-display.md)。

## 环境与样本

macOS、Node.js 20、pnpm；使用仓库已有 React、ArtPlayer 5.4.0 与 Playwright 1.56.1，通过本机 Chrome 运行隔离测试页。测试页直接打包实际 `VideoPlayer`、`SingleImage`、`ViewerVideoControls` 和应用样式，使用合成视频与两个模拟章节，不连接业务数据库。

样本为 1920×1080 横屏画布内嵌 720×1080 测试图，左右各 600 像素黑边，时长 5 秒。未复制、修改或上传用户原视频。

## 结果与证据

- 组件回归覆盖默认完整、逐档放大与恢复、播放位置／声音／实例保持、清屏后仍可缩放、切换横向媒体及活动作品恢复完整、详情换源恢复完整、网页全屏移出包装容器后仍可操作。
- 全屏兼容单测覆盖标准与 WebKit 容器 API、仅视频全屏环境的网页回退、请求拒绝、退出，以及卸载后不复活播放器。
- Chrome 视口 320×844、390×844、1280×800：实际视频的显示倍率为 2.5，容器全屏可以继续缩放并退出；沉浸控件无页面横向溢出。手机宽度下允许详情控制项换行，避免挤出缩放和全屏按钮。
- 触屏模拟 390×844、844×390，显式禁用标准与 WebKit 容器全屏能力：进入网页全屏、连续触摸缩放、退出并保留倍率均通过；按钮边界在视口内。
- Impeccable 静态检测只报告原有章节展开的 `transition: height`，该规则非本次新增。

自动回归入口：[详情播放器](../../../packages/pixishelf/components/players/__tests__/video-player.component.test.tsx)、[沉浸缩放归属](../../../packages/pixishelf/app/viewer/_components/__tests__/image-slide-video-zoom.test.tsx)、[沉浸视频](../../../packages/pixishelf/app/viewer/_components/__tests__/image-slide-video.test.tsx)、[控制栏](../../../packages/pixishelf/app/viewer/_components/__tests__/viewer-video-controls.test.tsx)、[全屏兼容](../../../packages/pixishelf/lib/__tests__/video-fullscreen.test.ts)。

完整检查结果：

| 检查                                                   | 结果                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| 主应用 `pnpm lint`                                     | 0 warning、0 error                                                          |
| 主应用 `pnpm typecheck`                                | 通过                                                                        |
| 主应用 `pnpm test`                                     | 提升权限重跑后 432 文件通过、32 文件跳过；3129 项通过、227 项按现有配置跳过 |
| 主应用 `pnpm build`                                    | 提升权限运行，生产构建通过                                                  |
| `pnpm docs:check`                                      | 182 份 Markdown 本地链接、锚点、路径与围栏通过                              |
| `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` | 28 图源、23 内嵌 Mermaid 块通过                                             |
| 应用路径大小写、`git diff --check`                     | 无大写路径、无空白错误                                                      |

首轮全量测试在沙箱内因本机 socket/tsx IPC 限制失败 5 项，另有并行构建期间的后台页面用例超时 1 项；构建结束后提升权限重新执行完整套件全部通过。首次 typecheck 与 build 同时运行时，Next.js 重建 `.next/types` 导致文件缺失；构建完成后单独重跑通过。图示检查最初缺少指定版本的 Playwright Chromium，改用本机已有 Chrome 后通过。未修改测试超时、跳过规则或无关实现。

## 限制

浏览器验证为隔离组件页，不等同于登录后的完整站点或真实 iPhone／Android 设备验收。系统视频全屏不能保留网页缩放控件，因此使用网页全屏回退；浏览器自身保留的地址栏无法由该回退隐藏。未做自动黑边识别、转码或原文件处理。
