---
status: current
scope: 指定账户的 Pixiv 新作品默认已读及一次性历史补齐
last-verified: 2026-10-21
sources:
  - packages/pixishelf-db/src/artwork-reading.ts
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
  - packages/pixishelf/scripts/prepare-pixiv-reading-backfill.ts
---

# Pixiv 导入默认已读

适用场景：用户在下载 Pixiv 作品前已经阅读过，希望导入后不再显示未读。

- 账户偏好 `UserSetting.pixiv_import_mark_read`，仅 `type=boolean,value=true` 启用；默认关闭。
- 仅 Pixiv 扫描新建作品成功发布时应用，在同一事务内写入已读媒体与摘要。跳过、刷新、来源补全、链接归档、本地导入及手动创建均不触发。
- 所有媒体按现有 APNG/视频逻辑分组计数；零媒体不写完成摘要。
- 仅修改启用偏好的账户。不增加阅读次数，不伪造实际阅读时间或恢复位置。
- 后续追加媒体仍未读，完整重建沿用阅读状态失效规则。关闭偏好不撤销已读记录。
- 历史补齐必须显式指定账户、冻结作品清单与媒体版本；仅 ACTIVE、未删除且 `createdVia=PIXIV_SCAN` 的作品参与。分批处理，版本变化跳过。
- 执行前保存受影响阅读状态；记录执行清单、成功/跳过/失败与恢复依据。恢复必须核对当前状态与执行后快照，不能覆盖之后产生的真实阅读。

生产部署、账户偏好和历史回填已有专项核验，日期、版本、完整结果及恢复材料见[生产执行记录](../records/features/pixiv-import-reading.md)。新作品自动初始化已通过隔离集成测试；本次未为验收额外导入生产作品。

## 维护操作

无需 Schema 迁移。新规则由通用 Worker 执行，必须部署包含该改动的 Worker 后才生效；数据库中的偏好本身不会让旧版本自动标记。

先确认连接和账户，使用主应用目录内的只读工具生成计划：

```bash
pnpm exec tsx scripts/prepare-pixiv-reading-backfill.ts \
  --connection '<DBX connection>' --user-id '<account id>' \
  --out '<new private backup directory>'
```

工具冻结当时的最大作品 ID，逐批保存媒体清单、已读集合和完整阅读摘要、账户偏好原值，以及待执行 SQL 和 SHA-256 清单。输出包含私人媒体路径，目录权限为 0700、文件为 0600，应放在明确批准的位置，不提交 Git。它不是数据库与媒体的一致性完整备份。

逐个使用 DBX `execute_batch`、`use_transaction=true` 执行 `batch-*.sql`，每批 25 部。禁止拆成独立自动提交语句：先按 ID 锁定作品，随后在新语句快照里重验作品版本、完整媒体清单、阅读摘要及已读集合。任何变化均跳过，不覆盖之后的阅读；锁超时整批回滚。记录每批结果和执行后阅读快照，核对 planned/eligible 的差额，失败或结果不明时先读取当前状态再决定后续操作。

在确认启用范围后单独执行 `enable-preference.sql`。关闭只需将该账号的偏好设为 false，不撤销已读记录。更换旧 Worker 会停止自动初始化；保留已有已读数据，无需回退表结构。

若需恢复回填，只恢复成功修改的账户/作品，先取得作品锁并逐项比对执行后快照。存在后续阅读、媒体或版本变化时停止自动恢复，人工核对；不能直接覆盖整表。无变化的项可按 before 快照恢复摘要和已读集合，恢复摘要时须产生更高 stateVersion，避免客户端继续采纳过期缓存。原先没有摘要的项也应通过兼容的版本递增修复处理，不能简单删除后把版本降为零。回填不修改作品与媒体文件。

历史验证与限制见[Pixiv 默认已读生产执行与验收](../records/features/pixiv-import-reading.md)。
