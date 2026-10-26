---
status: historical
scope: F02 第二批合入主目录、开发库保留数据迁移、Worker 重建启动与手测样本
last-verified: 2026-10-26
sources:
  - docs/records/artwork-deduplication-relations-f02-2026-10-26.md
  - docs/operations/backup-and-recovery.md
  - docs/operations/runbooks/artwork-deduplication.md
  - build/docker-compose.dev.yml
---

# F02 第二批本地升级与手测样本

用户授权合回主目录、升级开发库和 Worker 并新增少量测试数据，现有数据保留，App 由用户 F5 启动，不重复全量验证。

## 合并、检查点与迁移

主目录 `main` 位于 `4ea9de96`，工作区干净。使用 `git merge --ff-only codex/dedup-relation-cache` 快进至已完成独立审查及桌面验收的 `4b6b5b81`，没有覆盖主线改动或重写历史。

升级前 App5430 无监听，开发库无活动任务，scheduler 未运行。停止旧 Worker 后保存检查点：

`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-relations-dev-upgrade-20261026-191047-xwm_odtr`

保存 custom-format dump、实际配置、旧镜像标签以及原媒体、派生媒体、Pixiv data、本地归档根副本。原媒体549文件、Pixiv data98文件、本地归档根1文件、派生媒体0文件；逐文件长度和SHA与副本一致。dump在新建临时空库实际恢复，112张业务表数量及原字段行摘要一致，迁移历史数量一致，随后只删除本次临时恢复库。审计首次因 UNION ALL 行返回顺序不同报差异，按表名归一化后核对相同，没有对开发数据作修复。该检查点属于本机开发恢复依据，不代表异地备份或生产恢复演练。

正式执行 `db:generate`、`db:deploy`、`db:status`，只应用 `20261026000200_artwork_dedup_relation_cache`，已完成迁移122→123、失败迁移0。没有使用 `db:push`，没有重建开发库。新增字段之外，112张既有业务表按升级前字段投影的数量和摘要全部相同。

## Worker 与环境

旧镜像 `sha256:7f960a88c0bc19376cb7b28f0cacc6c9f16fbd72c41de14c7ab9ace18d38cc2c` 保留为 `pixishelf-worker:before-f02-relations-20261026-191047`。新镜像为 `sha256:db766b758a1e3a20333e3e3713728cc65eaa23284bcdd05ff6caa7249139f2f8`。

仅执行必要的 `docker compose --env-file build/.env -f build/docker-compose.dev.yml build worker`，随后 `up -d --no-build --no-deps --wait worker`。容器 running/healthy，ready healthcheck与能力审计通过：1 READY Worker、39类任务／54个版本。数据库、ImgProxy未重建，未启动App、未运行全量App lint/test/build或重复功能验收。

新样本原件位于 App `SCAN_PATH` 与 Worker `/app/data` bind 共用的 `/Users/namehu/Downloads/pixiv`。App本地归档根仍为原配置的主目录 `data`，未改配置、全局scanPath setting或根身份。

## 新增样本与回归入口

新艺术家 **F02 关系复用回归**（ID21），只新增以下三部作品，各10张：

| 作品         |  ID | 预期                          |
| ------------ | --: | ----------------------------- |
| A · 原版     |  35 | 与B有8张相近画面，另2张未配对 |
| B · 相近版本 |  36 | 与A有8张相近画面，另2张未配对 |
| C · 独立对照 |  37 | 暂无重复关系                  |

独立目录为 `sources/f02-relation-6171bd0f-b119-4ea7-9b91-e6ce2a786357/`。使用已通过桌面验收的合成PNG，A/B对应8张解码像素相同、文件字节不同；30个原件SHA全不同，全部为独立普通文件。没有触发扫描或检测，艺术家的检测run数仍为0，保留首次检查的冷缓存场景。

新增前后排除本批ID，既有Artwork18行、Image518行、MediaMark2行以及Artist、创作者关系／证据、Setting的数量和完整行摘要均一致。新增后总数为21部作品、548张媒体、2条单图标记。

F5启动后打开 `http://localhost:5430/admin/duplicates?artistId=21&entry=direct`，在检查选项开启“检查疑似版本”：首次应只有A/B一对，8张相近、两侧各2张未配对；再次检查结果应保持相同。完成两轮后，可在本机执行：

```bash
node /private/tmp/pixishelf-relation-f02-dev/add-d.cjs
```

该脚本仅向固定测试艺术家新增预备的D（10张，与C有8张相近页）；D当前未入库，实际媒体根没有D目录。第三次检查应同时出现A/B和C/D，旧审核选择不自动带入。先完成这三轮再删除样本；新增D脚本会核对原A/B/C仍存在，避免对不符的测试现场继续写入。脚本不恢复文件、不改现有作品、不自动执行检测。

私有manifest、文件SHA、旧行摘要和夹具脚本在 `/private/tmp/pixishelf-relation-f02-dev/`，其证据副本已保存于上述检查点的 `fixture/`。不在仓库保存凭据或媒体文件。此轮仅准备手测，不把用户尚未执行的开发环境回归写成通过。

## 收口

沿用F02第二批已通过的21个专项、独立审查及桌面证据；本轮只做正式升级、恢复核对、健康能力与新增夹具审计。没有新功能代码修改，不推送或发布线上镜像。主目录留给用户F5启动；同SHA跨媒体特征复用及F03规模工作未启动。

文档检查通过：282份 Markdown本地链接／锚点／路径检查、33个图源和23处内嵌 Mermaid检查；图源未变，未重新生成。diff检查通过，主应用路径大小写搜索无匹配。
