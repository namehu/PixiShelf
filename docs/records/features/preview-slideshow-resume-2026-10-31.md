---
status: historical
scope: 静态图片全屏轮播首次启动与普通详情续读入口的隔离排查
last-verified: 2026-10-31
sources:
  - packages/pixishelf/app/artworks/[id]/_components/adaptive-media-preview.tsx
  - packages/pixishelf/app/artworks/[id]/_components/artwork-summary-context.tsx
  - packages/pixishelf/app/artworks/[id]/_components/__tests__/adaptive-media-preview-swiper.test.tsx
---

# 全屏轮播与详情续读入口排查

基线为 `6825fddc`（v0.55.8）上的本地修复。本文不表示已提交、发布、部署或通过安卓真机验收。当前规则见[自动浏览](../../features/artwork-auto-browse.md)和[阅读与续读](../../features/artwork-reading.md)。

## 已复现的轮播问题

隔离作品有 120 张合成静态图片，SSR 首批为 24 张。仅在临时应用副本中将该作品的 `artwork.reader` 查询延迟 10 秒：普通完整详情首开全屏，未经手动切图便启动自动播放。播放前进到第 7 张后，完整索引返回，控件变为 `1/120` 且暂停，而真实 Swiper 的活动索引仍是 6。

这是两处初始化共同造成：适配预览 effect 以媒体数量变化为重置条件，将内部位置回设为打开页并清空解码集合；堆叠上下文首次取得索引时也暂停共享自动浏览状态。已有图片节点不会因为索引增长再次触发加载事件，因此重新点播放仍可能等待，手动切图后才恢复。

修复将预览初始化限定为打开会话；首批到完整索引保留位置和已解码资源。首次建立堆叠索引不暂停主动播放；已有快照指纹发生变化时仍暂停、按真实媒体定位。没有新增状态、轮询、延时、API、数据库字段或迁移。

真实 AdaptiveMediaPreview、Swiper、Dialog 与 ArtworkSummaryProvider 组合回归覆盖 24→120 张、从第 1／3 张开始、正常过渡／减少动态效果；索引补全时不再次派发已有图片的 load。回退本次修复时，迟到索引用例以 `paused` 与预期 `running` 不符失败；恢复后保持页码并继续下一张。正常过渡在 jsdom 中显式派发 CSS transitionend，不记为浏览器测试。

修复后用同一隔离浏览器流程，完整索引到达后已连续前进到 `12/120`，真实活动索引为 11，播放仍运行。关闭后按最终媒体回到详情，再打开预览可正常播放。

## 普通入口代码检查

已核对普通作品／艺术家列表入口、续读提示及索引定位：普通入口不自动恢复；8 秒提示超时只关闭，显式 `resume=1`／`mediaId` 入口才直接定位。首次索引不跳转的保护已在历史提交 `1cfb07f7`（2026-10-23）加入，本轮不把它作为新修复。

本地普通卡片进入、深位置返回再进入，以及首页显式续读后从普通列表重进，均未复现自动跳到上次图片。390×844 视口的最后一条链路显示第 8 张续读提示并保持 `window.scrollY=0`，提示超时后仍为 0。未确认对应代码缺陷，本轮不作推测性修改。

## 环境与验证

macOS、Node 20.19.4；独立应用副本监听 5440，PostgreSQL 16 监听 `55435/preview_dock_fixture`，ImgProxy 55436 只读挂载合成媒体。空库通过 134 条现有 migrations，用种子创建合成账户、39 件作品和长作品媒体；未用 db:push，未读写业务数据库或用户原媒体，保留原有 5430 服务。

- 聚焦：预览、索引、入口和自动浏览最初 6 文件／82 项通过；追加首张／非首张及普通入口回归后 4 文件／31 项通过。
- `pnpm lint`：0 warnings／0 errors；`pnpm typecheck`：通过。
- 提升权限 `pnpm build`：通过，Turbopack 编译 45 秒，TypeScript 与页面收集通过。
- 提升权限 `pnpm run test --maxWorkers=2`：最终串行全量 480 文件／3574 项通过，49 文件／351 项既有条件跳过；总 529 文件／3925 项，232.62 秒，真实 Swiper 新增 6 项全部包含。该轮在 build 结束后执行，无失败。
- 首次全量同样无失败：480 文件／3572 项通过、49 文件／351 项跳过，278.48 秒；当时新测试文件采集 4 项，后补的 2 项非首图组合已纳入最终串行全量。
- `pnpm docs:check`：360 Markdown 通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`：34 图源与 23 内嵌 Mermaid 通过。图示首次在沙箱中因 Chrome 启动 EPERM／SIGABRT 中止，提升权限重跑通过，未安装新浏览器。
- 主应用大写路径无命中，`git diff --check` 通过。

首次追加聚焦回归与全量单元、构建并行，基础轮播用例出现一次默认 5 秒超时及随后的 act 警告；未提高超时。构建结束后独立复跑上述 4 文件／31 项全部通过，最终串行全量也通过。全量任务结果单列，不把该次聚焦失败隐藏为首次通过。`test` 原有配置排除 integration、jsdom e2e 与扫描 fixture integration；49 个条件跳过文件未配置各自所需的专用 PostgreSQL 测试 URL，351 项未计为通过。

本地证据保留在忽略目录 `.local-data/bare-like-20261031/`：`preview-regression-before.log`、`preview-resume-unit.log`、`preview-resume-unit-final.log`、`preview-resume-build.log`，以及 `review/preview-resume/after-late-index.jpg`。隔离应用中的 10 秒延迟只用于复现，不进入产品代码。

本次浏览器标签已关闭，临时视口已恢复；5440 应用已停止，本次两个 fixture 容器已移除，5440／55435／55436 不再监听，原有 5430 服务 PID 79743 保留。种子、合成媒体和上述忽略目录证据保留，便于复核。
