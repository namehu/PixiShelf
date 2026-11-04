---
status: historical
scope: Worker PostgreSQL 测试文件共享写入通道导致的 CI 间歇失败
last-verified: 2026-11-04
sources:
  - packages/pixishelf-worker/vitest.config.ts
  - packages/pixishelf-worker/src/__tests__/pixiv-root-identity.postgres.test.ts
  - packages/pixishelf-worker/src/__tests__/scan-realtime-progress.postgres.test.ts
  - packages/pixishelf-worker/src/pixiv-root-identity.ts
---

# Worker 测试写入通道隔离

用户提供的 CI 日志显示，Worker 测试中根目录身份套件有三项失败：竞争绑定无成功项、创建活动任务触发 `executionLane` 唯一约束，以及活动租约测试提前收到调度锁占用错误。该阶段为数据库测试，尚未进入 Worker 构建。

根目录身份维护与扫描调度共用 `BACKGROUND_WRITER` 通道及 advisory lock。`describe.sequential` 只约束文件内的测试，Worker 原配置允许不同文件并行，扫描进度套件因此可能占用身份维护套件期待空闲的全局通道。执行器包已有测试文件串行的配置，本次为 Worker 同样设置 `fileParallelism: false`；竞争绑定测试内部的两个真实数据库客户端和 `Promise.allSettled` 保留，运行时代码、错误断言及唯一约束均未修改。

## 验证环境与范围

本机使用独立 PostgreSQL 15 临时容器，数据目录为 tmpfs，先向空库部署完整 migration 链。没有挂载现有数据库或媒体目录，也没有对现有实例执行迁移、清理或停机。

修改前完整 Worker 测试为 132 项通过、1 项跳过，单独并行运行身份维护与扫描进度两文件为 11 项通过；本机这两次运行未复现失败，不能声称已经稳定复现 CI 的时序。

修复验证沿用 CI 的 `CI=true` 与隔离 `DATABASE_URL`，执行 `pnpm --filter @pixishelf/worker... test`、`pnpm --filter @pixishelf/worker... typecheck` 及依赖链构建。另以显式 `QUEUE_KERNEL_TEST_DATABASE_URL` 运行 Worker 测试，覆盖 CI 默认跳过的离线恢复套件。各套件的启用条件保持原样，不删除断言、增加重试或放宽超时。

| 验证                                | 结果                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| CI 同款完整依赖链测试               | 1,934 项通过、593 项按既有环境条件跳过；其中 Worker 为 132 项通过、1 项跳过 |
| 显式启用全部 Worker PostgreSQL 用例 | 20 个文件、133 项全部通过，无跳过                                           |
| 完整依赖链 typecheck / build        | 均通过；构建仍有 3 条既有 CJS `import.meta` 警告                            |
| 配置 lint、Prettier、文档与图示检查 | 均通过                                                                      |

验证后已停止并移除临时数据库容器，tmpfs 随之释放。恢复依据是测试实例从空库创建、没有持久卷或现有媒体挂载；本次没有需要恢复的应用数据。

这是本地隔离验证，不代表 GitHub Actions 已重新通过；远端结果需由包含修复的 CI run 确认。
