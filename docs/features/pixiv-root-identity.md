---
status: current
scope: Pixiv 扫描根的持久身份、旧库升级与绑定恢复命令
last-verified: 2026-09-11
sources:
  - packages/pixishelf-job-executors/src/scan/root-identity.ts
  - packages/pixishelf-worker/src/pixiv-root-identity.ts
  - packages/pixishelf-db/prisma/schema.prisma
---

# Pixiv 扫描根身份

NAS 重启或重新挂载可能改变 deviceId，inode 也不是跨恢复操作的永久身份。扫描器使用根目录
`.pixishelf-root` 的 UUID 与数据库 `PixivMetadataInventoryState.rootIdentity` 识别图库。
标记内容为 `{"version":1,"id":"<UUID>"}`，由 Worker 创建，不包含媒体或认证凭据。

## 正常扫描与首次升级

- 新库首次扫描自动创建并绑定 UUID。
- 旧库 UUID 为 NULL：只有路径哈希、deviceId 和 inode 均完整且匹配才自动绑定。缺失或变化时，
  返回 `PRECONDITION_FAILED` 并提示身份命令；不能仅凭 inode 相同判定同一图库。
- UUID 匹配时，允许两次执行之间的 deviceId/inode 变化，更新诊断值并记录 `ROOT_REMOUNTED`
  Worker 警告，不改变 baseline generation 或清空 inventory。
- 路径哈希仍须匹配。本期不支持迁移 SCAN_PATH 或将另一套图库接入既有 inventory。
- UUID 不同、标记缺失/损坏/超过 1024 字节/为符号链接时拒绝自动采用；没有 deviceId 后备认证。
- 目录增量、客户端列表、单作品重扫、一致性核对和核对应用共用规则。本地目录导入不要求此标记。
- 核对与应用保留执行过程中 deviceId/inode 的严格检查并复核 UUID；文件指纹、冻结证据、generation
  和事务 fence 不放宽。重挂载后旧审计可能因文件证据变化成为 STALE，需要重新核对。

首次创建需要 Worker 对媒体根有写权限；有效标记已存在时只需读取。App 保持原媒体默认只读。
文件排他创建、完整写入并同步；文件成功而数据库失败时，在身份条件仍满足后重试可复用 UUID。
残缺标记不自动覆盖，须保存现场并核对数据库与标记备份后恢复。

## 身份维护命令

命令包含在 Worker 镜像中，使用已有 `DATABASE_URL` 与 `SCAN_PATH`。`inspect` 只读，输出目录身份、
inventory state、标记状态与确认指纹，不输出连接串。输出含本地路径，应作为私有运维记录保存。

从仓库根目录使用部署 Compose：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps worker \
  node dist/pixiv-root-identity.cjs inspect
```

写操作前按[备份与恢复](../operations/backup-and-recovery.md)保存数据库检查点、根标记和挂载依据，停止所有
Worker。用一次性容器运行命令，不启动常驻消费者。确认宿主挂载、容器路径和原媒体确属同一图库后执行：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop worker

docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps worker \
  node dist/pixiv-root-identity.cjs inspect

docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps worker \
  node dist/pixiv-root-identity.cjs bind --expect <本次检查输出的fingerprint> --confirm-same-library

docker compose --env-file build/.env -f build/docker-compose.deploy.yml up -d worker
```

`bind` 只用于无 UUID 的旧库。`--confirm-same-library` 表示管理员已核实原图库，指纹仅防止检查后状态变化，
本身不能证明图库来源。指纹过期时重新 inspect，不照搬旧值。

写命令复用 writer lane 调度锁，拒绝执行中的 writer 任务、有效租约或最近 60 秒仍在线的 Worker。
正常停止后可重试；异常退出留下执行中任务时先按任务恢复流程处理，禁止手工清租约或改任务状态。
检查/绑定期间关闭外部同步写入。命令不清空 inventory，不改作品、历史任务或 baseline 状态。
保存 before/after 输出作为恢复依据。

只有已绑定图库的标记缺失时，核实挂载后恢复数据库原 UUID（同样先停 Worker）：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml run --rm --no-deps worker \
  node dist/pixiv-root-identity.cjs restore-marker --expect <本次检查输出的fingerprint> --confirm-same-library
```

该命令不覆盖损坏或不同 UUID 的标记。发现不同标记时先调查挂载，不删除它来绕过校验。
根目录不存在或不可读时先恢复挂载，再 inspect。

## 发布、备份与回滚

1. 停写并保存升级检查点，停止旧 Worker。
2. 按部署流程生成 Client 并部署 migration `20260911120000_add_pixiv_root_identity`，禁止 `db:push`。
3. 安装新 App/Worker，用新 Worker 镜像 inspect；旧身份匹配可在下一次扫描自动绑定，不匹配则先 bind。
4. 启动 Worker，验证新批次任务与 UUID；已有失败任务不会自动修复或改写。

迁移仅增加可空字段，不根据旧 deviceId 猜测 UUID。文件与数据库不在同一原子事务，恢复须核对二者。
回滚时停止 Worker 并使用兼容当前 schema 的镜像；旧 Worker 不读取 UUID，仍会在下次设备编号变化时拒绝
扫描。无需为代码回滚删除字段或标记。完整恢复使用配对的数据库及媒体备份。

`.pixishelf-root` 必须包含在媒体快照和备份中，外部 rsync/同步/清理工具不得删除或覆盖它。
完整克隆会复制相同 UUID；标记识别逻辑图库，不能区分携带同一标记的克隆副本，也不是媒体完整性校验。

## 本次验证记录（2026-09-11）

- 独立 PostgreSQL 15 临时容器完成 78 个 migration 的空库部署与 status；隔离 schema 验证空表及旧数据迁移，旧状态和 inventory 保持不变。
- 根身份单测 17 项、扫描 PostgreSQL 回归 59 项、运维命令 PostgreSQL 测试 10 项通过，覆盖新批次导入、各扫描入口、重挂载、UUID 变化时禁止 MISSING、并发和失败恢复。
- Worker 依赖链 typecheck/build、DB validate、完整依赖链测试已执行。Executor 全量测试中 6 项符号链接夹具在 Windows 沙箱报 EPERM，提升权限重跑对应 4 个文件的 41 项测试全部通过。
- 主应用 lint/typecheck/build 通过。单元测试 1,835 项先通过，唯一失败同为符号链接 EPERM；提升权限重跑对应 11 项全部通过。默认跳过的 PostgreSQL 测试不计为通过，本次另行执行来源核对 PostgreSQL 测试 4 项通过。
- 主应用 test:integration 在隔离数据库运行：6 通过、6 失败；在修改前 HEAD `3868fa05` 的独立源码副本复现相同 6 项失败，位于旧 scan/rescan fixture 测试，包含缺失 mock 的 findMany 调用。没有为本次修复改写这些旧测试或断言。
- 编译后的 `dist/pixiv-root-identity.cjs inspect` 已通过只读命令冒烟。未连接生产 NAS 或执行真实飞牛升级；挂载重编号由测试模拟，生产发布后仍须核对首次绑定与新任务结果。
