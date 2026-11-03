---
status: historical
scope: 未开始下载的归档暂存清理失败修复与隔离回归证据
last-verified: 2026-11-03
sources:
  - packages/pixishelf-job-executors/src/archive/staging-cleanup-recovery.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/maintenance-executor.test.ts
  - packages/pixishelf/services/archive/__tests__/archive-cleanup-recovery.postgres.test.ts
---

# 未开始下载的暂存清理失败修复

日期：2026-11-03。适用版本：`v0.55.23`（基于 `ca840e99`），尚未登记生产发布或恢复验收。本文保留诊断与验证证据；当前规则见[归档生命周期](../../features/archive-lifecycle.md#generation-与清理)，操作步骤见[领域恢复手册](../../operations/runbooks/domain-recovery.md#未开始下载时清理失败)。

## 生产只读诊断

通过 DBX 的 `pixishelf_diagnostics` 连接显式查询 `pixishelf` 应用库，按归档 ID 查询得到 1 条归档、2 条相关任务和 0 条暂存代记录，没有修改生产数据或文件。以下时间为北京时间：

- 归档 `1ed0fbfd-bff9-43a7-867a-ddb7994fcd47` 与绑定下载任务 `35c76aa1-3041-4ba5-82ee-1482c4eadd22` 均为 PAUSED；归档处于 DOWNLOAD 阶段，130 张、完成 0 张，没有开始时间，下载 attempt 为 0。
- 14:45:12 写入清理意图，14:45:13 清理任务 `689675eb-2d11-4fcc-bf0c-8581ca0b910d` 在 PREPARING 阶段失败，错误为 `Original staging cleanup checkpoint is missing or changed`。
- 用户提供的 16:08 取消请求返回 `CLEANUP_IN_PROGRESS`，与仍存在的 `cleanupRequestedAt` 一致。

旧实现无条件拒绝 generation 数量为 0；尚未开始的 DOWNLOAD 因此无法清理。失败发生在创建目录写入声明之前，保留的清理标记又阻止后续取消。

## 修复与回归

只允许没有暂存代且当前 generation 指针为空的 DOWNLOAD 通过原有清理检查点流程。其他阶段缺少暂存代、当前指针对应记录缺失、未 drain 或已有检查点变化的拒绝规则保留；没有 schema、payload、任务定义版本或部署配置变更。

新增单元回归覆盖 DOWNLOAD 无暂存代可以完成，以及 PUBLISH、LEGACY、当前指针存在但代记录缺失仍然拒绝。新增真实 PostgreSQL 与临时文件回归分别覆盖 PENDING／PAUSED：复现旧清理失败后的持久状态 → 取消被拦截 → 从原归档再次发起清理 → Worker 完成并清除标记 → 原幂等键仍重放冲突 → 新幂等键取消成功。相邻文件保留，下载 attempt 仍为 0，没有启动下载或访问原站。

修复前，DOWNLOAD 单元回归和两项 PostgreSQL 回归均在原 generation 数量检查处复现相同错误。修复后验证使用新建的一次性 `postgres:15-alpine` 容器、独立 `cleanup_test` 空库与临时媒体目录，完整 deploy 137 项正式 migration；未使用 DBX 诊断连接执行测试，没有连接生产或已有开发库。测试结束后临时容器已停止并自动删除。

## 验证结果与限制

- `maintenance-executor.test.ts`：24 项通过，包括新增的 4 项无暂存代边界回归。
- 新增恢复与取消链路及已有原声明恢复：`archive-cleanup-recovery.postgres.test.ts`，4 项通过。
- 已有执行退出、维护事务与检查点恢复：`download-lane-recovery.postgres.test.ts`、`maintenance-executor.postgres.test.ts`、`staging-cleanup-recovery.postgres.test.ts`，35 项通过。
- App lint／typecheck／生产 build 与 Worker 依赖链 typecheck／build 通过。
- App 全量 `pnpm test` 初跑为 3749 通过、10 失败、387 跳过；失败涉及本地 socket 的 `EPERM`、并行负载下的超时及组件等待。将全部 5 个失败文件在提升权限、`--maxWorkers=2` 下复跑，79 项全部通过。
- Executor 全量 `pnpm --filter @pixishelf/job-executors test` 初跑为 998 通过、37 失败、563 跳过；失败集中在受沙箱限制的原生子进程与回环代理 fixture。全部 5 个失败文件提升权限后复跑，55 项全部通过。全量任务没有设置数据库变量，因此相关 PostgreSQL 用例跳过；本修复所需数据库回归单独在上述隔离库执行。
- 并行构建期间复核 35 项 PostgreSQL 测试时，3 项 101-revision 恢复用例超过默认 5 秒；构建结束后最终串行复核 35 项全部通过，未修改断言或超时配置。
- `pnpm docs:check`、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`、主应用路径大小写与 `git diff --check` 通过。默认 Playwright 浏览器未安装，图示检查使用本机已有 Chrome。

上述结果证明隔离 fixture 中的修复与恢复链路，不证明生产已部署、已恢复或反向代理／真实外站访问正常。上线后应在原下载行重新执行“清理暂存文件”，待子任务完成再用新操作取消；不要手工清除标记或删除目录。已存在未解决写入声明的任务仍须恢复原声明，不属于本次直接重新清理的适用范围。
