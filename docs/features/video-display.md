---
status: current
scope: 沉浸浏览与作品详情的视频画面缩放和全屏兼容
last-verified: 2026-10-24
sources:
  - packages/pixishelf/components/players/video-zoom-button.tsx
  - packages/pixishelf/components/players/video-player.tsx
  - packages/pixishelf/app/viewer/_components/image-slide.tsx
  - packages/pixishelf/lib/video-fullscreen.ts
---

# 视频画面显示

沉浸浏览与作品详情播放器在控制栏提供「画面缩放」，默认「完整」，按完整 → 1.5× → 2× → 2.5× → 3× → 完整循环切换。放大以画面中心为基准，超出播放区域的边缘会被裁切；可用于放大自带黑边的视频，但不会自动识别黑边或随片段改变倍率。

缩放仅改变浏览器显示，不修改原视频、尺寸元数据、派生文件或数据库。切换不重建播放器，不改变播放位置、播放／暂停、声音或播放速率。按钮支持触屏、鼠标和键盘，保留至少 44px 点击区域；操作不触发媒体切换或画面手势。沉浸浏览隐藏信息后仍保留缩放按钮，面板锁定期间禁用。

缩放只属于当前视频的本次展示，不跨媒体或作品沿用，不写浏览器偏好。切换媒体或离开活动作品恢复完整画面；同一视频隐藏信息、进入／退出全屏或重试保留倍率。

详情页「全屏播放」优先对整个播放器请求浏览器全屏，包含画面、缩放与播放控件。仅支持系统视频全屏的浏览器，以及拒绝容器全屏的环境，改用网页全屏以保留这些功能；网页全屏可能仍显示浏览器地址栏。不会主动调用视频专用的系统全屏接口。网页全屏继续沿用返回键退出及卸载清理逻辑，缩放不单独写入历史。沉浸浏览沿用现有满视口布局。

## 验收

- 详情内联播放器的内部控制条、字幕与章节图层限制在播放器自身的层叠上下文，不能遮挡页面悬浮操作组或作品评分面板；浏览器容器全屏及网页全屏仍覆盖播放视口。
- 默认完整；逐档放大并循环恢复完整，控件大小不随视频变化。
- 横竖屏、窄屏、浏览器容器全屏及网页全屏中能操作缩放；内容裁切不遮挡控制栏。
- 暂停、播放、隐藏信息、切换媒体、重试和退出全屏时符合上述状态规则。
- 容器全屏不可用或请求失败时保留网页控件；请求期间卸载不能复活播放器。

组件测试见 [详情播放器测试](../../packages/pixishelf/components/players/__tests__/video-player.component.test.tsx)、[沉浸视频测试](../../packages/pixishelf/app/viewer/_components/__tests__/image-slide-video.test.tsx)、[控制栏测试](../../packages/pixishelf/app/viewer/_components/__tests__/viewer-video-controls.test.tsx)及[全屏兼容测试](../../packages/pixishelf/lib/__tests__/video-fullscreen.test.ts)。浏览器与真机验证边界见[验证记录](../records/features/video-display-2026-10-24.md)。
