---
status: draft
scope: 从 v0.50.8 到后台任务退役第一阶段的发布与回退，以及第二阶段门禁
last-verified: 2026-10-07
---

# 后台任务退役发布手册

本手册针对单实例。代码基线 v0.50.8（15e79aa5）不证明生产已经升级；发布前登记实际 App/Worker tag、digest、migration status。
生产若仍为 v0.50.6，先独立升级到包含归档恢复修复的 v0.50.8，完成验证后再退役。不得回退到已知缺少修复的 v0.50.6。

## 第一阶段发布

1. 停止外部触发和 scheduler，完成或安全暂停正在执行的任务，停止 App 与 Worker。登记全部写入者已停止；数据库检查不能替代这一步。
2. 在配置了明确 DATABASE_URL 的受控维护环境运行：

   ```bash
   pnpm --filter @pixishelf/db maintenance:audit-background-task-retirement --before
   ```

   退出 0 才继续。1 为业务阻断或审计失败，2 为参数/环境缺失。命令只读，不清理租约、不修改状态、不确认失败。
   执行态、活跃资源租约、非终态 v0 历史必须先处置；普通中央等待/暂停/重试任务允许保留。

3. 按[备份基线](../operations/backup-and-recovery.md)建立数据库、三个媒体目录、配置和镜像的同点恢复清单，保存 SHA-256、快照标识和恢复验证结果。
4. 在停止消费者的状态运行 generate/deploy，不使用 db:push。本次新增 `20261007100000_background_task_retirement_read_model`，只增加历史快照和索引，保留旧列与双写。
5. 运行 `maintenance:audit-background-task-retirement --after`，确认历史快照与旧目标完全一致、中央媒体任务双写无偏差。失败则保持停写并调查，不能用清空历史消除阻断。
6. 确认准备恢复消费后启动目标 Worker；它立即可能执行待处理任务。检查 READY、两个 lane、capability 和日志，再开放 App 与 scheduler。
7. 验证归档继续/重试、原质量与完成项保留、失败忽略状态、收件删除后不能复活、媒体队列和计划入队时间。

首次启动新 Worker 前，不能靠旧两枚 false 开关创建“在线但不消费”的窗口。镜像/配置版本必须配套。

## NAS 上照着执行

实际部署目录是 `/vol1/1001/docker-compose/pixivShelf`，配置文件为同目录 `.env` 和 `docker-compose.yml`，备份放在已有的 `backups/` 下。这里不使用仓库的 `build/` 或 `docker-compose.deploy.yml`。

2026-10-07 用户已在 NAS 执行 `sudo docker compose --env-file .env -f docker-compose.yml config --services`，确认服务为 `postgres`、`app`、`imgproxy`、`worker`，没有 `scheduler`。以下命令按该结果编写，只停止和更新 App/Worker，保留 PostgreSQL 与 ImgProxy 运行。若 NAS 另有定时脚本或外部触发，也应在停写窗口暂停。

这次先不调用 NAS 目录下的 `./update-production.sh`，按下面的显式步骤执行。审计脚本来自新版 App 镜像，不使用 NAS 根目录已有的 `retire-legacy-fields.mjs`。

### 1. 保存旧配置，再选择新版本

后续在同一个 root shell 中操作。如果提示符已经是 `root@...#`，跳过提权；否则**单独执行**下面这一条，等 root 提示符出现后再复制后面的命令，不要把提权和后续命令整段一起粘贴：

```bash
sudo -s
```

下面全部使用完整 Docker 命令，不依赖临时 shell 函数。
先把本次代码发布成同一版本的 App 和 Worker 镜像，再操作。新版 tag 目前不在本手册中预设，v0.50.8 是回退基线而不是本次新版。

```bash
cd /vol1/1001/docker-compose/pixivShelf
set -e
umask 077

retirement_backup="$PWD/backups/task-retirement-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$retirement_backup"
chmod 700 "$retirement_backup"
cp -p .env docker-compose.yml "$retirement_backup/"
docker compose --env-file .env -f docker-compose.yml images > "$retirement_backup/images-before.txt"
```

现在编辑 `.env`，将 `IMAGE_TAG` 改成本次已发布的版本。如果 Compose 写死了镜像 tag，应修改 `docker-compose.yml` 中 App/Worker 两个镜像引用。不要覆盖其他配置。旧配置已在修改前备份。

```bash
# 核对解析后的两个镜像确实是本次新版，然后拉取
docker compose --env-file .env -f docker-compose.yml config --images
docker compose --env-file .env -f docker-compose.yml pull app worker
```

### 2. 停写与备份

先在页面确认没有正在执行的任务，再运行：

```bash
docker compose --env-file .env -f docker-compose.yml stop app worker

docker compose --env-file .env -f docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$retirement_backup/database.dump"
docker compose --env-file .env -f docker-compose.yml exec -T postgres pg_restore --list < "$retirement_backup/database.dump" > "$retirement_backup/dump-list.txt"
sha256sum "$retirement_backup/database.dump" > "$retirement_backup/database.dump.sha256"
```

**停在这里，先完成三个实际媒体挂载目录的同点 NAS 快照，并将快照标识记入备份目录，再继续。** 媒体路径从实际 Compose 挂载确认，不根据 `artists/` 等目录名猜测。PostgreSQL 保持运行，不执行 `down -v`。

### 3. 检查与迁移

```bash
docker compose --env-file .env -f docker-compose.yml run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs --before

docker compose --env-file .env -f docker-compose.yml run --rm --no-deps --entrypoint prisma app \
  migrate deploy --schema=packages/pixishelf-db/prisma/schema.prisma

docker compose --env-file .env -f docker-compose.yml run --rm --no-deps --entrypoint node app \
  packages/pixishelf-db/maintenance/audit-background-task-retirement.mjs --after
```

### 4. 恢复服务

上面全部成功才启动 Worker：

```bash
docker compose --env-file .env -f docker-compose.yml up -d --no-deps worker
```

等几秒，再检查。失败时查看 `docker compose --env-file .env -f docker-compose.yml logs --tail=100 worker`，排查后重试，不跳过：

```bash
docker compose --env-file .env -f docker-compose.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file .env -f docker-compose.yml exec -T worker node dist/capability-audit.cjs
docker compose --env-file .env -f docker-compose.yml up -d --no-deps app
```

打开网页确认登录、任务页和历史记录正常后，恢复先前暂停的外部触发（如有），并退出 root shell。本实例没有 scheduler 服务，不执行 scheduler 命令：

```bash
exit
```

镜像已包含生成好的 Prisma Client，NAS 不需要安装 pnpm 或执行 generate。
任一步报错就停在那一步，不启动后面的服务，也不手工删除任务或迁移记录。`set -e` 可能使 root shell 在错误后退出；恢复操作前重新进入，并将 `retirement_backup` 设置为先前已创建的备份目录，不能重新备份新版配置冒充旧配置。

## 第一阶段回退

停止全部写入者并保存现场，核对期间没有手工执行第二阶段清理。运行 after 审计确认旧目标投影完整。
保留新增 JSON 列和索引，不执行反向 migration；使用已验证的 v0.50.8 App/Worker 镜像及其部署配置，恢复该版本需要的两枚开关为 true。
旧客户端读取不使用 legacyDisplay，但不能让旧 v0 执行器恢复写入；回退保持中央模式。

如数据与文件状态不明，优先修复当前版本，或从同点备份完整恢复。恢复会丢失检查点后的变更，先保存故障现场。

## 观察与第二阶段门禁

至少运行 7 天，记录日常计划、一次周级 GC、两个 lane 的串行性、扫描/归档/替换/视频任务、重启恢复、失败确认和历史查询。
任何异常未闭环则延后删列。第二阶段需单独代码变更、非空库演练和新的同点备份，禁止提前打包进第一阶段镜像。
第二阶段物理删除后，不支持仅换回旧镜像；需要匹配的数据库、媒体、配置和镜像恢复。

## 验证证据

2026-10-07 在 v0.50.8（15e79aa5）工作区基线上完成第一阶段验证。数据库使用临时 PostgreSQL 15 容器，未连接生产库。

| 验证                                  | 结果                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| App lint、typecheck、production build | 通过；删除计划 time 字段后，两处卡片残留引用已修复并重跑                                                                                       |
| App 单元测试                          | 364 文件、2,342 项通过；默认跳过的 168 项 PostgreSQL 测试已分批指定专用数据库执行，全部通过                                                    |
| Worker 依赖链 typecheck、build、test  | 通过；原套件 1,391 项，加新增迁移回归 1 项，共 1,392 项通过                                                                                    |
| App test:integration                  | 13 项通过，18 项专用阅读/删除/系列测试因未配置各自环境跳过；image-count 既有清理逻辑仍输出 Artist 外键错误（不影响断言，但不能视为清理验收）   |
| 迁移                                  | 空库完整 90 份 migration 通过；v0.50.8 非空合成 fixture 升级保留 2 条任务、1 条失败确认和 1 条计划；新增自动化回归覆盖空值、中文路径与旧列不变 |
| 审计                                  | before/after 通过；注入 25 条非终态 v0 后，退出 1、计数 25、样本上限 20，25 条原状态均未改变；清理 fixture 后再次通过                          |
| 读取与恢复                            | 独立生成的 v0.50.8 Prisma Client 能读取升级后的任务/确认/计划；升级前 pg_dump 在另一空库 pg_restore 后计数一致                                 |
| 查询索引                              | 事务内 20,000 条合成记录，EXPLAIN ANALYZE 确认现代 payload 与 legacyDisplay 查询各自命中新增索引；样本已回滚                                   |
| 运行冒烟                              | 本次构建的 Worker + 临时媒体目录通过 READY 和 33 类型/38 版本 capability 检查；旧开关均为 false 时两个 lane 仍启动，SIGINT 正常排空退出        |
| Compose / 路径规范                    | dev/deploy Compose 解析通过；主应用大写路径检查和 git diff --check 通过                                                                        |

核心复验命令：`pnpm --filter @pixishelf/next lint`、`typecheck`、`test`、`test:integration`、`build`，以及
`pnpm --filter @pixishelf/worker... typecheck`、`test`、`build`。PostgreSQL 套件应显式设置对应测试环境变量，
不能只提供 DATABASE_URL 就把被跳过的套件计为通过。初始化测试要求独立的 `init_admin_test` 数据库。

以上是隔离合成 fixture、构建产物和客户端级证据。尚未验证真实生产数据副本、App/Worker Docker 镜像升级与镜像级回退、
NAS 媒体同点恢复、真实浏览器媒体链路或 7 天观察；这些仍是生产发布门禁。当前未执行生产升级、生产数据修复或删列。

## 本次开发环境实操

2026-10-07 已在开发环境完成实际升级：停止旧 Worker，确认无执行中任务与活跃租约，复制三个媒体目录、配置及 PostgreSQL custom dump；备份位于 `.local-data/retirement-backup-20261007-153746`，含文件哈希和旧镜像 ID。只应用 `20261007100000_background_task_retirement_read_model`，before/after 审计均通过，90 份 migration 已同步。

子 agent 审查后修复三处问题：关键帧历史重复投影、新审计命令在 entrypoint 中先迁移的顺序错误，以及 Worker 缺少新 schema 门禁。新增外层查询 PostgreSQL 回归 4 项、数据库门禁 19 项、Worker 配置/预检/部署边界 26 项通过；App lint/typecheck 通过。

开发 Docker Worker 已重新构建并重启，镜像 ID 为 `sha256:bd31428449fe7d34649ddb198372f8b2bf7ff32130df6d42ef8aae31c31fe869`，READY 和 33 类/38 版本 capability 检查通过。宿主机 App 在 `http://localhost:5430` 运行。

浏览器回归由 GPT-6.1 Sol（high）在本地 Chrome 执行：确认计划设置不再编辑旧时间，历史筛选、详情、媒体空队列正常；通过页面提交 Pixiv AI 标签只读预检 `cmuxsygc20002nph6twvmqclw`，新 Docker Worker 在 1 秒内完成，`dryRun=true`，核对 5/5、应用新增/移除/转换均为 0，历史和实时更新可见。测试未执行正式回填或清理。开发库无失败归档收件、无 v0 关键帧/优化任务样本，这些路径的证据仍由隔离 PostgreSQL 回归提供。
