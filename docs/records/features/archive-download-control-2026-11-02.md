---
status: historical
scope: DOWNLOAD 重试和继续的轻量控制、准备意图和隔离数据库验证
last-verified: 2026-11-02
sources:
  - packages/pixishelf/services/archive/archive-download-control.ts
  - packages/pixishelf/services/archive/__tests__/archive-download-control-regression.postgres.test.ts
  - packages/pixishelf/services/archive/__tests__/archive-download-admission.postgres.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-preparation-regression.postgres.test.ts
---

# 归档下载控制简化验证

源码交付版本：`v0.55.16`，包含 2026-11-02 本轮实现及隔离验证证据；提交与 tag 以实际 Git 交付为准。App／Worker 镜像的构建、推送状态及 digest 以对应 CI 和镜像仓库结果为准，本记录不证明目标镜像已经可拉取。生产升级、迁移和下方操作模板均未执行。当前行为与部署回退门禁见[归档生命周期](../../features/archive-lifecycle.md#下载重试与继续)，本文只保存本轮证据。

## 问题与范围

生产批量重试的已取得样本为 14 项 105.735 秒、5 项 31.727 秒；App 日志确认五次 Prisma 交互事务默认 5000ms 超时，涉及 `archiveImportItem.updateMany`。旧入口逐项取得目录／发布／身份锁并同步重置图片，数据库任务触发器还使 DOWNLOAD 入队与 claim 取得创作者全局锁。本次按已批准方案分离入队控制与 Worker 准备，没有增加事务超时、队列或补偿机制。

仅 `scope:'DOWNLOAD'` 的批量 RETRY/RESUME 采用整组原子事务；单项归档、单图重试与后台任务入口复用该控制。无 scope 的调用、PUBLISH 和 LEGACY 保留原兼容行为。新字段 `pendingDownloadPreparation` 由配套 Worker 消费，payload 和 definition version 不变。

## 环境与恢复依据

使用一次性 PostgreSQL 15 Alpine 容器、独立端口和合成任务；从空库部署原有 136 个迁移，再应用 `20261102120000_archive_download_preparation`，另用非空旧数据核对 NULL 默认值和旧 guard 保留。测试未连接业务数据库、未操作收藏媒体或部署生产。

生产恢复集合尚未建立，本轮不执行生产迁移。后续发布需按[备份基线](../../operations/backup-and-recovery.md#发布前一致性检查点)记录数据库、媒体、配置和镜像的同点检查点；停止旧 Worker 并配套切换 App／Worker。回退前只核对当前绑定且仍可执行的未消费意图，不要求历史终态 execution 清零；不能安全消费时使用匹配检查点恢复，不手工删意图。

## 聚焦验证

- Worker 执行器单元测试 39 项通过；新增整项／单图准备、COMPLETED 检查点保留、汇总重算、一次消费后新失败不重置、再次显式准备，以及 source／cleanup 失败不消费。
- 归档单入口委派 7 项通过；保留 `{taskId}` 回执、后台旧 job 前置条件和展示画质限制。
- 页面筛选与批量控制组件测试 16 项通过；混合两组并发，下载响应先展示并刷新，失败后即使列表已移除原目标仍原样重放 taskIds、scope 和幂等键。
- 旧归档控制 PostgreSQL 套件原版对照为 44 项中 12 项失败；同一隔离环境使用原代码和原触发器，仅为共用已生成 Prisma Client 补可空新列，仍出现完全相同的 12 项失败。原因是旧 fixture 未保存现在要求的原来源证明。fixture 改为创建合成来源证明后 44 项全部通过，没有放宽生产 LEGACY／PUBLISH 来源校验。原始失败输出位于本机临时文件 `/private/tmp/pixishelf-baseline-result.log`，不作为长期发布归档。

独立 PostgreSQL 回归已覆盖创作者和发布锁持有时 DOWNLOAD retry/resume/claim、同目标并发只产生一个有效子 job、晚期事件写入故障整组回滚及同 key 重放；1、10、100 个下载目标均固定 22 条 SQL，提交不访问图片明细。新增 admission 套件覆盖业务无效逐项排除、已有活跃来源、本批同源稳定赢家、清理先赢 CAS 无孤儿 job，以及清理旧绑定快照不能推进新重试。完成头在事务结尾重新取得完成时刻；可控时钟的真实数据库断言验证 `completedAt` 不早于操作创建时刻，同时保留入队时的 `availableAt`。

## 最终检查与限制

本轮最终检查由独立回归 agent 统一执行；数据库套件串行使用同一个独立 PostgreSQL，文件和远端请求使用受控 fixture。

- 空库完整 deploy 137 个迁移、非空旧数据升级：通过；旧执行记录准备字段默认 NULL，其他任务和创作者合并的 guard 保留。
- 主应用 `pnpm lint`、`pnpm typecheck`：通过。`pnpm test` 为 491 个文件、3663 项通过；55 个文件、383 项按数据库条件未配置跳过，相关高风险 PostgreSQL 套件单独运行。首次沙箱运行中有 3 项因回环监听、2 项因 IPC 管道权限 EPERM 失败，提升权限后完整重跑通过，没有放宽断言。
- 主应用 `pnpm build`：最终提升权限重跑通过，编译 14.7 秒、生成 46/46 静态页，没有 warning/error；本机输出位于 `/private/tmp/pixishelf-main-build-final.log`。
- `pnpm --filter @pixishelf/worker... typecheck`、`test`、`build`：通过。无数据库环境的测试结果分别为 contracts 183 项、DB 193 项、runtime 35 项、executors 1012 项、Worker 121 项通过；各包数据库条件跳过分别为 0／279／106／563／11 项，不将跳过计为通过。
- 隔离 PostgreSQL：queue 86 项、download lane 57 项、download recovery 5 项、准备意图真实事务恢复 1 项、admission 加独立控制回归 12 项、artist merge 13 项、旧归档控制 44 项、cleanup recovery 2 项全部通过。准备意图回归使用真实执行围栏，覆盖提交前抛错回滚意图／图片，以及成功消费后重启保留本轮新失败。
- `pnpm docs:check` 检查 374 个 Markdown 通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 检查 34 个图源、23 个内嵌 Mermaid 块通过。本次没有修改图源。首次沙箱 Chrome 启动受限，提升权限后检查通过。
- 主应用路径大小写检查和 `git diff --check`：通过。

Worker 构建输出 3 条 esbuild 警告：CJS 格式中的 `import.meta` 不可用并被置空；构建成功，无其他 warning。本轮没有核实原版是否已有这些警告，不将其登记为已证明的既有问题。

Worker 链的实际命令如下；原生准备仅生成隔离验证所需构建产物，没有提交生成文件：

```bash
pnpm --filter @pixishelf/db db:validate
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/worker... typecheck
node packages/pixishelf-worker/scripts/build-dedup-native.mjs
pnpm --filter @pixishelf/worker... test
pnpm --filter @pixishelf/worker... build
```

下列 PostgreSQL 命令运行前，将 `DATABASE_URL`、`PIXISHELF_TEST_DATABASE_URL` 和 `QUEUE_KERNEL_TEST_DATABASE_URL` 显式设为本轮独立测试库；凭据不写入记录。Worker 全链无数据库条件测试未设置这些测试连接。

```bash
pnpm --filter @pixishelf/next exec vitest run --no-file-parallelism services/archive/__tests__/archive-download-admission.postgres.test.ts services/archive/__tests__/archive-download-control-regression.postgres.test.ts
pnpm --filter @pixishelf/next exec vitest run --no-file-parallelism services/archive/__tests__/archive-task-service.postgres.test.ts
pnpm --filter @pixishelf/next exec vitest run --no-file-parallelism services/archive/__tests__/archive-cleanup-recovery.postgres.test.ts
pnpm --filter @pixishelf/db exec vitest run src/__tests__/artist-merge.postgres.test.ts
pnpm --filter @pixishelf/job-runtime exec vitest run --no-file-parallelism src/__tests__/queue-repository.postgres.test.ts
pnpm --filter @pixishelf/job-executors exec vitest run --no-file-parallelism src/archive/__tests__/download-lane.postgres.test.ts src/archive/__tests__/download-lane-recovery.postgres.test.ts src/archive/__tests__/download-preparation-regression.postgres.test.ts
```

独立测试容器及匿名卷已清理。

本轮尚未做真实浏览器人工验收、NAS 负载对比、外站下载或正式环境发布；本机固定查询次数和锁隔离不证明生产端到端耗时。线上性能与配套升级后的任务结果须由后续发布记录确认。

## v0.55.16 生产升级操作模板（未执行）

适用于现有 NAS 实例，已知容器名为 `pixivshelf-app-1`、`pixivshelf-worker-1`、`pixivshelf-scheduler-1`，数据库容器为 `pixishelf-db`。此前只读核对的数据库名为 `pixishelf`；执行时仍以实际容器环境与目标连接为准。本节是待管理员核对后执行的模板，不是生产完成记录。

以下步骤沿用[标准发布](../../operations/deployment.md#标准发布)与[同点备份](../../operations/backup-and-recovery.md#发布前一致性检查点)。保留现有 Compose project、配置文件顺序、环境、端口、网络、资源限制及所有挂载；不换用仓库模板另起项目，不启动或重建已在线的 PostgreSQL／ImgProxy，不删除容器卷，不使用 `db:push`。生产 App 镜像已包含 Prisma CLI 和构建时生成的客户端，无需在生产再次 generate。

### 1. 查明实际配置，固定配套镜像

只选择必要字段，避免将完整 inspect／Compose 展开结果中的环境秘密写进日志：

```bash
sudo docker inspect --format '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}} service={{index .Config.Labels "com.docker.compose.service"}} working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}} config_files={{index .Config.Labels "com.docker.compose.project.config_files"}} environment_file={{index .Config.Labels "com.docker.compose.project.environment_file"}} image_ref={{.Config.Image}} image_id={{.Image}} status={{.State.Status}}' \
  pixivshelf-app-1 pixivshelf-worker-1 pixivshelf-scheduler-1 pixishelf-db
sudo docker inspect --format '{{.Name}}{{range .Mounts}} mount={{.Source}} -> {{.Destination}} rw={{.RW}}{{end}} cpu={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}} memory_swap={{.HostConfig.MemorySwap}}' \
  pixivshelf-app-1 pixivshelf-worker-1 pixishelf-db
sudo docker exec pixishelf-db sh -c 'printf "database=%s user=%s\n" "$POSTGRES_DB" "$POSTGRES_USER"'
```

核对 App／Worker／scheduler 的 project 一致、service 分别对应 `app`／`worker`／`scheduler`，记录 scheduler 原运行状态和旧镜像 ID／digest。按照 labels 找到真实工作目录和全部 Compose 文件；环境文件以原启动配置为准，label 缺失时查 NAS 保存的实际项目配置，不猜路径或数据库连接。数据库容器若由另一个既有项目管理，保持其原归属。

下面使用 Bash 数组保留参数边界。所有占位符替换为已核实的绝对路径；原实例有多个 Compose 文件或多个 `--env-file` 时，按原顺序逐个追加，不省略已有 override。

```bash
cd '<inspect 查到的实际 Compose 工作目录>'
PXS_PROJECT='<inspect 查到的原 project>'
PXS_COMPOSE=(sudo docker compose --project-name "$PXS_PROJECT")
PXS_COMPOSE+=(--env-file '<原实例实际使用的环境文件绝对路径>')
PXS_COMPOSE+=(-f '<config_files 中第一个实际文件绝对路径>')
# 多文件实例：在这里继续按原顺序追加 PXS_COMPOSE+=(-f '...')。
"${PXS_COMPOSE[@]}" config --services
"${PXS_COMPOSE[@]}" ps -a
```

在原工作目录保存仅固定配套镜像的发布 override，并将它置于原配置之后；现有配置和媒体路径不重写。后续运维须保留本次完整配置文件列表，不回到遗漏 override 的启动命令。

```bash
PXS_RELEASE_FILE="$PWD/compose.v0.55.16.images.yml"
cat > "$PXS_RELEASE_FILE" <<'YAML'
services:
  app:
    image: dockernamehu/pixishelf:v0.55.16
  worker:
    image: dockernamehu/pixishelf-worker:v0.55.16
    environment:
      WORKER_SERVICE_VERSION: v0.55.16
YAML
PXS_COMPOSE+=(-f "$PXS_RELEASE_FILE")
"${PXS_COMPOSE[@]}" config --images
sudo docker pull dockernamehu/pixishelf:v0.55.16
sudo docker pull dockernamehu/pixishelf-worker:v0.55.16
sudo docker image inspect --format '{{.Id}} {{json .RepoDigests}}' \
  dockernamehu/pixishelf:v0.55.16 dockernamehu/pixishelf-worker:v0.55.16
```

先确认两镜像均成功拉取、与目标 CI 发布结果匹配，再进入停写窗口；任一镜像不存在或版本不符时停止，不用 `latest` 替代。记录目标 digest 和本次实际配置文件列表。

### 2. 停止触发，收口任务并建立同点备份

先停止 scheduler，并停用 Webhook 调用方、NAS 脚本等外部触发；App／Worker 此时仍可用于通过业务入口等待、暂停或取消收口活动任务。不能直接改数据库终态，也不能只等待 lease 超时。完成收口后停止 App 和旧 Worker，确认旧消费者进程和全部外部文件写入者已经退出：

```bash
"${PXS_COMPOSE[@]}" stop scheduler
# 在业务入口完成活动任务收口，并停止外部触发／文件写入者后再执行下一行。
"${PXS_COMPOSE[@]}" stop app worker
sudo docker inspect --format '{{.Name}} running={{.State.Running}} status={{.State.Status}}' \
  pixivshelf-app-1 pixivshelf-worker-1 pixivshelf-scheduler-1
```

确认静默后，按备份基线保存数据库（含 `_prisma_migrations`）、原媒体（含隐藏 staging）、派生媒体、Pixiv data、配置和旧／新镜像的同点恢复集合。数据库身份通过容器环境引用，不将密码、完整 URL、环境文件或 dump 正文贴入记录。下面只生成受限备份文件；目录必须预先在仓库外建立并核对：

```bash
PXS_BACKUP_DIR='<本次受限备份集合的绝对目录>'
umask 077
sudo docker exec pixishelf-db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$PXS_BACKUP_DIR/pixishelf.dump"
sha256sum "$PXS_BACKUP_DIR/pixishelf.dump" > "$PXS_BACKUP_DIR/pixishelf.dump.sha256"
sudo docker exec -i pixishelf-db pg_restore --list < "$PXS_BACKUP_DIR/pixishelf.dump"
```

媒体快照使用实际 NAS 存储能力和已核对的挂载，不把数据库 dump 时间接近视为同点证明。清单保存快照 ID、dump 校验值、真实配置文件集合和镜像 digest；完成可读及隔离恢复验证后才进入迁移。`pg_restore --list` 只证明备份可读取，不代替恢复演练。

### 3. 用目标 App 镜像检查 guard，显式迁移

`--entrypoint` 会绕过正常 App 启动检查，因此先显式执行 [entrypoint](../../../build/entrypoint.sh) 中现有的两项 `guard-startup`。两者都退出 0 才继续；被历史升级门禁阻断时按[专项升级手册](../../operations/runbooks/schema-and-capability-upgrades.md)处理，不跳过、不盲目标记迁移完成：

```bash
"${PXS_COMPOSE[@]}" run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/retire-legacy-fields.mjs guard-startup
"${PXS_COMPOSE[@]}" run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs guard-startup
```

随后先查看目标镜像对应的 migration 状态。升级前 `status` 因本次待执行 migration 返回非零属于需要人工核对的预期；连接失败、失败记录、无法解释的历史差异或其他未知 pending 都必须停止调查，不能直接继续 deploy：

```bash
"${PXS_COMPOSE[@]}" run --rm --no-deps --entrypoint prisma app \
  migrate status --schema=packages/pixishelf-db/prisma/schema.prisma
```

确认实际待执行项为已评审的 `20261102120000_archive_download_preparation`，且其他升级门禁与备份均满足，再执行：

```bash
"${PXS_COMPOSE[@]}" run --rm --no-deps --entrypoint prisma app \
  migrate deploy --schema=packages/pixishelf-db/prisma/schema.prisma
"${PXS_COMPOSE[@]}" run --rm --no-deps --entrypoint prisma app \
  migrate status --schema=packages/pixishelf-db/prisma/schema.prisma
```

迁移后 status 必须成功并无 pending／failed migration。此阶段只运行目标 App 镜像的一次性命令，尚未开放 Web；数据库与 ImgProxy 保持原在线容器和数据卷。

### 4. 先验证新版 Worker，再开放 App 和原有调度

旧 Worker 不理解准备意图，禁止与新版混跑。确认旧进程为零后，启动唯一新版 Worker；启动即可能消费任务，须已完成备份和迁移：

```bash
"${PXS_COMPOSE[@]}" up -d --no-deps worker
"${PXS_COMPOSE[@]}" exec -T worker node dist/healthcheck.cjs --mode=ready
"${PXS_COMPOSE[@]}" exec -T worker node dist/capability-audit.cjs
"${PXS_COMPOSE[@]}" logs --tail=200 worker
```

READY 与目标镜像完整 type／version／lane capability inventory 均通过才启动 App；任一步失败保持 App／scheduler 关闭，不用 `/livez` 或固定任务数量代替 capability：

```bash
"${PXS_COMPOSE[@]}" up -d --no-deps app
"${PXS_COMPOSE[@]}" logs --tail=200 app
```

核对 App／Worker 实际镜像 ID 和挂载仍与本次记录一致。先完成 HTTPS 登录、媒体和三个 lane 抽样；选择受控归档样本验证重试／继续响应显示“已入队”，新执行保留父任务、画质和默认标签，Worker 启动后消费当前 execution 的准备意图，保留 COMPLETED 检查点。批量混合选择应分组呈现，失败组通过原请求确认重放；页面已入队不等于下载完成。记录受控任务／operation ID、迁移前后状态及实际观察耗时，不能用本机 22 条 SQL 替代 NAS 性能验收。

通过抽样后，仅当 scheduler 升级前原本启用时恢复它，最后恢复外部触发：

```bash
"${PXS_COMPOSE[@]}" up -d --no-deps scheduler
```

继续按部署基线观察积压、错误、租约、媒体和主机资源。生产实际执行时间、digest、备份集合和通过／失败结果另存运维记录，不将本模板改写为已执行证据。

### 回退停止条件

先停止新提交、scheduler 和外部触发，参照[准备意图回退门禁](../../features/archive-lifecycle.md#下载控制准备意图升级与回退)，由新版 Worker 消费当前绑定且仍可执行的准备意图，再停新版 Worker 并评估旧版本兼容性。历史 FAILED／CANCELLED execution 留有意图不要求清零；不能手工清空意图，也不能只按 payload/version 未变就启动旧 Worker。无法安全消费或存在其他 schema／媒体不兼容时，保持停写并按同点数据库、媒体、配置和镜像检查点恢复，不删卷、不直接回滚 schema。
