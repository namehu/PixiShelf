---
status: current
scope: 艺术家与系列旧字段清理、存储规则及分步升级
last-verified: 2026-09-30
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/maintenance/
  - packages/pixishelf-job-executors/src/migration/
  - packages/pixishelf/services/batch-import-service.ts
  - build/entrypoint.sh
---

# 艺术家与系列旧字段清理

## 范围与行为

删除 `Artist.userId`、`Artwork.seriesId`、`Series.source` 和 `Series.externalId`。艺术家与系列的外部身份分别由 `ArtistExternalRef`、`SeriesExternalRef` 保存；系列成员以 `SeriesArtwork` 为准。

现有媒体不因删列移动。目录通过 `Artwork.storagePath` 和已保存的媒体位置确定，不再从艺术家的外部账号推算。有主艺术家的新建手工及批量作品使用 `local-imports/artist-{本地艺术家ID}/{storageKey}`，建立本地目录映射；没有主艺术家的手工作品使用 `local-imports/unassigned/{storageKey}`，不虚构艺术家。创建时保存目录；历史空白手工作品在首次上传或替换初始化时补齐。已有媒体或元数据的作品不按此规则重新分配目录。本地目录扫描将已登记的手工作品计为已存在。艺术家合并保留旧目录，合并后新作品使用目标艺术家的目录。

姓名及正式 Pixiv ID 搜索保留，旧 `p_` 等内部编号不再作为搜索别名。显式路径迁移继续支持本地作品，但只有用户执行迁移才搬文件；来源不明或归档管理的目录不能猜测为本地目录。

## 数据检查

- 艺术家旧 ID 只有满足唯一数字 ID、明确 Pixiv 作品来源且无新身份冲突时才能认领；本地编号不能认领为 Pixiv。
- 补齐目录检查全部媒体、元数据及附属文件，不能只依据第一张图片。路径不安全、跨目录或有冲突时阻止清理。
- 新关系表独有的系列成员和已排除成员是正常状态。只有旧指针而没有新关系的作品须明确选择保留当前关系或恢复旧关系；恢复为 `LEGACY`，追加到末尾。
- 补齐系列身份不能重写已有成员的归属、排序或排除状态。
- 处理文件绑定旧值指纹；数据变化后必须重新检查。报告输出完整问题集合，不以抽样结果批准删列。

## 升级边界

上线分为只读检查 `audit`、显式数据准备 `prepare`、复查后迁移 `upgrade`。普通 App 启动不能直接跨越已有数据库的删列门槛。空库仍使用完整 migration 链。

先由旧版本收口所有旧文件迁移，再停写、建立[一致性检查点](../operations/backup-and-recovery.md#发布前一致性检查点)，然后准备数据和升级。任务状态为失败或取消不能证明临时文件、发布和清源已经收口。容器状态、外部写入者退出及备份恢复验证由操作者核对，数据库检查不能替代这些证据。

两份 migration 分别提交，不保证共同原子性。第一份执行前联合检查两个范围；任何失败均保持服务停止，修复后继续或恢复完整检查点，不能启动依赖旧字段的镜像。禁止自动执行 `migrate resolve`。

## 上线操作

使用同版本的 App 与 Worker 镜像。先准备受限的宿主机检查点目录，允许容器 UID 1001 写入报告；以 [checkpoint.example.json](../../packages/pixishelf-db/maintenance/checkpoint.example.json) 填写真实备份清单并保存为 `checkpoint.json`，以 [decisions.example.json](../../packages/pixishelf-db/maintenance/decisions.example.json) 填写人工确认并保存为 `decisions.json`。模板默认没有确认停写，须实际核对后填写。不要将它们提交到仓库。维护容器只连接目标数据库并读取媒体，不启动应用或 Worker。

以下命令从仓库根目录运行；将 `CHECKPOINT_DIR` 替换为实际绝对路径。`--entrypoint node` 用于绕过普通 App 启动流程。

```bash
export CHECKPOINT_DIR=/absolute/private/checkpoint-directory

docker compose --env-file build/.env -f build/docker-compose.deploy.yml \
  run --rm --no-deps --entrypoint node -v "$CHECKPOINT_DIR:/maintenance" app \
  packages/pixishelf-db/maintenance/retire-legacy-fields.mjs audit \
  --data-root /app/data --report /maintenance/audit.json
```

`audit` 不修改业务数据。退出 `2` 表示存在阻断项；退出 `1` 表示工具、文件或连接错误。报告中的 `actions` 是可准备的确定性动作，`blockers` 是须处理的问题。根据每项允许的操作生成确认文件，不手工改指纹或批量猜测身份。重新检查时使用新的报告文件名。

收口旧迁移、停止全部写入者、验证一致性备份后，再执行：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml \
  run --rm --no-deps --entrypoint node -v "$CHECKPOINT_DIR:/maintenance" app \
  packages/pixishelf-db/maintenance/retire-legacy-fields.mjs prepare \
  --data-root /app/data --manifest /maintenance/checkpoint.json \
  --decisions /maintenance/decisions.json --report-dir /maintenance/reports

docker compose --env-file build/.env -f build/docker-compose.deploy.yml \
  run --rm --no-deps --entrypoint node -v "$CHECKPOINT_DIR:/maintenance" app \
  packages/pixishelf-db/maintenance/retire-legacy-fields.mjs upgrade \
  --data-root /app/data --manifest /maintenance/checkpoint.json \
  --report-dir /maintenance/reports
```

没有人工确认项时可省略 `--decisions`。`prepare` 和 `upgrade` 均重新检查现场并保存前后报告；准备后重新出现问题时停止，不绕过检查。所有命令成功后才启动配套 App/Worker，核对 migration status、Worker READY/capability、登录、媒体、艺术家和系列，再恢复 scheduler。四列已经删除后，不得用旧镜像直接回退。

## 验收

已通过隔离 PostgreSQL 的空库 87 条迁移、非空旧库准备与升级、阻断及重复执行、部分升级失败和备份恢复；App/Worker 测试与构建、非 root 镜像维护入口、旧库启动阻断及 Worker READY/capability 均已验证。交叉复审发现的阻塞问题已修复并通过复审。

生产升级尚未执行，须按上述流程在实际停写检查点完成。
