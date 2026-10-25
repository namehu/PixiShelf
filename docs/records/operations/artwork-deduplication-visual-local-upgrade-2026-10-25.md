---
status: historical
scope: 本地开发库包含关系与疑似版本迁移、数据保留核验及 Worker 重建启动
last-verified: 2026-10-25
sources:
  - docs/records/artwork-deduplication-suspected-versions-2026-10-25.md
  - docs/operations/runbooks/artwork-deduplication.md
  - docs/operations/backup-and-recovery.md
  - build/docker-compose.dev.yml
---

# 疑似版本本地开发升级

用户明确授权保留现有数据、迁移开发库并重建启动 Worker；App 由用户自行 F5 启动。代码基线 `eb6894be`，仅处理本机开发 Compose 项目，没有运行 App 或全量验证。

升级前 5430 无监听、活动任务为 0。停止旧 Worker 后建立受限检查点：`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-visual-dev-upgrade-20261025-200236-bya84zwk`。保存 custom-format dump、原媒体/派生媒体/Pixiv data/宿主机本地归档根、实际配置和旧 Worker 镜像标签；备份不进入 Git。

数据库 dump 在全新临时库实际恢复，109 张表的数量和行摘要一致，验证库已移除。原媒体 229 文件、Pixiv data 98 文件、本地归档根 1 文件、派生媒体 0 文件，复制前后及副本逐文件 SHA-256 一致。具体 SHA、清单、恢复日志和旧镜像标签保存于检查点，不作为异机灾备演练。

| 项目       | 实际结果                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正式迁移   | `db:generate`、`db:deploy`、`db:status` 成功，应用 `20261025000100` 至 `20261025000600` 共 6 份迁移；完成迁移 115→121，schema up to date，失败迁移 0 |
| 历史保留   | 原有 12 条已回滚迁移历史保留；迁移历史行数 127→133，没有删除或重写历史                                                                               |
| 数据保留   | 启动新 Worker 前按原字段投影比对 108 张原有数据表，数量和行摘要完全一致；作品 13→13、媒体 198→198、单图标记 2→2                                      |
| Worker     | 仅构建 Worker 镜像及必要依赖，随后 `up -d --no-build --no-deps worker`；沿用原配置与挂载，未重建数据库或 ImgProxy                                    |
| 健康与能力 | 容器 running/healthy，READY 检查成功；能力审计 1 个 READY、39 类任务/52 个版本，扫描 v1/v2/v3 与维护 v1/v2/v3/v4、三个执行通道齐全；活动任务仍为 0   |
| App        | 未启动，5430 保持空闲；用户可在主目录使用原 F5 配置；scheduler 原本未运行，本轮未启用                                                                |

旧 Worker 镜像 `sha256:3d2e5e9f6fe9da82940c179c7766dfdc8353f227c6593450b9ca914b5345ae91`；新镜像 `sha256:6a5e8c68605b170c427439b4c70c15998747b829023f7b9b77ae795075144ce7`。迁移、构建、READY 与能力日志、数据比对结果均在检查点目录。

没有执行图库扫描、重新计算指纹、删除作品、修改媒体或重跑应用 lint/test/build。Worker 已恢复消费，实际页面交互由用户 F5 后验证；若需回退，先停写并按检查点恢复匹配的数据和程序，不仅替换旧 Worker 镜像。
