---
status: historical
scope: 本地开发库去重迁移、备份恢复校验及Worker重建
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-main-merge-2026-10-24.md
  - docs/operations/runbooks/artwork-deduplication.md
  - build/docker-compose.dev.yml
---

# 去重本地开发升级

用户明确授权数据库迁移和Worker重建，App由用户自行F5启动。代码基线 `6d317e15`；仅处理本机开发Compose项目，未启动App、执行去重删除或重跑全量测试。完成时间 `2026-10-24T21:48:16.288722+08:00`。

## 检查点

停写前数据库活动任务为0，5430无App监听。停止旧Worker/scheduler后保存数据库custom-format dump、三个媒体根和配置，并为旧Worker镜像保留标签。检查点目录为 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-local-upgrade-20261024-214257-9mxpfdwt`，权限0700；数据库及配置副本限制读取，不提交Git。

备份包含原媒体223文件、派生媒体0文件、Pixiv数据98文件；复制后逐文件SHA-256核验，保留隐藏文件和符号链接，不更改原媒体。dump已在同机新建独立临时库实际恢复，核对核心计数后删除该临时验证库。实际备份SHA、原镜像标签、文件清单和恢复输出在检查点的 `checkpoint.json`、各manifest及restore.log；这不是异机生产灾备演练。

## 升级与就绪

| 项目      | 结果                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 迁移      | 正式 `pnpm --filter @pixishelf/db db:deploy` 成功应用14份新增迁移，101→115；db:status显示up to date，无失败迁移。未使用db:push，未修改历史SQL。 |
| 数据保持  | Artwork 10→10，Image 192→192；未操作媒体文件或用户整理数据。                                                                                    |
| Worker    | `docker compose ... up -d --build --no-deps worker` 成功，build-worker-1 healthy。数据库和ImgProxy没有重建。                                    |
| 就绪/能力 | ready healthcheck exit0；capability audit通过：1个READY Worker、39类任务/48版本，维护v1/v2并存，三lane正常。                                    |
| App       | 未启动；用户可在主目录直接使用原F5配置启动。scheduler原本未运行，本轮不额外启用。                                                               |

旧Worker镜像 `sha256:520fea9a5523a20e394fb0b3097af85c831b5d106a24b43843ac3696ea9a0e0d`，新镜像 `sha256:3d2e5e9f6fe9da82940c179c7766dfdc8353f227c6593450b9ca914b5345ae91`。构建日志与正式迁移日志保存在检查点目录。首次安装新增原生编译依赖导致完整基础依赖层重建，未因此调整依赖版本或重跑应用构建。

需要回退时先停止写入，依据同点检查点恢复匹配数据库、媒体和旧程序；不能只换回旧Worker，因为旧版本不理解新声明/删除协议。当前仅验证迁移与Worker就绪，真实App交互仍由用户F5启动后验证。
