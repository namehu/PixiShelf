---
status: historical
scope: 来源范围全局忽略视图的隔离开发验证
last-verified: 2026-10-29
sources:
  - packages/pixishelf/services/archive-uploader/archive-uploader-ignored-query.ts
  - packages/pixishelf/tests/integration/archive-ignored-scope.postgres.test.ts
  - docs/features/archive-discovery.md
---

# 来源范围忽略视图验证

2026-10-29，分支 `codex/archive-scoped-ignore` 基于 `3a5b5ee26eec303378ed8b852379b033ef625420` 实现。
本文记录开发检查，不代表独立代码审查或用户人工回归已通过。当前功能规则见[来源发现](../../features/archive-discovery.md#忽略与删除的区别)。

## 环境

独立 worktree、独立依赖与构建目录。Web 使用 `127.0.0.1:5440`，ImgProxy 使用 `5441`，PostgreSQL 使用 `5442/pixishelf_ignore_dev`，Worker 健康端口 `5443`。原媒体、派生媒体、Pixiv 资料均使用本 worktree 的 `packages/pixishelf/.local-data/` 子目录；配置与日志不进入 Git。

PostgreSQL 15 空库通过 `pnpm --filter @pixishelf/db db:generate` 与 `db:deploy`，完整应用 129 条 migration。本功能没有 Schema 或 Worker 契约变更；没有连接主开发业务库，SQL 测试样本在事务结束时全部回滚。回退仅需切回旧 App 版本，无数据迁移或文件恢复操作。

## 检查与证据

- 主应用五个定向套件共 126 项通过：上传者 service、两组路由认证、来源组件与工作区导航。按行数规则抽出查询模块后，相关两套 72 项再次通过。
- `archive-ignored-scope.postgres.test.ts` 在上述隔离 PostgreSQL 通过：跨来源身份、被过滤目录、停用标题来源、同时间游标、分页总数、来源内原站链接、全局恢复与重复恢复、原忽略来源及全部来源删除后的保留。
- `pnpm typecheck` 通过；修改代码的定向 `oxlint` 通过；`git diff --check` 与主应用全小写路径检查通过。
- `pnpm docs:check` 通过（326 份 Markdown）；图源未修改。默认 Playwright Chromium 不存在，改用已安装 Chrome 后 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（34 份图源、23 块内嵌 Mermaid）。这仅为文档图示检查，不是产品浏览器回归。
- Worker 为独立启动运行了一次包级 build（通过，沿用现有三个 `import.meta` CJS warning），`prepare:webp` 通过。自带 healthcheck `--mode=ready` 和 capability audit 通过：1 个 READY Worker，39 个任务类型、58 个版本，三条 lane 均 READY。
- HTTP 冒烟：`/login?entry=direct` 返回 200，未认证的 `/admin/archive/inbox?entry=direct` 返回 307，ImgProxy `/health` 成功，Worker `/readyz` 返回三条 READY lane。

未运行 Web 生产 build 和主应用全量套件；由最终集成分支统一执行。未做浏览器验证，留给用户人工回归。

## 手工回归入口

启动后的入口为 `http://127.0.0.1:5440/admin/archive/inbox?entry=direct`，全新隔离库需在登录页初始化独立测试账户。验证同一画廊被两个来源发现、在其中一处忽略后，两个来源的“查看本来源已忽略”均能找到它；从任一视图恢复后全局解除忽略。另测过滤结果、翻页、返回来源、浏览器深链、来源删除后全局恢复。

本地运行日志与 PID 文件位于 `packages/pixishelf/.local-data/runtime/`，Web 采用 `pnpm exec next dev --hostname 127.0.0.1 --port 5440`，Worker 采用自己的 `dist/main.cjs` 并显式加载同 worktree 的 `.env.local`。停止时只向这两个 PID 发送 SIGTERM，并停止 `pixishelf-ignore-postgres`、`pixishelf-ignore-imgproxy` 两个容器；保留命名卷，不删除数据库。

## 独立审查修复

独立审查指出：来源扫描新发现一个已在别处全局忽略的画廊后，停留在本来源忽略视图的缓存不会失效，列表及总数可能延迟更新。修复把已忽略查询加入实际观察到的扫描完成刷新；同类批量扫描进度与完成刷新也同步失效该缓存。首次加载历史已完成任务、重复渲染相同完成状态不额外刷新。

新增组件回归覆盖：停留在来源忽略页观察 RUNNING → COMPLETED，以及批量扫描完成后已有忽略缓存刷新。修复后两套组件测试共 53 项通过，typecheck、定向 lint、docs:check、差异及命名检查通过。未执行额外全量 build。本节只记录修复内容与开发验证，复审结论由独立审查者给出。
