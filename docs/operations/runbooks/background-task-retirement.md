---
status: current
scope: 尚未完成后台任务兼容层退役的实例升级与恢复边界
last-verified: 2026-10-22
sources:
  - packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs
  - packages/pixishelf-db/prisma/migrations/20261007100000_background_task_retirement_read_model/migration.sql
  - packages/pixishelf-db/prisma/migrations/20261011000000_background_task_retirement_contract/migration.sql
  - build/entrypoint.sh
---

# 后台任务退役发布手册

当前代码已经进入二阶段 Schema。此页用于仍未完成升级的其他实例；已经完成的实例不应重放旧阶段操作。一个已部署实例的用户确认与开发验证分别保存在[2026-10 记录](../../records/operations/background-task-retirement-2026-10.md)，不据此推断其他实例已上线。

## 选择正确阶段

| 数据库/版本状态            | 必须执行                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| 未完成第一阶段             | 先使用**只包含第一阶段迁移**的已核验配套镜像，完成加法迁移和观察；不要拿当前 `latest` 执行第一阶段命令 |
| 已完成第一阶段，观察未结束 | 保持一阶段兼容版本，完成至少 7 天真实任务/计划、周级 GC、取消/重试和恢复验证                           |
| 一阶段观察通过             | 新同点检查点，按下节显式二阶段审计、迁移和复核                                                         |
| 二阶段已完成               | 日常发布走[部署基线](../deployment.md)；不再删除历史快照、失败确认或已发布 migration                   |

第一阶段的已验证回退基线为 v0.50.8（15e79aa5），v0.50.6 缺少归档恢复修复，不是回退目标。使用实际镜像 digest 证明版本，不能靠可变 latest。

## 第一阶段的必要步骤

停止外部触发与 scheduler，收口活动任务，停止全部 App/Worker。在受控维护连接运行 `maintenance:audit-background-task-retirement --before`；退出 0 才继续，1 为业务/审计失败，2 为参数/环境错误。审计不修改状态、不清 lease、不确认失败。

保存数据库、三个媒体根、配置和镜像的[同点恢复集合](../backup-and-recovery.md)，使用第一阶段目标版本 generate/deploy，仅增加 `20261007100000_background_task_retirement_read_model` 的历史快照/索引，保留旧列与双写。运行 `--after` 验证快照与旧目标及中央媒体任务双写一致。

准备消费后启动第一阶段 Worker，核对 READY/capability，再开放 App/调度。验证归档继续/重试、完成媒体与质量保留、失败确认、失败收件删除后不可复活、媒体队列和计划入队时间。不能靠两枚 false 开关暗启动新 Worker。

一阶段回退仅限尚未删列且只读 after 审计通过：保留加法列/索引，恢复已验证 v0.50.8 的配套镜像和该版本配置（中央模式两枚开关为 true）。不执行反向 migration。

## 二阶段显式升级

1. 确认上述观察门禁通过，记录实际 App/Worker digest、migration 和服务清单。保存旧配置后才设置新版本。
2. 停止外部触发和实际存在的 scheduler，等待任务业务收口，停止 App/Worker；PostgreSQL 保持运行。
3. 创建**新的**同点恢复集合，完成隔离 dump 恢复及三个媒体根抽样。一阶段备份不能代替本次检查点。
4. 使用二阶段目标 App 镜像绕过 entrypoint 执行审计，成功后 deploy，再执行 after 审计。

以下从仓库根执行；NAS 实际路径/Compose 文件须先核对替换，不照抄历史实例目录。

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs --phase2-before

docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps --entrypoint prisma app \
  migrate deploy --schema=packages/pixishelf-db/prisma/schema.prisma

docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs --phase2-after
```

审计退出 0 且 `ready=true` 才继续，保存原始报告到受控备份目录。迁移在事务中再次阻断执行态任务和活跃资源 lease；只有 `availableAt` 空值按 `createdAt` 回填，其余异常不能靠清历史、猜状态或重建收件绕过。已有库缺二阶段 migration 时普通 App 启动失败是保护行为；全新空库可正常初始化。禁止 `db:push` 或手改 `_prisma_migrations`。

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d --no-deps worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d --no-deps app
```

Worker 启动即消费，任一门禁失败先保存日志并停止后续开放。成功后检查历史、失败确认、媒体队列、计划上次入队、低风险任务完整执行及两个 lane，再恢复原本运行的调度/外部触发。

## 二阶段恢复与证据

删列完成后，一阶段和 v0.50.8 镜像均不能直接连接新库。优先修复当前版本；必须回退则停写、保全现场、评估并确认检查点后的损失，在隔离验证后恢复到新空库及匹配的三个媒体根、配置和镜像。

归档实际镜像 ID/RepoDigests、before/after 报告、备份清单和业务验收。用户确认、开发 fixture、真实 NAS 操作和代理直接核查是不同证据级别，不能互相替代；测试数量和已部署结果不再追加到本操作手册。
