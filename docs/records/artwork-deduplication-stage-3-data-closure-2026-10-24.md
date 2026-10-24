---
status: historical
scope: 去重阶段三数据专项验证、鉴权ID封面及维护reader恢复接口
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/security/access-control.md
  - packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts
  - packages/pixishelf/services/artwork-dedup-cover.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf/app/api/artwork-dedup/cover/[artwork-id]/route.ts
---

# 阶段三数据接口收口批次

2026-10-24，额度于01:41恢复后按统筹授权继续。工作树 codex/artwork-deduplication，当前未提交。三项首批P2已由原独立审查者正式关闭；本批只补阶段三，不实现第四/第五阶段文件动作或全写入口guard。`ARTWORK_DEDUP_RELEASE_STAGE=2` 未改变。本记录是实现与定向验证证据，仍需独立审查与集成验收。

## 改动

- 新增真实PG专项用例，覆盖全库跨CHAPTER、metaSource和ArchiveRevision manifest引用，调用方伪称VERIFIED仍变为SHARED/BLOCKED；重复COPY物理路径不能放大可释放容量；单成员页面快照与最终全范围验证有区别，未知成员拒绝。
- 归档封印专项使用真实PG表，核对sealed/drained、持久摘要一致、ImportItem与Image/检测证据的精确一一映射。真实pageIndex独立于Image排序返回；未drain、封印摘要变化、媒体摘要变化、重复映射、大小变化均拒绝。fixture故意直接构造DB证据，不代替执行器线生产DOWNLOAD→PUBLISH链验收；执行器已另报完整链2/2通过。
- 新增 `GET /api/artwork-dedup/cover/:artworkId?expectedUserId=...`，独立Session及账户切换核验；活动、未删除且无COPY声明的作品才能读取。使用当前作品第一登记图片或已有视频poster，真实路径与隐藏目录二次校验，流式读取；不生成、不重编码、不重定向原媒体。响应private/no-store、Vary Cookie、no-referrer、nosniff，错误不返回路径。SVG不作为该封面路由的可用图片类型。
- 成员DTO的封面URL来自一次有界LATERAL查询，每个已请求作品仅第一媒体，不加载完整媒体数组或全库；没有可用封面仍null。URL只含Artwork ID与当前expectedUserId，无原路径。其他账户ID及私人内容仍不输出。
- 新增维护reader离线inspect/recover helper，沿既有dispatcher→lane/job→run/operation锁与全writer/租约/Worker心跳停止核验。摘要绑定operation状态/版本、执行版本、job身份/attempt/status、原token/state/owner；错误确认、过期摘要或token均拒绝。成功只清占用、增version并审计，保留BUILDING与全部冻结内容。
- `isArtworkDedupPrepareRetryable` 同时用于DTO和真实领域mutation。允许原FAILED/FAILED或BUILDING/PAUSED且原job/payload匹配、无取消意图、reader IDLE/null、无有效lease；原operationId/范围不变，新executionVersion入队，幂等重放不再入队。列表一次批量取对应job，详情只读自身job。实际公开API仍被stage2门禁拒绝。

## 定向验证

只使用 `dedup_data_next`（loopback55432，正式110），临时图片写 `/tmp`，未读取真实媒体、未操作dedup_scale、未启动浏览器。没有新schema或迁移。

| 范围 | 结果 | 原始日志 |
| --- | --- | --- |
| DB跨角色/容量/单成员/离线恢复 | 6/6通过 | `/tmp/dedup-stage3-data-boundaries-final.log` |
| DB归档封印/映射 | 1/1通过 | `/tmp/dedup-stage3-archive-evidence-retry.log` |
| 鉴权封面Route | 10/10通过 | `/tmp/dedup-stage3-cover-resume.log` |
| PAUSED继续真实PG（仅测试模拟stage3） | 1/1通过 | 同上 |
| 既有API游标/门禁/FILES范围/私人投影 | 4/4通过 | 同上 |
| DB类型检查 | 通过 | `/tmp/dedup-stage3-data-tsc.log` |

归档专项首轮fixture在新增Image后尝试update已被阶段一失效触发器删除的Fingerprint而失败，已改为按新的sourceRevision重新创建该测试指纹；重跑同一文件通过，保留首轮 `/tmp/dedup-stage3-archive-evidence.log`。App最终类型检查通过（`/tmp/dedup-stage3-app-tsc-final.log`）。docs:check 220份Markdown通过（`/tmp/dedup-stage3-docs-check.log`），全小写路径检查无输出。未改图源，不启动图表浏览器检查。App首次类型检查只发现并行新增maintenance-executor的progress缺失必填字段；对应实现者已修复，最终检查已通过。本批没有回避产品断言或放松既有约束。

离线恢复测试含真实另一个PG事务占用dispatcher锁，必须受控拒绝；ACTIVE job拒绝、确认缺失、错误token、operation版本改变使digest失效、合法恢复及恢复后重复请求拒绝都已断言。App继续测试拒绝尚未证明退出的reader，并验证DTO动作与mutation一致、新job优先级900/BACKGROUND_WRITER、幂等和冻结范围不变。封面测试含匿名、切换账户、删除/回收/不存在、COPY声明、隐藏实际路径的可见符号链接别名、越界路径、有效图片和已有视频poster。

## 本批冻结文件

新增：

- `packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts`
- `packages/pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture.ts`
- `packages/pixishelf-db/src/__tests__/artwork-dedup-maintenance-boundaries.postgres.test.ts`
- `packages/pixishelf-db/src/__tests__/artwork-dedup-archive-evidence.postgres.test.ts`
- `packages/pixishelf/services/artwork-dedup-cover.ts`
- `packages/pixishelf/services/__tests__/artwork-dedup-resume.postgres.test.ts`
- `packages/pixishelf/app/api/artwork-dedup/cover/[artwork-id]/route.ts`
- `packages/pixishelf/app/api/artwork-dedup/cover/[artwork-id]/__tests__/route.test.ts`

修改：DB `src/index.ts`仅新增恢复模块导出；`artwork-dedup-ownership.ts`将引用按唯一根/路径先聚合，避免最终全清单相关子查询反复扫描或相同路径形成两两关系；App `services/artwork-dedup-review-service.ts`的封面投影、操作DTO/job读取和PREPARE继续条件；其既有 `services/__tests__/artwork-dedup-review-service.postgres.test.ts`增加ID封面断言；`phase-3-contracts.md`恢复段；`access-control.md`新鉴权媒体读取边界；本记录。没有改动三项P2的判断/冻结语义，没有改Executor/Worker/UI代码。

## 交接边界

执行器负责CLI run/operation严格互斥、固定同机退出证明与Worker注册，使用本批DB helper；不能将lease过期当退出，不能直接SQL清token。未知owner仍需离线确认并通过数据库停止检查。高级真实入口继续关闭，第四/第五阶段声明/来源hold/drain/所有写入口guard及文件动作不在本批。封面可用性是当前请求可见性检查，与普通媒体读取一样不构成对外部存储并发变更的永久保证。

统一浏览器与最终全量构建仍留统筹最后执行；本批不重复第二阶段规模测试。后续审查只需对本批冻结文件和直接调用链复核，保留先前三项P2关闭结论。

冻结时刻01:54：22项定向用例通过；最终归属SQL集合聚合修改后，仅重跑相关6项全部通过。App最终tsc通过，DB类型通过；无遗留测试进程、无提交。数据线本轮停止新增改动，等待独立审查和统筹下一项安排。
