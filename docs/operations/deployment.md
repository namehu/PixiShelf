---
status: current
scope: PixiShelf v0.36.3 的本地运行、生产 Compose 拓扑、升级顺序、验证与回滚入口
last-verified: 2026-08-19
sources:
  - build/docker-compose.dev.yml
  - build/docker-compose.deploy.yml
  - build/.env.example
  - build/Dockerfile
  - build/worker.Dockerfile
  - build/entrypoint.sh
  - scripts/update-production.sh
---

# PixiShelf 部署基线

本文是当前部署操作入口。Dockerfile、Compose 和 `.env.example` 决定精确服务与配置；一次性切换记录只用于复用审查、备份和回滚门禁。

## 支持范围

- 本地开发：PostgreSQL、ImgProxy、通用 Worker 在 Docker 中运行，Next.js 在宿主机运行；
- 生产部署：单机 Docker Compose，原媒体和派生媒体使用宿主机目录挂载；
- 数据库：PostgreSQL 15；
- 应用与 Worker：Node.js 20 镜像；
- 主应用端口：5430；ImgProxy：5431；PostgreSQL：5432；Worker 健康端口仅在容器网络内使用 3011。

本文不承诺 Kubernetes、多副本 App、并行 Worker 或多租户部署。

## 当前服务拓扑

| 服务             | 数据权限                   | 当前职责                                                | 生产稳态             |
| ---------------- | -------------------------- | ------------------------------------------------------- | -------------------- |
| `postgres`       | 数据库读写                 | 领域数据、认证、队列、租约和 migration 历史             | 必需                 |
| `app`            | 数据库读写；原媒体默认只读 | Next.js Web/API、认证、任务控制面；启动时部署 migration | 必需                 |
| `worker`         | 数据库和媒体读写           | Central Dispatcher 与全部已迁移 Executor                | 必需，固定一个消费者 |
| `scheduler`      | 无数据库权限               | 使用内部 Token 调用 App 的 scheduler tick               | 按需启用             |
| `imgproxy`       | 原媒体和派生媒体只读       | 图片缩放、格式处理和缓存                                | 必需                 |
| `archive-worker` | 数据库和媒体读写           | 阶段 8 前的旧消费者兼容和应用级回滚                     | 生产稳态必须停止     |

`build/docker-compose.deploy.yml` 仍声明了没有 profile 的 `archive-worker`。因此在阶段 8 完成前，生产环境不能用不带服务名的 `docker compose up -d` 作为标准发布命令；它可能重新启动旧消费者。必须显式指定服务并检查旧消费者处于停止状态。

## 环境文件边界

| 场景           | 文件                            | 数据库地址                             |
| -------------- | ------------------------------- | -------------------------------------- |
| 宿主机 Next.js | `packages/pixishelf/.env.local` | `127.0.0.1:5432` 或 `localhost:5432`   |
| Docker Compose | `build/.env`                    | Compose 在容器内覆盖为 `postgres:5432` |

必须核对：

- `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 与 `DATABASE_URL` 一致；
- `PIXISHELF_DATA_PATH` 指向真实原媒体目录；
- `DERIVED_MEDIA_HOST_PATH` 使用持久化绝对路径；
- `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`BETTER_AUTH_TRUSTED_ORIGINS` 符合实际入口；
- `INTERNAL_JOB_TOKEN` 与 `SCAN_WEBHOOK_TOKEN` 使用彼此独立的强随机值；
- `INIT_ADMIN_USERNAME`/`INIT_ADMIN_PASSWORD` 当前不参与自动初始化，遗留 `JWT_SECRET` 也不负责当前浏览器会话；
- `CENTRAL_DISPATCHER_CUTOVER_ENABLED` 与 `WORKER_DISPATCH_ENABLED` 始终成对切换；
- 生产反向代理使用 HTTPS，清除外部 `x-user-session`/`x-pathname`，并将 `NEXT_PUBLIC_IMGPROXY_URL` 限制在受信网络或等效保护路径。

不要提交 `build/.env`、`.env.local`、数据库备份、访问令牌或生产路径。

## 本地开发

标准流程维护在根 [README](../../README.md#本地开发)。固定顺序是：

1. 复制并配置两份环境文件；
2. 只启动 PostgreSQL 和 ImgProxy；
3. 生成 Prisma Client，并用 `db:deploy` 部署完整 migration；
4. 构建并启动通用 Worker，验证 READY 和 capability；
5. 在宿主机启动 Next.js；
6. 需要自动调度时再启用 `scheduled` profile。

普通启动和升级禁止使用 `db:push`。全新数据库也使用完整 migration 链，以便 Worker 预检能够确认 `_prisma_migrations`。

## 生产发布前门禁

每次升级都必须先完成：

- 记录当前 App、Worker 和兼容镜像的 tag、image ID 或 digest；
- 确认只有预期消费者在运行，不存在无法解释的 RUNNING/PAUSING/CANCELLING 任务；
- 停止 scheduler，阻止新的计划任务物化；
- 创建同一时间点的 PostgreSQL 备份、原媒体快照、派生媒体快照和环境配置备份；
- 在隔离位置确认数据库备份可读取，媒体快照路径可访问；
- 检查磁盘余量、目录权限和 FFmpeg/FFprobe 可用性；
- 阅读目标版本 migration，确认是否存在不可逆数据变更；
- 对后台任务架构切换相关升级运行只读 cutover audit。

备份位置、校验值和镜像 digest 必须记录在本次发布记录中。“命令成功”不能代替恢复验证。
完整备份集合、停写检查点和隔离恢复演练见[备份与恢复基线](./backup-and-recovery.md)。

## 一键生产升级

日常生产升级优先使用仓库内的一键脚本。它把 App 与通用 Worker 作为同一个发布单元：先检查执行中的后台任务，拉取两份镜像，停止写入者，先启动 App 完成 `prisma migrate deploy`，再启动 Worker，并执行 READY 与 capability 门禁。脚本只显式编排 `app`、`worker` 和原本已在运行的可选 `scheduler`。

从部署目录执行：

```bash
sudo bash ./scripts/update-production.sh
```

脚本优先使用当前目录的 `docker-compose.yml` / `compose.yml`；在仓库根目录执行且没有默认 Compose 文件时，会自动使用 `build/docker-compose.deploy.yml` 和同目录 `.env`。也可以显式指定：

```bash
sudo bash ./scripts/update-production.sh \
  --compose-file build/docker-compose.deploy.yml \
  --env-file build/.env
```

默认行为和参数：

- 查询 `system_jobs`，发现 `RUNNING`、`PAUSING` 或 `CANCELLING` 时拒绝升级；`--force` 明确允许通过 Worker drain 路径中断这些任务；
- 默认同时拉取 `app` 和 `worker`；`--no-pull` 仅用宿主机已有镜像强制重建；
- 记录 scheduler 原始状态，只在升级前本来就在运行时恢复它；
- 任一 migration、健康检查、READY 或 capability 门禁失败时保持 scheduler 停止，不自动假装回滚成功；
- `--wait` 只能证明容器 healthcheck 通过，脚本还会额外执行 Worker READY 和 capability audit。

发布前一致性备份仍是独立门禁，不能由“镜像更新成功”替代。可以把实例自己的 PostgreSQL dump、NAS 原媒体快照、派生媒体快照和清单校验封装成可执行文件，再作为停写窗口内的 Hook：

```bash
sudo PIXISHELF_PRE_UPDATE_HOOK=/absolute/path/pixishelf-backup-checkpoint.sh \
  bash ./scripts/update-production.sh
```

未配置 Hook 时脚本会明确警告，但不会伪造备份证据。完整备份集合和验证要求仍以[备份与恢复基线](./backup-and-recovery.md)为准。

## 标准生产升级（手动流程）

以下命令都从仓库根目录执行，并显式指定环境文件和 Compose 文件：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop worker archive-worker app
```

停止写入者并完成一致性备份后，先把两枚开关设为暗启动状态：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED=false
WORKER_DISPATCH_ENABLED=false
```

拉取并启动明确的服务集合：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml pull postgres imgproxy app worker scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d postgres imgproxy
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d app
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d worker
```

App 的 entrypoint 会在启动 Next.js 前执行 `prisma migrate deploy`。migration 失败时立即停止，不得使用 `db:push`、手工删列或盲目标记 migration 完成。

暗启动验证：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file build/.env -f build/docker-compose.deploy.yml logs --tail=200 app worker
```

同时验证登录、画廊查询、原图片、静态视频封面、封面缺失占位和原视频播放。当前版本不再提供 Thumbor 或 `/_video` 请求时截帧入口。

确认无阻断后，把两枚开关同时改为 `true`，重建 App 与 Worker，并明确保持旧消费者停止：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop archive-worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d --force-recreate app worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d scheduler
```

最终 `ps` 和管理页面必须同时证明：

- App、PostgreSQL、ImgProxy 正常；
- 只有一个当前 Worker 为 READY；
- `archive-worker` 没有运行；
- scheduler 的启用状态符合预期；
- 没有异常积压、重复 claim、媒体 404 或 migration 漂移。

## 发布后观察

- 立即：登录、核心查询、任务创建/控制、Worker READY、媒体读写；
- 24 小时：错误日志、任务积压、租约、派生媒体失败和磁盘增长；
- 72 小时：失败/重试趋势、长任务耗时和日志轮转；
- 至少一个完整的上海时区 `00:00–08:00` 窗口：计划物化、deadline 和 `SKIPPED` 行为；
- 7–14 天：确认只有一个通用 Worker 消费，再评估阶段 8 兼容代码清理。

当前详细观察清单见[后台任务上线后续](../deployment/background-task-follow-up.md)。

## 故障与回滚入口

出现重复消费、任务异常或 Worker 不稳定时，先执行可逆隔离：

1. 停止 scheduler；
2. 把两枚 Dispatcher 开关改回 `false`；
3. 重建 App/Worker，停止新的任务创建和 claim；
4. 保存 App、Worker、PostgreSQL 日志和任务状态；
5. 不在存在活动任务时强制回滚 Schema。

仅重建新版本服务、切回旧 App/兼容 Worker、以及恢复数据库与媒体属于不同回滚等级。阶段 8 完成前使用[后台任务回滚手册](../deployment/background-task-cutover-rollback.md)。

恢复时必须使用同一时间点的数据库和媒体快照，不能只恢复其中一侧。任何删除数据库卷、覆盖媒体目录或回滚 migration 的操作都必须单独确认目标与备份，不属于日常故障排查步骤。

## 当前过渡项

- `archive-worker` 仍在生产 Compose 中且没有 profile；阶段 8 清理前必须依靠显式服务集合和运行检查避免双消费者；
- 两枚 Dispatcher 开关仍保留，生产稳态为 `true/true`，暗启动和故障隔离为 `false/false`；
- App 镜像负责 migration，Worker 镜像只做 Schema 预检；
- 旧 Thumbor 容器和外部 `/_video` 路由应在新静态封面链路验证后移除；旧版本回滚若依赖它们，必须恢复对应版本的完整 Compose 和路由配置。

相关材料：

- [Build 与部署资产](../../build/README.md)
- [当前架构](../architecture/current-architecture.md)
- [权限与接口边界](../security/access-control.md)
- [备份与恢复基线](./backup-and-recovery.md)
- [阶段 1–7 切换记录](../deployment/background-task-cutover-deployment.md)
- [兼容回滚手册](../deployment/background-task-cutover-rollback.md)
- [上线后待办](../deployment/background-task-follow-up.md)
