---
status: historical
scope: F03 第五、六批合入主目录、开发库保留数据升级与 Worker 重建启动
last-verified: 2026-10-28
sources:
  - docs/records/artwork-deduplication-root-scope-f03-2026-10-28.md
  - docs/records/artwork-deduplication-posting-plan-f03-2026-10-28.md
  - docs/operations/backup-and-recovery.md
  - build/docker-compose.dev.yml
---

# F03 第五、六批本地升级

用户授权合回主目录、保留开发库及现有作品并重建启动 Worker，App 由用户 F5 启动。本轮沿用第五、六批已通过的专项、独立审查及适用浏览器证据，不重跑全量 App lint／test／build、规模测量或图源未变的渲染检查。

## 合并与恢复依据

主目录 `/Users/namehu/mm_code/PixiShelf` 的 `main` 开始为 `912f7e73` 且干净。重新 fetch 后 `origin/main` 为 `46eacb5b`；该主线两次修复已在第五批审查并合入开发分支。目标 `0a7f7ba0` 同时包含本地主线和远端 main，以 `git merge --ff-only codex/dedup-scale-validation-f03` 快进合回，没有覆盖、重置或舍弃主线改动。第四批验证记录亦随分支历史保留。

升级前 App5430 无监听，scheduler 未运行，开发队列无未完成任务。仅停止 `build-worker-1`，未停止或重建 PostgreSQL／ImgProxy，也未操作 55432 的隔离测试库。检查点保存在仓库外：

`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-b56-dev-upgrade-20261028-132755-tbrl4d23`

其中包含 custom-format 数据库 dump、受限环境配置副本及媒体快照：原媒体 589 文件／91,200,551 B，Pixiv data 98 文件／37,025,109 B，本地归档 1 文件／24,441 B，派生目录为空。逐文件大小／SHA 与复制品核对一致；dump 在新临时空库实际恢复，112 张既有业务表的数量及完整行摘要、迁移数量均一致。仅移除此次临时恢复库，完整检查点保留。旧 Worker 镜像另留本地备份标签；精确身份见检查点 `checkpoint.json`。

## 正式迁移

确认宿主 App 连接 `127.0.0.1:5432/pixishelf` 后，显式注入该连接执行 `db:generate`、`db:deploy`、`db:status`。从 124 项升级到 126 项，补齐：

- `20261027000200_artwork_dedup_visual_batches`：新增视觉工作表及可空检查点／复用字段，并允许扫描 v5。
- `20261027000300_artwork_dedup_legacy_review`：替换审核函数，对齐历史零版本证据。

迁移成功，状态 up to date，没有使用 `db:push`、清库或删除原媒体。在恢复 Worker 写入之前，以升级前字段投影核对 112 张既有业务表，行数与完整行摘要全部未变；22 部作品、558 张图片及既有个人标记和指纹数据均保留。没有回填、原媒体扫描或修改生产预算。

## Worker 与交付

仅按既有 Compose 配置执行一次 `build worker`，新镜像为 `sha256:6c8f5bb6df5916519b7819cb5d2c2895cea72e5c8bf21321b891570c605d4dae`。随后 `up -d --no-build --no-deps --wait worker` 成功，新容器 running／healthy，READY 检查及完整 capability 审计均通过：1 个 READY Worker、39 类任务／55 个版本。未重建数据库或 ImgProxy。

容器内 `dist/main.cjs` SHA-256 为 `e392ae0ce7eb43b42e9df8f5fbbb8a10970082e855c752cbea77a753b4889575`，与第六批验收产物一致；候选索引查询及有界目录范围实现均存在。启动后再次核对全部媒体清单、大小及 SHA，无变化；两份环境配置和 Compose 文件也与检查点副本一致。126 项迁移完成、失败项为零。证据保存于检查点中的迁移／构建／READY／capability 日志及 `upgrade-after.json`。

App5430 仍无监听，用户可直接在 `/Users/namehu/mm_code/PixiShelf` 用原 F5 配置启动，访问 `http://localhost:5430/admin/duplicates?entry=direct`。本轮不主动触发查重或删除，没有新建或修改测试作品；生产 10,000 原件上限保持原样。

本记录随本地收口另行提交；不推送、不发布 NAS。恢复依据为本次完整检查点和保留的旧 Worker 镜像，按备份恢复手册处理，不能对运行中的开发库直接覆盖恢复。迁移前后数据一致性和运行就绪检查是本次升级验收，不冒充重跑功能或规模测试。
