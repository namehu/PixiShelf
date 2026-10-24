---
status: historical
scope: 第四阶段 App 阅读和个人整理守卫小批的独立差异审查；门禁保持3
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - docs/records/artwork-deduplication-app-personal-guards-2026-10-24.md
  - docs/security/access-control.md
  - packages/pixishelf/services/artwork-dedup-write-guard.ts
  - packages/pixishelf/services/reading-service.ts
  - packages/pixishelf/services/artwork-rating-service.ts
  - packages/pixishelf/services/media-mark-service.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-app-guards.postgres.test.ts
---

# App 阅读和个人整理守卫独立审查

2026-10-24，分支 `codex/artwork-deduplication`，基线 `6e8d4f4c98514c96233404e02acb241f0a1be20f` 上的冻结未提交小批。审查者未参与实现。本批差异未发现阻断问题；门禁保持3。本记录不代替 D4-02 全写入口验收，也不授权隔离文件动作。

## 范围与证据

审查新增 [artwork-dedup-write-guard.ts](../../packages/pixishelf/services/artwork-dedup-write-guard.ts)、[真实 PG 测试](../../packages/pixishelf/services/__tests__/artwork-dedup-app-guards.postgres.test.ts)，以及 [reading-service.ts](../../packages/pixishelf/services/reading-service.ts) 四处、[artwork-rating-service.ts](../../packages/pixishelf/services/artwork-rating-service.ts) 一处、[media-mark-service.ts](../../packages/pixishelf/services/media-mark-service.ts) 两处接点。既有 reading/rating 单测只新增守卫 mock；本次检查这些差异未覆盖原断言或隔离新真实 PG 文件中的守卫实现。

按 [App 接线分类](../design/artwork-deduplication/app-write-guards.md) 和 [权限边界](../security/access-control.md)，定向读取既有 Artwork 行锁、reader 索引加载、对应 reading/artwork/rating/media-mark 路由及错误格式化。冻结的 DB claims 产品代码没有改动，没有重审未接入的生产来源/文件入口。

读取实现者原始日志：`/private/tmp/dedup-app-guard-pg.log` 记录2/2通过（454ms），`/private/tmp/dedup-app-guard-regression.log` 记录五个相关文件67/67通过；App TypeScript 通过取自[实现验证记录](./artwork-deduplication-app-personal-guards-2026-10-24.md)，对应 types 日志为空，本审查未独立重跑。没有连接任何数据库、访问媒体或执行 native、全量测试、构建、规模或图示检查。产品代码全程只读，只新增本记录。

冻结实现 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `artwork-dedup-write-guard.ts` | `3ccc45364286b0fba79cf0d4ddd06f63c842a6dbd9dba99426d853311d79e4f9` |
| `reading-service.ts` | `32805b6716c4600021cd7a8feefc0970d8556fd87143f194d587890532f1a67b` |
| `artwork-rating-service.ts` | `13c73558a24240b2e624c538c8f7a23e931b49522aa7bf636a548f54c39c11eb` |
| `media-mark-service.ts` | `2dab8c4dd99535fbe8a7351475600d2be9a7948f5789f90d29c83400032fd5b6` |
| `artwork-dedup-app-guards.postgres.test.ts` | `8f654803c56df40cf976c1fd1c6f97eb1b8048f77028c04026850613450ecf4a` |

## 核验结论

| 核验点 | 代码位置与结论 |
| --- | --- |
| 原事务与锁序 | reading 第128/153/181/302行、rating 第46行、media-mark 第143/271行，均在原事务的 Artwork `FOR UPDATE` 锁后执行守卫；守卫复用同一个 tx。其 DB 原语只再锁同一 Artwork 并查询 Claim，不取得 source/root/catalog 锁。个人写入直到事务提交始终持锁，认领方与这些写者沿同一 Artwork 行串行。 |
| COPY 的隐式阅读写入 | reading 的 context/初始化接点在 loadMedia/loadReaderIndex 和 reconcileSummary 前；report/markRead 同样在 reconcileSummary、createMany、upsert 前。COPY 被拒绝，KEEPER 保持 READING 例外。reader 下游索引只查询作品/媒体，不反向取得根或来源锁。 |
| 评分、标记更新和清除 | ORGANIZATION 守卫早于读取/写入个人评分行和标记行，也早于幂等赋值返回。双方被声明时拒绝评分更新/清除、标记新增/清除和稳定 markId 删除，不会先删除旧私人事实再报冲突。remove 继续按 markId+Session userId 读取、锁所属 Artwork 后重读；他人或不存在的 mark 无写入返回。 |
| 账户边界 | 本批未改变路由或 Schema。reading（含 summaryGroupRead）、artwork.reader、rating 与 media-mark 都在调用服务前比较 expectedUserId，实际 userId 从 Session 取得。私人行查询仍使用该 userId；稳定 markId 不接受客户端替换 artworkId。匿名及账户切换的既有三组 auth 回归仍通过。 |
| 错误映射与隐私 | 新适配器第13–21行仅将明确的 ARTWORK_CLAIMED 转成固定中文 CONFLICT、NOT_FOUND 转成固定 NOT_FOUND；不附 operation、角色、路径或其他账户整理事实。其余错误原样抛出，没有吞掉数据库故障或默认放行；普通未知 Error 由既有 tRPC INTERNAL_SERVER_ERROR 格式化隐藏消息/stack。 |
| 回滚与证据 | 新 PG 直接建立真实 keeper/copy Claim，调用真实服务和 DB guard；已有评分/标记在拒绝后逐行相等，COPY 两张阅读表仍为零，KEEPER 四个阅读服务可用，未声明和跨账户隔离路径保持可用。测试不 mock 新守卫，旧 mock 仅隔离既有单测。 |

## 证据范围与后续门槛

新 PG 的 COPY 没有预置阅读摘要，因此它直接证明四个入口拒绝且不新增阅读行；没有单独触发现存过期摘要的 reconcile 更新。该分支已由守卫位于 reconcileSummary 之前的代码位置核验，不能将现有 PG 结果描述成已执行该专门夹具。评分夹具先存在 level 1，再尝试变为4或清除；新建评分同样经过守卫，但本例未单独验证另一账户的空评分新增。上述是证据精度边界，未发现相应实现绕过。

本批没有新增双连接 App 并发用例；串行保证来自共用真实 Artwork 行锁及前一 DB claims 批已验证的认领/写者锁互斥。不能把它扩展为所有尚未接入的扫描、上传迟到发布、结构级联、归档或普通回收入口已经完成并发验收。

后续按 App 分类继续接线；本次仅对本批七处与适配器作结论。用户删除、全来源发布、URL hold/drain、文件协议和释放仍以各自契约及独立记录为准。

## 文档检查

受影响既有文件 `git diff --check` 无输出；主应用大写路径扫描无命中。新增记录运行 `pnpm docs:check`，结果保存于 `/private/tmp/dedup-app-personal-guards-review-docs.log`。未改图源，不运行图示生成或图示检查。
