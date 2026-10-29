---
status: historical
scope: 沉浸爱心分档视觉、详情全屏预览精简控制与 WebP 文件大小显示
last-verified: 2026-10-29
sources:
  - packages/pixishelf/app/viewer/_components/like-button/inex.tsx
  - packages/pixishelf/components/media-preview/controlled-auto-browse-controls.tsx
  - packages/pixishelf/app/artworks/[id]/_components/adaptive-media-preview.tsx
---

# 2026-10-29 预览控件验证

适用版本为本次本地工作区，尚未提交或部署。改动是客户端视觉与手势交互，不改评分档位、单图标记 API、播放器完成条件或数据库结构。当前规则见[作品评分](../../features/artwork-rating.md)、[自动浏览](../../features/artwork-auto-browse.md)与[单图标记](../../features/media-marks.md)。

## 验证环境与内容

macOS、Vitest/jsdom、Next.js，以及浏览器内绑定实际组件的合成数据预览。正常应用停在登录页面，因此没有读取账户或收藏，没有将独立组件预览记作登录后端到端验收。

- 三档爱心分别使用单心、双心、星芒心与红色层级；等级文字仅保留于辅助名称和提示，不在按钮旁堆叠。短按、长按及保存期间的心形节点保持原有行为。
- 预览默认仅显示播放图标与页数，悬浮 999ms 不展开、满 1000ms 打开设置并暂停；离开／卸载取消计时。向上滑动打开设置并消费松手点击；点击页数与向上键也可进入。设置关闭不会恢复自动播放，错误时重试／跳过仍可访问。详情列表原有四秒收起规则不变。
- 浏览器检查 1280px 桌面与 320px 窄屏，确认三档爱心、红色单图喜欢、WebP 播放图标与文件大小可见；窄屏设置弹层距屏幕两侧至少 16px，使用深色样式。检查点击页数打开、Escape 关闭；悬浮与触摸手势由组件测试验证，未执行手机真机手势验收。
- Impeccable 机械检查对本次 UI 文件返回空问题集。

## 自动检查结果

- `pnpm lint` 零错误、零警告；`pnpm typecheck`、提升权限的 `pnpm build` 通过。
- 提升权限运行 `pnpm run test --maxWorkers=2`：466 个套件、3441 项测试通过，48 个套件中的 337 项依赖隔离数据库等环境条件而跳过，无失败。限制并发避免检查争用导致交互用例超时；未放宽超时或断言。
- `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、主应用路径大小写检查及 `git diff --check` 通过。图源未变动。

独立预览使用合成媒体大小、页数和标记状态，不能替代真实媒体网络加载、触摸设备与完整账户流程验收。
