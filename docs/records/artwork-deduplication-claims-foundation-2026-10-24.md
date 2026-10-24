---
status: historical
scope: 第四阶段全局作品和来源声明的数据库基础小批；不代表隔离入口或全写守卫验收
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-db/src/artwork-dedup-claims.ts
  - packages/pixishelf-db/src/media-content-writes.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-claims.postgres.test.ts
---

# 作品和来源声明基础验证

2026-10-24，worktree `artwork-deduplication/PixiShelf`，提交基线 `6e8d4f4c` 上的未提交改动。共享门禁保持3；本批只提供第四阶段数据库事务原语与两个既有写入原语的互斥接点，等待独立代码审查。

## 冻结文件与行为

- `packages/pixishelf-db/src/artwork-dedup-claims.ts`：全局 keeper/copy 认领、稳定来源身份与 generation 校验、路径和目录段重叠保护、持久 URL hold、五种 Artwork 写入守卫。
- `packages/pixishelf-db/src/media-content-writes.ts`：仅在已有根锁后检查来源 hold、已有 Artwork 锁后检查 Claim，继续返回/抛出原 WRITING 语义。
- `packages/pixishelf-db/src/index.ts`：仅本批新增 claims 模块导出；该文件其他未提交导出属于此前批次。
- `packages/pixishelf-db/src/__tests__/artwork-dedup-claims.postgres.test.ts`：本批七条真实 PG 用例。
- [声明契约](../design/artwork-deduplication/claims-contracts.md)及本记录。

复用107–110表与既有 creator catalog、根目录、Artwork 锁；没有新增迁移或全局锁。认领使用集合 SQL，文件全集不加载到 JavaScript。锁序和调用签名以契约为准；调用方必须持有现有 runtime fence，冲突向外抛出使整个事务回滚。

## 定向结果

独立 loopback PostgreSQL `dedup_data_next`，正式迁移110，测试前缀为随机 UUID。只写测试创建的队列、作品、证据和声明；结束按精确 ID 清理。没有文件系统动作、数据库恢复或真实媒体操作。

| 检查                                                                      | 实际结果                  | 原始输出                                         |
| ------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| 新 claims PostgreSQL 文件                                                 | 7/7 通过，1.654秒测试时间 | `/private/tmp/dedup-claims-tests.log`            |
| 受影响旧写入原语两例（READY upload gated、exact live source token range） | 2/2 通过，其余16跳过      | `/private/tmp/dedup-claims-media-regression.log` |
| DB TypeScript                                                             | 通过                      | `/private/tmp/dedup-claims-types.log`            |
| 主应用路径大小写扫描                                                      | 无命中（本批未改主应用）  | `rg --files packages/pixishelf \| rg '[A-Z]'`    |

`pnpm docs:check` 已通过228份 Markdown（`/private/tmp/dedup-claims-docs.log`）；两个既有文件的 `git diff --check` 无错误。本批没有改图源，不重复统筹者已完成的图示检查。

七例证明：keeper/copy 同操作同版本幂等与旧 operation version 拒绝；主动回滚不遗留来源、绑定或 Claim；跨艺术家共享作品在前一个写者结束后仍受持久声明保护；先有路径/内容写声明拒绝认领；认领事务持锁时第二连接真实 `lock_timeout` 冲突，提交后两个旧写入原语均拒绝；仅 keeper 的 READING 放行，ORGANIZATION/STRUCTURE/CONTENT/DELETE 拒绝；provider 来源 generation 变化拒绝旧发布；完整目录段不会把 `a` 误当 `ab`，根变化保留 tombstone；普通过期时间及 Artwork 删除不会消除持久 URL hold。

运行中发现的测试夹具问题已修正：同一 suite 的目录前缀包含前例仍持有的来源，导致过宽 capture 正确拒绝；改成当前用例独立身份后七例全部通过。目录身份测试只证明数据库路径重叠规则，不声称已核验真实目录归属。跨艺术家测试遵守现有单 BACKGROUND_WRITER 约束，以任务交接验证持久保护；并发行锁另由双连接用例证明。

## 限制与续接

本批不接全部 App、扫描、下载、归档 publisher、普通回收或恢复入口；不能据此宣称全系统已受守卫。来源 generation capture/publication 仍待对应生产写者采用。没有隔离、恢复、永久删除、释放 Claim/source、执行 drain 或 native 文件动作；无浏览器、全量构建或规模测试。认领测试使用真实数据库与合成准备证据，不替代完整第四阶段新鲜内容校验或文件清单协议验收。

后续释放必须以完整文件收据、终态和原 operation/version CAS 为前置；本批故意不提供宽泛释放 helper。URL 过期测试直接建立持久领域事实，未运行普通回收任务。现有两个写原语的回归不能替代未来全部调用点审计。

续接定向命令：为专库设置 `QUEUE_KERNEL_TEST_DATABASE_URL` 后运行 `pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-claims.postgres.test.ts`；旧原语使用 `pnpm --filter @pixishelf/db exec vitest run src/__tests__/media-content.postgres.test.ts -t 'READY upload gated|exact live source token range'`。代码未经独立复审前保持本批冻结，不提高门禁。
