---
status: historical
scope: 下载批量保存、暂停取消与重启续传的隔离验证
last-verified: 2026-10-29
sources:
  - packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-checkpoints.test.ts
  - packages/pixishelf-job-runtime/src/__tests__/queue-repository.postgres.test.ts
---

# 下载批量保存验证

适用版本：2026-10-29 本次工作区修改，尚未登记发布提交或镜像。当前规则见[归档生命周期](../../features/archive-lifecycle.md#下载期间的保存方式)。

## 环境与恢复依据

使用新建的一次性 PostgreSQL 15 Alpine 容器、独立测试库和临时媒体目录，从空库 deploy 完整 129 项迁移。测试没有使用 DBX 的 `pixishelf_diagnostics` 连接，没有修改家庭收藏库、媒体或正在运行的业务容器。外站由受控图片流替代。测试容器已停止并自动删除。

本次无 schema 迁移、Redis 或额外服务依赖。任务保存仍使用既有数据库与暂存目录。升级或回退前停止调度、等待活动任务退出并保留数据库和媒体；已保存文件按原规则核验复用，突然退出前未保存的一批可重新下载。正式环境的备份单位沿用[备份与恢复](../../operations/backup-and-recovery.md)，此测试不代替生产恢复演练。

## 已验证的行为

- 12 张图片在第 10 张完成后一起保存，余下 2 张在结束时保存；该快速任务只发生 2 次结果批次提交，逐图记录、汇总及进度事件一致。这不包含领取、限速、心跳和发布事务。
- 未满 10 张时，运行中的慢图片不会阻止 5 秒定时保存已完成结果。
- 暂停、取消和正常停机均中断正在传输的流，保存最后已完成的一批；取消不创建发布后继。
- 暂停后继续和正常停机后重启只下载剩余图片；突然退出前未保存的结果允许重新下载。
- 已保存文件复用、旧执行失效、发布交接与清理恢复的既有回归继续通过。
- 批次保存过程中完成的新图片不会被旧批次的确认清掉；明确未启动的数据库事务失败会有限重试。
- 5 秒采样略有延迟时仍显示合理速度；页面不会在正常批次间隔内误报进度中断。

突然退出测试通过禁止最后批次提交及终态结算、过期原租约、重新领取任务模拟故障；使用真实 PostgreSQL 和文件系统，但没有实际杀死下载进程或模拟 NAS 断电。

## 执行与结果

- `node packages/pixishelf-worker/scripts/build-dedup-native.mjs`：通过。
- `pnpm --filter @pixishelf/worker... typecheck`、`test`、`build`：通过。全链测试未配置数据库的套件按约定跳过，相关数据库套件单独执行如下；新增批次单测及最终下载执行器另有聚焦复验。
- 下载执行器、批次保存、限速与速度单测：61 项通过。
- 隔离库的 `download-lane.postgres.test.ts`、`download-lane-recovery.postgres.test.ts`、`provider-governor.postgres.test.ts`：45 项通过。
- 隔离库的 `queue-repository.postgres.test.ts`：79 项通过，覆盖检查点事务、控制优先级与失去租约后的回滚。
- 主应用 `pnpm lint`、`pnpm build`：通过；最终 `pnpm test` 为 466 个文件、3431 项通过，337 项数据库测试因未配置相应连接而跳过。首次与构建并行运行时，来源批量选择用例触发 5 秒超时；单独复跑 6 项通过，再独立重跑全量通过，没有提高超时或修改该用例。
- `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、路径大小写和 `git diff --check`：通过。图检查的默认 Playwright 浏览器缺失，使用本机 Chrome 检查 34 个图源和 23 个内嵌 Mermaid 块；本次没有修改图源。

旧清理测试补全了 fixture 缺失的已退出 generation 和 manifest 摘要；没有放宽生产清理要求。Worker 构建存在 3 条未涉及文件中的 CJS `import.meta` 警告，构建成功。

证据位置：上述测试文件，以及相邻的 `executor.test.ts`、`provider-governor.test.ts`、`transfer-meter.test.ts` 和主应用 `archive-management-ui.test.tsx`。上述自动测试未访问真实远端图片；后续用户本地人工回归已确认通过，结果见[本地环境与人工回归记录](../operations/archive-download-batches-local-upgrade-2026-10-29.md#用户人工回归与结果核对)。本次未部署飞牛、未做生产并发吞吐或数据库负载对比，因此不宣称线上超时已消失。
