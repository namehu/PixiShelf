---
status: historical
scope: 自动计划状态常驻和即时开关本地验证
last-verified: 2026-11-02
---

# 自动计划控件验证

适用版本：Git HEAD `595d1f14` 加本轮工作区改动。本机 macOS、Node 20、Chrome；未更改真实计划或触发任务，不代表生产部署验收。

## 自动检查

- 实现负责人执行相关五个测试文件，46 项通过；覆盖开关、草稿、代表帧和读取异常。
- 主应用 `pnpm lint`、`pnpm typecheck`、提升权限 `pnpm build` 通过。
- 主应用 `pnpm test` 首次 3681 通过、385 跳过、5 失败；跳过包含未配置隔离 PostgreSQL 的环境门禁。5 项失败因沙箱禁止本地端口或 tsx IPC 监听（EPERM）；提升权限并限制两个 worker 复跑两个受影响文件，35 项通过。完整套件并非一次全绿。
- `pnpm docs:check`、提升权限 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、路径大写检查和 `git diff --check` 通过。默认图示检查缺少 Playwright headless shell，使用本机 Chrome 验证。

## 浏览器观察和限制

本地已登录 Chrome 的真实任务页无障碍树显示自动计划概览 3/12、上海窗口，12 个折叠计划开关包括视频代表帧及每周一目录核对；手动卡无开关。未操作真实开关。真实页面截图接口呈空白，因此未据此声称真实页面视觉通过。

隔离浏览器夹具使用实际 `TaskAccordion`、`TaskSection`、`ScheduledTaskToggle`、Switch、QueryClient 和开发 CSS；导航与保存接口使用内存替身。桌面和 375×812 视口查看带长运行摘要的卡片：手机开关与保存中文字在第二行，无可见横向溢出。点击标签切换时卡片保持收起，标题按钮独立展开；键盘 Space 切换时对应卡片保持收起。手机点击滑轨外约 5px 热区可触发，保存中仅该卡禁用，其他卡仍可用；模拟失败恢复先前状态并显示错误，未知状态显示暂不可用。浏览器截图通过工具查看，未保存为文件。

真实账户持久化、实体触屏和真实任务执行未验证；保存成功后的数据库与调度行为未在真实用户数据上操作。夹具不替代真实服务端联调。
