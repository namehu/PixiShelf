---
status: historical
scope: 艺术家管理搜索、创建及查看归档来源的本地验收证据
last-verified: 2026-10-24
sources:
  - docs/features/archive-discovery.md
  - packages/pixishelf/app/admin/artists/_components/artist-discovery-sources.tsx
  - packages/pixishelf/services/archive-uploader/discovery-creator-service.ts
---

# 艺术家来源入口验证

- 日期与版本：2026-10-24，基于 `3cf71c88` 的本次未提交工作区改动；不代表已发布版本。
- 环境：本地 macOS、主应用开发服务、独立 PostgreSQL 16 容器和合成数据。
- 当前行为：[来源发现规格](../../features/archive-discovery.md#从艺术家管理查找和关联来源)。

## 静态与自动化验证

主应用 `pnpm lint`、`pnpm typecheck` 和提升权限的 `pnpm build` 通过。首次全量 `pnpm test` 与构建同时运行，12 个文件中的 21 项出现超时／异步等待及沙箱权限失败；降低并发后执行 `pnpm run test:unit --maxWorkers=2`：428 个文件、3,115 项通过，32 个文件、227 项按专用环境配置跳过；仍有 2 个文件、5 项因沙箱禁止本地监听而失败，命令退出码为 1。未把跳过或环境失败记作通过。

剩余失败均为 `listen EPERM`：`safe-http.test.ts` 的三项回环代理用例，以及 `background-task-cutover-audit-cli.test.ts` 的两项 tsx IPC 用例。仅提升权限重跑这两组，2 个文件、35 项全部通过；没有放宽断言或修改既有测试。新增功能相关用例均已通过。全量命令未包含 integration、`.e2e.test.*` 和扫描 fixture；相关 PostgreSQL 另行执行如下。

本机临时日志：`/private/tmp/pixishelf-artist-discovery-unit.log`（首轮）、`/private/tmp/pixishelf-artist-discovery-unit-retry.log`（降低并发）、`/private/tmp/pixishelf-artist-discovery-sandbox-retry.log`（提权复验）、`/private/tmp/pixishelf-artist-discovery-postgres.log`、`/private/tmp/pixishelf-artist-discovery-build.log`、`/private/tmp/pixishelf-artist-discovery-typecheck.log`。日志不作为持久化发布附件。

文档 `pnpm docs:check` 通过（180 个 Markdown）；默认图示校验缺少 Playwright 自带 Chromium，使用本机已有 Chrome 执行 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 后通过（28 个图源、23 个内嵌 Mermaid）。主应用无大写路径，`git diff --check` 通过。

新增测试覆盖安全外链编码、DTO 真实关系、无／单／多来源及停用标记、隐私遮蔽、预填与切换艺术家、取消重开、重复来源明确追加确认、错误重试和刷新失败。服务与路由测试覆盖管理鉴权零调用、严格输入校验、版本冲突、无效艺术家、并集上限、保留既有绑定和幂等追加。

隔离 PostgreSQL 容器使用临时数据库、仅回环端口且无业务卷挂载，执行全部 101 条既有正式 migration；本次没有新 migration。以下三组测试串行运行，3 个文件、18 项全部通过：

```bash
pnpm exec vitest run services/archive-uploader/__tests__/append-discovery-creators.postgres.test.ts services/archive-uploader/__tests__/discovery-creators.postgres.test.ts services/archive-uploader/__tests__/archive-title-search.postgres.test.ts --no-file-parallelism
```

运行时仅向该命令提供专用 `QUEUE_KERNEL_TEST_DATABASE_URL`。新增两项真实数据库测试验证并发创建复用同一来源、并发追加取并集、重复追加幂等、停用状态保持、DTO 关联可见、规则版本过期与合并艺术家拒绝，以及不产生扫描、待生效绑定或作品绑定。已合并艺术家的 fixture 通过事务回滚清理，不关闭数据库保护触发器。未向实际应用数据库写入测试关系。测试后已停止并自动移除本次临时容器。

## 浏览器视觉回归

按用户要求由独立 `gpt-6.1-sol / xhigh` 执行。使用本地已认证会话及 `entry=direct`，在 1280×720 视口实际检查：

- 艺术家表格「归档来源」列、未关联入口和行菜单。
- E-Hentai 外链的查询条件、新标签页、安全 rel 与 referrer 属性；没有访问外站结果。
- 表单关键词与艺术家预填、修改后搜索链接同步、非法关键词禁用搜索。
- 取消重开恢复预填、切换艺术家不残留草稿。
- 576×688 弹窗在桌面视口内可见，表单独立滚动、底部操作区可达。
- 当前艺术家标签与选择器浮层中的名称使用隐私遮蔽组件。

上述桌面样本通过，未修改用户隐私偏好或保存业务数据。截图位于本机临时目录 `/private/tmp/pixishelf-artist-discovery-visual/`：`artists-table-desktop.png`、`archive-menu-desktop.png`、`source-dialog-desktop-top.png`、`source-dialog-desktop.png`；临时目录不属于持久化发布证据。

限制：当前浏览器工具未提供调整视口能力，窄屏／移动端未完成浏览器验收；现有四位艺术家均未关联来源，因此单／多／停用来源以及进入详情仅有组件和数据库验证，未记作浏览器通过。未核验外站登录／搜索结果或生产部署。本功能没有改变抓取和下载流程。

## 回退与恢复依据

本次仅修改 App 和文档，没有修改数据库结构、Worker、部署配置或媒体文件。回退 App 后，已保存关系仍遵循现有来源固定艺术家机制，可在来源详情管理；不自动删除关系或回滚用户操作。验证数据库及容器为可丢弃合成环境，不承担生产恢复职责。
