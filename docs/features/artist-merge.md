---
status: current
scope: 艺术家合并、归档绑定迁移、任务互斥与历史存储身份兼容
last-verified: 2026-09-21
sources:
  - packages/pixishelf-db/src/artist-merge.ts
  - packages/pixishelf-db/prisma/migrations/20260921120000_artist_merge/migration.sql
  - packages/pixishelf-job-executors/src/maintenance/artist-merge.ts
  - packages/pixishelf/services/artist-merge-service.ts
---

# 艺术家合并

艺术家管理行操作「合并到其他艺术家」进入 `/admin/artists/merge`。选择被合并方与保留方，可交换方向；预览显示双方资料、可见作品并集、共同作品、来源身份和归档绑定数量。确认提交 `ARTIST_MERGE@v1`，由支持该能力的 READY Worker 在 BACKGROUND_WRITER 执行。地址栏保存执行记录 ID，刷新或关闭页面不影响任务；最近 30 次提交可从本页重新打开。

## 结果与边界

- 一次两条，同类型 PERSON/PERSON 或 GROUP/GROUP；禁止自合并和跨类型合并。
- 名称、简介、头像、背景图、星标以及空值全部采用保留方。不创建名称别名，现有来源名称仍按来源搜索规则匹配。
- 所有作品关系迁移，包括已删除和非 ACTIVE 作品；展示计数只包含正常可见作品。有效归属取并集，相同作品只计一次；其他共同作者不动。
- SOURCE、MANUAL、LEGACY 依据保持原所有权，排除状态保留。相同 evidenceKey 冲突时，只要任一依据有效则结果有效；两个无效依据不能组合成有效依据。原记录保存在审计快照。
- 外部身份、本地目录、来源标签映射转移至目标，标签映射 version 增加。双方同一 Provider 不同外部 ID 阻止合并，不允许通过合并丢弃账号。
- 来源固定艺术家、待生效绑定和人工抑制全部转移并去重。抑制限制未来自动添加，不移除目前已经有效的作品归属。
- 不合并作品实体、不去重媒体、不移动文件；`Artwork.artistId`、storageKey、storagePath 与媒体路径保持不变。

## 存储与并发

`Artist.mergedIntoId/mergedAt` 标记不可再使用的旧实体。普通列表、详情、搜索、选择器和统计排除旧实体；旧详情链接返回不存在。旧行保留历史存储信息及合并链，不能从普通接口编辑或删除。

`artist_merges` 保存操作者、双方 ID、预览指纹、摘要、完整 before/after 快照和任务 ID。记录不自动清理。计划状态 READY/QUEUED/COMPLETE 表示领域提交状态；取消、失败、暂停等执行状态以关联 SystemJob 为准。

预览与提交都在创作者目录事务锁内读取。提交及执行重验指纹；资料、归属、映射或绑定变化需重新预览。执行一次事务提交所有领域变更、审计和队列成功状态，失败整笔回滚。重试检查同一冻结预览，已经成功的请求幂等返回。暂停或取消仅在领域事务前生效。

未结束的相关任务（含 PAUSED、RETRY_WAIT）阻止提交或执行。明确针对其他艺术家的 Pixiv 补全、固定其他艺术家的来源扫描不阻塞；全量扫描、导入、迁移、替换及无法证明无关的任务保守阻塞，预览给出原因和任务入口。任务排队后出现新的相关任务时，执行也会拒绝，不产生部分合并。

数据库写入触发器序列化创作者目录变化、归档绑定和任务激活，拒绝向已合并艺术家写入关系。任务心跳不获取目录锁。旧任务重试／恢复重验显式艺术家 ID、整理命令和扫描绑定快照；历史记录本身不重写。历史 Artwork INSERT 的兼容触发器解析最终保留方来建立关系，同时保留原 artistId 作为存储引用。连续 A→B→C 合并解析到 C。

长列表合并仍是单事务，受 Worker 的事务时限约束。超时保持全部未合并；检查任务错误、暂停相关写入并重新预览，不能把部分提交当成成功。

## 发布与恢复

迁移为 `20260921120000_artist_merge`。按[备份与恢复](../operations/backup-and-recovery.md)建立一致检查点，使用正式 generate/deploy 流程；App 和 Worker 配套升级，禁止混合旧版写入者继续运行。队列启动门禁要求新迁移和 artist_merges 表。能力清单为 31 个 job type / 36 个 type-version 组合。

无一键撤销。人工恢复必须比较 before/after 与当前数据，保留合并后的新归档、映射变化和用户整理；不能只恢复旧 Artist 一行或只清除 mergedIntoId。数据库保护触发器也属于恢复对象，不通过业务接口绕过。完整回退使用升级前一致检查点和对应二进制，不能只回滚二进制后继续使用旧模型写入。

## 验证

真实 PostgreSQL 测试覆盖有效归属并集、重复证据、人工排除、隐藏作品、来源刷新、三类归档绑定、未来发布、身份冲突、连续合并、过期预览、暂停任务、旧命令重试、并发绑定／入队以及最终提交失败回滚。执行器测试覆盖取消、暂停、中断和事务内完成；界面测试覆盖方向、预览确认、阻塞任务与 URL 恢复。
