---
status: historical
scope: 作品卡片阅读状态与全屏阅读交互的本地验证
last-verified: 2026-11-02
---

# 卡片与全屏阅读交互验证

适用版本：Git HEAD `c003953d20f9` 加本次工作区改动。本地 macOS、Node 20、Chrome；未访问生产媒体或修改业务数据。此记录仅描述本次工作区验证，不代表部署或生产验收。

## 自动检查

- 相关六个组件测试文件共 98 项通过（实现负责人执行）。
- 主应用 `pnpm lint`、`pnpm typecheck`、提升权限 `pnpm build` 通过。
- 主应用 `pnpm test`：3667 通过、384 跳过、5 失败；跳过包含未配置隔离 PostgreSQL 的环境门禁。5 项失败均为沙箱禁止本地端口或 tsx IPC 监听（`EPERM`）；提升权限重跑涉及的 `safe-http` 与 `background-task-cutover-audit-cli` 两文件，35 项通过。这不是一次完整测试全绿。
- `pnpm docs:check`、提升权限的 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、主应用路径大写检查和 `git diff --check` 通过。图示检查初次在沙箱中 Chrome 启动失败，提升权限后通过。
- 指定的七个变更 UI 文件运行 `impeccable detect --json`，结果为空。

## 浏览器抽样和限制

使用独立端口的临时合成页面，打包实际 `AdaptiveMediaPreview`、`MediaMarkActions`、自动浏览捕获 hook 和本次生产构建 CSS；标记读写为内存替身，图片为合成资源。Chrome 在 1280×800 和 375×812 检查鼠标完整点击喜欢、空格取消喜欢时自动浏览继续，以及键盘停靠左、右、底部；按钮热区至少 44px，视口内无溢出，也无页面运行错误。截图位于 `/tmp/pixishelf-regression/`，仅作本机临时证据。

另加载仓库 `benchmark.webp`、实际 Worker/WASM；样本解析为 240 帧、9920ms、913788 字节，填入相应媒体元数据。手动播放首帧后，完整鼠标点击喜欢前后进度从 7% 增至 10%，Worker 和 canvas 均保持一个，播放仍在继续。自动单轮中点赞前后进度从 7% 增至 11%，随后到 93%，并在完成后从 1/3 推进到 2/3。已检查 `/tmp/pixishelf-regression/webp-progress.png`：白色半透明进度覆盖红色分区全高，边缘未见暗色露边。此处使用内存标记替身，不覆盖实际网络持久化。

另用实际 `ArtworkCard` 与构建 CSS，封面、偏好标签和隐私文字使用合成替身；桌面和手机视口各检查普通／简约、浅／深封面以及未读、阅读中、已读和未知状态。未读／阅读中标记测得字体 9px、圆点 5×5px、距右下各 8px；已读和未知无标记，偏好标签及右上数量可见，左上无阅读三角。截图为 `/tmp/pixishelf-regression/cards-1280.png` 和 `/tmp/pixishelf-regression/cards-375.png`。

真实 WebP 单图与多图在两个视口分别检查底部、左侧、右侧停靠；进度层与分区高度均为 48px，截图中红区铺满且无暗边。Chrome 手机触摸模拟双击后喜欢生效、自动播放未暂停，进度从 1% 增至 2%；模拟实际拖动后自动播放暂停。截图位于 `/tmp/pixishelf-regression/webp-375-multi-left.png` 和 `/tmp/pixishelf-regression/webp-1280-single-right.png`。

未连接实际账户 API 或隔离数据库；网络失败由组件替身覆盖，实体设备双指缩放及真机触屏未验证。
