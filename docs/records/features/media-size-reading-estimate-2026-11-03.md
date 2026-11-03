---
status: historical
scope: 媒体体积与阅读预估的本地实现验证；不代表生产发布
last-verified: 2026-11-03
---

# 媒体体积与阅读预估验证

- 日期与版本：2026-11-03，基于 `dc6a9fc8` 的本次未提交工作区改动。
- 环境与样本：本机 macOS、Chrome、Next.js 开发服务；既有本地库 23 部作品、592 个媒体文件，详情抽样为 100 项合成图片作品。未向用户的 DBX 连接写入数据，未执行迁移、目录扫描或存储变更。
- 当前规则见[统计查询](../../architecture/statistics-query-performance.md#媒体占用)与[作品阅读](../../features/artwork-reading.md#媒体信息与阅读预估)。

## 自动检查

- 统计服务、阅读索引、统计展示、详情摘要及媒体菜单共 5 个聚焦测试文件，59 项通过。覆盖一次分类聚合、空库、缺失大小、大于 32 位的大小、未知类型、300 秒独立缓存、局部失败、配对文件体积及逻辑计数、超过 24 项的完整总量与既有查询规模，以及 0、1、59、60、61、120 项阅读预估。
- 主应用 `pnpm lint`、`pnpm typecheck`、提升权限的 `pnpm build` 通过。
- 主应用 `pnpm test`：494 个文件、3699 项通过；55 个文件、385 项按既有环境条件跳过。首次受限执行的 5 项失败均涉及本地监听／IPC 权限，提升权限完整重跑后通过。该命令不包含 `tests/integration`。
- `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、路径大小写与 `git diff --check` 通过。图示检查使用已安装 Chrome；默认 Playwright 浏览器未安装。
- 新增 PostgreSQL fixture 覆盖回收站、未关联文件和缺失大小；未设置专用 `STATISTICS_TEST_DATABASE_URL`，未运行真实隔离数据库断言。单元测试和本地页面成功读取不能代替这项验证。

## 浏览器检查

实际页面通过 `entry=direct` 进入。统计页和详情页检查 1360 像素桌面及 390 像素手机宽度，手机没有横向溢出；详情右键菜单显示格式与文件大小，操作顺序保持。统计总量与分类层级清晰，摘要保持次级视觉权重。

当前应用没有主题切换入口。深色检查使用实际页面导出的组件标记和项目编译 CSS，在本机临时静态页面设置现有 `.dark` 主题，检查桌面／手机样式；这只证明新增组件的深色样式，不代表应用主题切换流程。加载、空数据、缺失大小和局部错误由组件测试覆盖，未做浏览器网络故障注入。

本地临时证据：`/private/tmp/pixishelf-storage-desktop-light.jpg`、`/private/tmp/pixishelf-storage-mobile-light.jpg`、`/private/tmp/pixishelf-detail-desktop-light.jpg`、`/private/tmp/pixishelf-detail-menu-mobile.jpg`、`/private/tmp/pixishelf-media-dark-desktop.jpg`、`/private/tmp/pixishelf-media-dark-mobile.jpg`。完整测试与构建日志分别为 `/private/tmp/pixishelf-media-full-test-unrestricted.log`、`/private/tmp/pixishelf-media-build.log`；临时文件不随仓库交付。

## 发布与恢复边界

本次仅交付代码和文档，未部署。没有数据库结构或原文件变更；回退应用版本即可撤销展示与聚合逻辑，无需数据恢复。新增聚合的生产耗时和大库浏览器表现尚未实测，缓存为 5 分钟并与其他统计区域隔离。
