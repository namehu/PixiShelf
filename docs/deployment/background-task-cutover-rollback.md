---
status: historical
scope: 2026-08-18 旧消费者兼容期的应用级回滚和数据库/媒体一致性恢复
last-verified: 2026-08-18
current-source: ../operations/backup-and-recovery.md
---

# PixiShelf 后台任务统一切换回滚手册

> **历史文档，不得用于当前回滚。** 当前双 lane migration 已替换旧全局执行索引，旧
> `archive-worker` 也已退出 workspace、镜像和 Compose。当前服务隔离与完整恢复必须使用
> [部署基线](../operations/deployment.md)和[备份与恢复](../operations/backup-and-recovery.md)：应用级回滚只允许
> 使用兼容双 lane schema 的 App/Worker；启动旧消费者必须恢复完整的切换前数据库、原媒体、派生媒体、
> 配置和镜像检查点。

> 历史适用发布：2026-08-18 后台任务阶段 1–7 生产切换。
> 核心原则：先停写和保全现场，再判断回滚层级；数据库和媒体必须恢复到同一时间点

> 后续架构说明：当前 Compose 已移除 Thumbor。回滚到仍依赖 Thumbor 兼容截帧的旧应用镜像时，必须同时
> 恢复该版本归档的 Compose 和 Traefik `/_video` 路由；不得把旧应用镜像与当前 Compose 混用。

## 1. 回滚红线

1. 不允许 `archive-worker` 与 `WORKER_DISPATCH_ENABLED=true` 的通用 `worker` 同时运行。
2. 不允许只切换一枚 Dispatcher 开关。
3. 不允许在仍有任务写文件或持有有效租约时直接恢复数据库/媒体快照。
4. 不允许只恢复数据库而不恢复对应媒体，或只恢复媒体而不恢复对应数据库。
5. 不通过 SQL 把异常任务直接改为 `COMPLETED`。
6. 不执行 destructive reverse migration；本期 schema 是 additive，应用回滚优先保留新 schema。
7. 回滚前先备份事故现场，包括数据库、任务/事件、容器日志和本次新写入文件。

## 2. 回滚分级

| 级别             | 场景                                              | 操作                                                                                 |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| R1：服务重启     | 单容器异常、无数据不一致                          | 保持新版本和 `true/true`，重建 App/Worker。                                          |
| R2：应用回滚     | 新任务尚未产生不可兼容写入                        | 切回保存的旧 App/Archive Worker 镜像，开关改为 `false/false`。保留 additive schema。 |
| R3：受控数据恢复 | 新 Worker 已产生文件/数据库写入，但影响范围可枚举 | 导出 jobId、事件和文件清单，停止新系统，按领域恢复或从一致性快照恢复。               |
| R4：完整灾难恢复 | 数据库 migration/数据或媒体整体不一致             | 恢复同一时间点的 PostgreSQL dump 与 Synology 媒体快照，再启动旧系统。                |

## 3. 所有回滚共用的第一步

`cd` 无法加 `sudo`；其余命令均使用 `sudo`。

```bash
cd <生产 Compose 目录>
sudo docker compose --profile scheduled stop scheduler
sudo docker compose stop app worker archive-worker
sudo docker compose ps -a
```

保存现场：

```bash
sudo mkdir -p <事故归档目录>
sudo docker compose logs --no-color app worker archive-worker \
  | sudo tee <事故归档目录>/containers.log >/dev/null

sudo docker compose exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | sudo tee <事故归档目录>/pixishelf-incident.dump >/dev/null

sudo sha256sum <事故归档目录>/pixishelf-incident.dump
sudo cp docker-compose.yml <事故归档目录>/docker-compose.yml
sudo cp .env <事故归档目录>/env
sudo chmod 600 <事故归档目录>/env
```

如果数据库或 PostgreSQL 容器本身不可用，不要继续执行数据库命令；先保存数据卷状态并进入 R4。

## 4. R1：保持新版本，仅重建服务

适用于容器偶发退出、临时网络故障或无数据不一致的健康检查失败。

确认 `.env` 仍为：

```dotenv
CENTRAL_DISPATCHER_CUTOVER_ENABLED="true"
WORKER_DISPATCH_ENABLED="true"
```

确认旧 Worker 没有运行，然后重建：

```bash
sudo docker compose --profile legacy-rollback rm -f archive-worker
sudo docker compose up -d --no-deps --force-recreate app worker
sudo docker compose logs --tail=300 app worker
sudo docker compose exec -T worker node dist/healthcheck.cjs --mode=ready
sudo docker compose exec -T worker node dist/capability-audit.cjs
```

验证一个低风险任务后，再恢复 scheduler：

```bash
sudo docker compose --profile scheduled up -d scheduler
```

## 5. R2：切回旧 App 与 archive-worker

只在确认切换后没有需要新 Worker 才能解释的活动任务或未完成文件写入时使用。

### 5.1 确认本地回滚镜像存在

```bash
sudo docker image inspect docker.io/dockernamehu/pixishelf:pre-central-cutover
sudo docker image inspect docker.io/dockernamehu/pixishelf-archive-worker:pre-central-cutover
```

如果本地标签丢失，从上线前导出的镜像包恢复：

```bash
sudo gzip -dc <备份目录>/pre-central-cutover-images.tar.gz \
  | sudo docker image load
```

### 5.2 切换开关和镜像

编辑 `.env`：

```dotenv
IMAGE_TAG="pre-central-cutover"
CENTRAL_DISPATCHER_CUTOVER_ENABLED="false"
WORKER_DISPATCH_ENABLED="false"
```

```bash
sudo vi .env
sudo docker compose --env-file .env -f docker-compose.yml config --quiet
sudo docker compose stop app worker archive-worker scheduler
sudo docker compose rm -f worker
sudo docker compose up -d --no-deps --force-recreate app
sudo docker compose --profile legacy-rollback up -d archive-worker
sudo docker compose ps
sudo docker compose logs --tail=300 app archive-worker
```

保持 scheduler 关闭，先验证登录、读取媒体和一个旧系统可安全执行的小任务。旧系统验证通过后，再根据当时的数据库计划状态决定是否恢复 scheduler。

本期 migration 只做 additive 变更，R2 默认保留新 schema，不进行反向 migration。

## 6. R3：新 Worker 已产生写入时的受控回滚

先不要启动旧 `archive-worker`。应完成以下取证：

1. 列出切换时间之后创建的 `system_jobs`。
2. 导出相关 `system_job_events`、领域记录、任务 payload/result 和错误。
3. 根据 jobId 收集归档 staging、迁移/批量替换检查点、代表帧、章节、封面、优化视频和 GC 文件清单。
4. 确认哪些任务已完成领域发布，哪些仍停留在 staging/恢复状态。
5. 对已经成功发布且旧 App 可以只读兼容的数据，优先保留 additive schema 和数据，不做全库恢复。
6. 对无法证明一致的数据，升级为 R4，从同一时间点恢复数据库和媒体。

只读导出示例：

```bash
sudo docker compose exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\''
    SELECT id, type, status, "createdAt", "startedAt", "finishedAt", "targetImageId", "targetPath"
    FROM system_jobs
    WHERE "createdAt" >= TIMESTAMP WITH TIME ZONE '\'''\''<切换时间>'\'''\''
    ORDER BY "createdAt", id;
  '\''' \
  | sudo tee <事故归档目录>/jobs-after-cutover.txt >/dev/null
```

不要仅凭任务终态推断文件已经一致；迁移、批量替换、归档、视频优化和 GC 都必须同时核对领域记录与实际文件。

## 7. R4：数据库与媒体一致性恢复

### 7.1 前置条件

- 已停止 App、两个 Worker、scheduler 和所有外部写入脚本。
- 已保存事故现场 dump 和日志。
- 已验证升级前 PostgreSQL dump 的 SHA-256。
- 已找到与该 dump 同一停写时间点的原媒体和派生媒体快照。
- 已确认恢复会覆盖上线后的新数据，并由上线负责人批准。

### 7.2 先验证备份，不直接覆盖生产库

建议先在独立 PostgreSQL 实例或临时验证数据库恢复并检查：

```bash
sudo docker compose exec -T postgres sh -c \
  'createdb -U "$POSTGRES_USER" pixishelf_restore_verify'

sudo cat <备份目录>/pixishelf-before-cutover.dump \
  | sudo docker compose exec -T postgres sh -c \
    'exec pg_restore -v -U "$POSTGRES_USER" -d pixishelf_restore_verify --no-owner --no-privileges'

sudo docker compose exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d pixishelf_restore_verify -c '\''SELECT count(*) FROM "_prisma_migrations";'\'''
```

验证完成后删除临时验证库：

```bash
sudo docker compose exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" pixishelf_restore_verify'
```

### 7.3 正式恢复

正式恢复属于破坏性操作。本手册不把某一种 NAS 快照实现写死；应先通过 Synology 的快照/备份工具，把原媒体和派生媒体恢复到与数据库 dump 相同的时间点，然后在无写入者的条件下恢复数据库。

数据库恢复可以使用新建空库后 `pg_restore` 的方式，禁止对仍有应用连接的生产库直接执行 `--clean`。数据库名、所有者、扩展和权限应与原生产配置一致。

恢复后先保持两枚开关 `false/false`，使用 `pre-central-cutover` App 和 `archive-worker` 启动，scheduler 继续关闭：

```bash
sudo docker compose up -d postgres
sudo docker compose up -d --no-deps --force-recreate app
sudo docker compose --profile legacy-rollback up -d archive-worker
sudo docker compose ps
sudo docker compose logs --tail=300 app archive-worker postgres
```

## 8. 回滚后的验收

- 登录、鉴权和管理员账户正常。
- 原图、视频、封面、章节和代表帧引用与文件一致。
- 数据库 migration 历史符合恢复目标。
- 不存在两个 Worker 同时消费。
- 不存在非终态残留任务、未恢复的批量替换或归档 staging。
- Traefik、imgproxy 路由正常；如回滚版本仍依赖 Thumbor，归档的 `/_video` 路由也必须正常。
- scheduler 保持关闭，直到人工确认计划启用状态。
- 事故原因、影响 jobId、恢复时间点、镜像 ID/digest 和数据损失范围均已记录。

## 9. 回滚结束后的处理

1. 不立即再次上线同一个 `latest`。
2. 修复后发布新的不可混淆版本，并记录实际 digest。
3. 在生产数据副本上复现 migration、Worker preflight 和失败任务恢复。
4. 重新执行完整部署门禁和纯 Docker cutover audit。
5. 阶段 8 兼容代码清理自动延期，重新累计稳定观察周期。
