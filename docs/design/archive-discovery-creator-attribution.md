---
status: historical
scope: 归档入箱时指定本站艺术家、发布时绑定与已归档作品补漏
last-verified: 2026-11-18
sources:
  - packages/pixishelf-job-executors/src/archive/uploader-scan-executor.ts
  - packages/pixishelf/services/archive-uploader/archive-uploader-service.ts
  - packages/pixishelf/services/archive-uploader/discovery-deferred-service.ts
  - packages/pixishelf-job-executors/src/archive/publisher.ts
  - packages/pixishelf-db/src/discovery-creators.ts
---

# 按实际入箱来源绑定归档艺术家

新归档采用入箱成功那一刻指定的本站艺术家名单。从发现来源入箱就取该来源当前的固定艺术家。任务可以显示这份名单，发布成功时将名单写入作品。原站上传者、艺术家和社团标签保留为原站信息。本文保留本轮确认的范围及验收场景。当前规则由[发现来源规格](../features/archive-discovery.md#发现来源的艺术家绑定)维护。

## 改造前的行为

- 标题来源曾在扫描时写入目录的 `firstMatchedAt`，在入箱时才追加固定艺术家。v0.56.11 将追加动作移到扫描首次接纳，并移除了入箱追加。跨版本的历史条目已经用过首次机会，却可能从未得到艺术家。再扫一次也无法补齐。
- 旧实现按来源分别记录目录命中，待生效绑定却只以站点、画廊和艺术家为唯一键。旧的入箱服务知道所选来源，但收件条目及归档任务没有保存这次选择。多个来源共享同一下载状态，按最近任务反推来源会得到多条记录。
- 旧发布流程按站点和画廊消费全部待生效绑定。已有本地作品在另一个来源首次扫到时也可能直接追加艺术家。自动追加与人工绑定最终使用相同的 `manual` 证据键。旧关系单凭这条证据无法区分来源默认和人工决定。

## 验收用例

1. 同一画廊同时命中「天奈」和「sabaoji」。从天奈入箱，作品绑定天奈。交换扫描顺序、改用旧扫描结果或在发布前再次扫描，归属都相同。若首次从 sabaoji 入箱，则绑定 sabaoji。
2. 来源配置为空，取消选择后没有新增收件条目。选择已有本站艺术家或创建新艺术家并确认，本批任务与来源设置使用同一份名单，下次从该来源入箱可直接使用。
3. 从「稍后决定」入箱前更换来源固定艺术家，取更换后的名单；入箱后再更换，已有任务名单保持原值。暂缓期间来源被删除，转入时可以选择或创建艺术家。
4. 手动粘贴多个链接，界面展示受影响条数，所有新建任务均保存本次指定的名单。原站含其他艺术家标签时，发布后标签可查，作品归属与本站选择一致。
5. 同一画廊从另一来源重复提交、重试发布、补全缺页或升级原图，已有人工整理的关系受到保留。
6. 本来源命中的有效本地作品没有艺术家时，使用补漏筛选可以找到它，包括从其他来源下载、原站有更新或残留旧待生效记录的情况。批量补绑后作品退出该筛选。尚未发布、已删除或已有生效艺术家的作品均不进入结果。

现行行为见[发现来源](../features/archive-discovery.md)和[创作者关系](../features/creator-relations.md)。
