---
status: historical
scope: 稍后决定独立分支的数据库、服务、界面和本地启动验证
last-verified: 2026-10-29
sources:
  - packages/pixishelf/services/archive-uploader/discovery-deferred-service.ts
  - packages/pixishelf/services/archive-uploader/__tests__/discovery-deferred.postgres.test.ts
  - packages/pixishelf-db/prisma/migrations/20261029110000_archive_discovery_deferred/migration.sql
---

# 2026-10-29 稍后决定验证

适用分支 `codex/archive-deferred`，基于 `3a5b5ee26eec303378ed8b852379b033ef625420`；当前行为见[发现来源](../../features/archive-discovery.md#稍后决定)。这是独立开发验证，未部署、未合并 main；浏览器与真实账户人工回归由用户执行。下载范围的 `ALL/FIRST_20` 由独立分支集成，本分支使用现有全量入箱行为。

## 环境与恢复依据

macOS、Node、pnpm、PostgreSQL 15。工作区为 `/Users/namehu/.codex/worktrees/archive-deferred/PixiShelf`。独立数据库 `pixishelf_deferred_dev` 使用容器 `pixishelf-deferred-postgres`、对应同名卷和本机端口 5452。媒体、派生媒体、Pixiv 路径均在此工作区 `.local-data/`，没有连接用户原有数据库或媒体。

数据库从空库执行 `pnpm db:generate`、`pnpm db:deploy`，共 131 条迁移成功；Prisma schema 校验通过，未使用 `db:push`。开发库只有合成测试样本，恢复单位是独立数据库与专属卷，可重新初始化并重放正式迁移；未将此步骤当作生产备份恢复演练。真实库升级前的检查点、停止条件和回退限制遵循[备份恢复](../../operations/backup-and-recovery.md)及[发布说明](../../features/archive-discovery.md#稍后决定)。新增表与命令枚举要求 App/Worker 协调升级，旧版历史清理不能继续清理新收据。

## 验证结果

- 定向 8 个文件、151 项测试通过，覆盖来源服务、稍后决定 PostgreSQL 实际事务、UI 操作、路由权限、源站跳转与输入边界；维护清理另有 9 项通过。最后的 URL helper 移动与 UI 用例归组后，再跑 2 个相关文件、57 项通过。
- 新增数据库用例验证跨来源共享、过滤成员查询、恢复保留人工筛选、删源后下载/忽略、忽略优先、直接 URL 成功清除、无效/容量拒绝保留、旧收据重放保留新决定、非可行动记录拒绝，以及同时间游标分页。
- 现有来源入箱并发用例改为同时发起来源入箱与直接 URL 入箱，断言来源提交成功、第二次提交为重复，并验证目录进入收件箱及后续 READY 状态。原夹具在已持有身份锁的回调内等待竞争事务完成，会与新身份串行化相互等待；新夹具不阻塞持锁事务，仍检查真实 PostgreSQL 竞争结果。
- 主应用 `pnpm typecheck`、本次变更文件 lint、路径大小写检查与 `git diff --check` 通过。未运行 Next.js 生产构建或全量应用测试，最终集成检查由总任务统一安排；Worker 仅构建一次以启动实际进程。
- 文档链接与图示语法/源哈希检查通过；本次未修改图源。

已有 `archive-intake-service.postgres.test.ts` 的扩展回归出现 13 失败、3 通过。将完整未修改基线 `3a5b5ee` 解包到独立临时目录，安装同锁文件依赖并生成客户端，再连接同一隔离数据库执行同一测试文件，得到相同的 13 失败、3 通过；包括旧夹具来源证明及 Provider 假设，不计为本功能通过。基线复现输出保存在工作区 `.local-data/runtime/baseline-intake-tests.log`；临时基线路径记录在 `baseline-path`。本功能 151 项定向测试的通过输出另存为 `deferred-focused-tests.log`。没有放宽这些失败断言或据此声称全套回归通过。

## 独立进程

Web 地址为 `http://127.0.0.1:5450/admin/archive/inbox?entry=direct`；HTTP 返回认证重定向 307，未登录页面行为尚待人工验证。ImgProxy 使用独立容器 `pixishelf-deferred-imgproxy`、端口 5451，健康请求返回 200。Worker 端口 5453，preflight 和三条执行 lane 为 READY，`dist/healthcheck.cjs --mode=ready` 返回成功。

Web 从 `packages/pixishelf` 执行 `pnpm prepare:webp` 后运行 `pnpm exec next dev --hostname 127.0.0.1 --port 5450`；Worker 从 `packages/pixishelf-worker` 执行 `node --env-file=../pixishelf/.env.local dist/main.cjs`。启动时 Web 父进程 PID 80907，Worker 恢复后的 PID 83721。当前 PID 与日志保存在 `.local-data/runtime/{web,worker}.{pid,log}`；停止时对对应 PID 发送 `TERM`，重启按以上命令。数据库和 ImgProxy 用各自容器名执行 `docker stop` / `docker start`，不删除卷。环境文件和数据库口令只在本机忽略目录保存，不纳入提交。

进程已保留供人工回归。自动数据库测试期间暂停 Worker，完成并确认无合成待执行任务后再恢复，避免测试样本触发真实源站请求。没有执行浏览器验证。

## 独立审查修复

首版提交 `049828a5` 经独立 reviewer 检查，发现旧收件项重试成功未清除暂缓，以及扫描完成未刷新暂缓列表两处问题。修复将重试的身份锁覆盖尚未解析出 Provider 字段的旧收件项，仅在事务成功改为 QUEUED 后删除对应暂缓；单来源扫描完成及批次进度变化使列表缓存失效。

修复后 4 个相关文件共 76 项通过，其中 12 项为实际 PostgreSQL 测试，新增“已有作品更新入箱→取消→暂缓→重试成功清除”的完整路径，并核对再次取消后的新暂缓不受旧成功收据重放影响、容量失败及其重放保留决定、来源证明失败保留决定。单来源及批量扫描测试验证列表失效，初次加载已完成扫描不重复刷新。`pnpm typecheck` 和 6 个变更代码文件 lint 通过，无全量构建。日志保存在 `.local-data/runtime/deferred-review-fixes.log`。测试只暂挂此工作区 Worker，并在 `finally` 恢复；修复仍须独立复审后关闭问题。
