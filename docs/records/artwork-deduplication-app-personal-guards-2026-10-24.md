---
status: historical
scope: 第四阶段 App 阅读和个人整理守卫小批；门禁仍为3
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - packages/pixishelf/services/artwork-dedup-write-guard.ts
  - packages/pixishelf/services/reading-service.ts
  - packages/pixishelf/services/artwork-rating-service.ts
  - packages/pixishelf/services/media-mark-service.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-app-guards.postgres.test.ts
---

# App 阅读和个人整理守卫

2026-10-24，独立 worktree `artwork-deduplication/PixiShelf`，基线 `6e8d4f4c` 上未提交小批。未修改冻结的 claims/media-content-writes 代码；共用门禁仍为3，尚未开放隔离文件动作。

## 实现与冻结范围

新增 `services/artwork-dedup-write-guard.ts` 只把已知 DB 声明冲突转成固定中文 CONFLICT，把不存在转成 NOT_FOUND，其余异常抛出。现有事务先锁 Artwork，随后在同事务执行守卫，直到个人状态写入提交；不取得来源/根/catalog 锁。

接点为 reading-service 的 getReadingContext、getReaderInitialization、reportReading、markReadingRead；前两者查询会 reconcile 写摘要，也纳入 READING。评分 set（包括清除）及媒体标记 set/remove 使用 ORGANIZATION。KEEPER 可继续阅读；COPY 阅读拒绝，双方整理写拒绝。路由、输入 Schema、Session/expectedUserId 校验与私人行 userId 过滤未改。

本批精确文件：

- `packages/pixishelf/services/artwork-dedup-write-guard.ts`（新）。
- `packages/pixishelf/services/reading-service.ts`、`artwork-rating-service.ts`、`media-mark-service.ts`（七处事务接点）。
- `packages/pixishelf/services/__tests__/artwork-dedup-app-guards.postgres.test.ts`（新）；既有 `reading-service.test.ts` 与 `artwork-rating-service.test.ts` 仅隔离新守卫依赖，守卫真实行为由新 PG 用例验证。
- [App 写入口分类](../design/artwork-deduplication/app-write-guards.md)与本记录。
- 另按统筹批准，仅在[声明契约](../design/artwork-deduplication/claims-contracts.md)追加未来 DIRECTORY 释放时对子 PATH/DIRECTORY 传播 generation 的门槛，无释放实现；已通知独立审查者和执行器。

## 实际验证

仅用 `dedup_data_next`（loopback PG55432、正式迁移110）。夹具实际建立用户、作品、媒体、审核选择/操作与 Claim；调用真实 App services 和 DB guard，所有个人行在 PG 中核对。夹具直接建立 Claim，不重测先前认领流水线。结束按随机夹具的精确 ID 清理。

| 验证                                                      | 结果              | 日志                                          |
| --------------------------------------------------------- | ----------------- | --------------------------------------------- |
| 新 App 真实 PG 两例                                       | 2/2 通过，454ms   | `/private/tmp/dedup-app-guard-pg.log`         |
| 既有 reading/rating 服务与 reading/rating/media-mark auth | 67/67 通过，5文件 | `/private/tmp/dedup-app-guard-regression.log` |
| App TypeScript                                            | 通过（测试类型窄修后）    | `/private/tmp/dedup-app-guard-types.log`      |

新 PG 覆盖：COPY 四个阅读服务拒绝且阅读表零写；KEEPER 四个服务成功且阅读次数/已读数有效；KEEPER/COPY 评分新增/清除、标记新增/清除/稳定ID删除均拒绝且原私人记录逐行不变；无声明时原写入可用，另账户不能删他人标记或评分。三组既有 auth 回归覆盖匿名和 expectedUserId 变化拒绝。没有浏览器、全量构建或规模回归。

首次 PG 夹具因两成员已有保护信息却未保存保留者，被原审核规则正确拒绝；补真实 saveReview 后再冻结，2/2通过。首次 tsc 只发现测试 marks 数组隐式 any，补具体返回类型，不改生产逻辑。

## 未完成范围与续接

这不是 D4-02 全写入口验收。结构/排序/章节注册、标签/创作者级联、上传已完成收据迟到发布、来源同步、新建同来源、URL 回收/恢复及已排队删除仍按 App 分类表和执行器来源盘点逐批接入；不声称原两内容声明已覆盖所有发布路径。用户删除沿阶段3现有 NOWAIT 协议，本批未改。

可续接命令：专库 `QUEUE_KERNEL_TEST_DATABASE_URL` 下 `pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-app-guards.postgres.test.ts`。旧服务及 auth 用例按上述5文件定向执行，勿改用全套；无需重新部署或生成 Prisma。本批冻结后交独立差异审查，保持 gate3。

最终 `pnpm docs:check` 通过231份 Markdown（`/private/tmp/dedup-app-guard-docs.log`），受影响既有文件 `git diff --check` 无错误；主应用大写路径扫描无命中。本批无图源改动，不重复统筹者已有图示检查。
