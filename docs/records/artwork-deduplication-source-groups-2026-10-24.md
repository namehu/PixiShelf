---
status: historical
scope: 有界来源证明 capture/assert 与页级集合锁的数据库实现和定向 PostgreSQL 验证；不含生产接线验收
last-verified: 2026-10-24
sources:
  - packages/pixishelf-db/src/artwork-dedup-claims.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-sources.postgres.test.ts
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/records/artwork-deduplication-pause-2026-10-24.md
---

# 有界来源证明与页级集合锁

2026-10-24，在 `codex/artwork-deduplication`、HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 的原有未提交现场继续。工作区为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`；本批实施使用 GPT-6 Astra/xhigh，完成后冻结交独立 Sol 6.1/xhigh 审查，本记录不代替审查结论。门禁保持3。

## 交付范围

在既有 `artwork-dedup-claims.ts` 新增 `ArtworkDedupCapturedSource`、单输入 `captureArtworkDedupSources` / `assertArtworkDedupSources`，及页级 `captureArtworkDedupSourceGroups` / `assertArtworkDedupSourceGroups`。单输入仍为一至两项；groups 一至10000组，保持现有输入冻结、意图与入队的原子事务。页级接口是接线确认后的必要调整：原有 CLIENT_LIST/local import 可一次冻结10000输入，Intake 一次提交最多100 URL，调用方不能循环单输入 helper 获得全局锁序。

接口、错误码与锁序的唯一正文位于[声明契约](../design/artwork-deduplication/claims-contracts.md#有界来源证明接口)。DB 用既有 jsonb SHA-256 编码，以 JSON recordset 一次处理输入；全根协调后统一按数据库 identityKey 排序插入/加锁。跨组共享身份去重，输出仍按两层输入顺序；组内重复拒绝。assert 不创建缺失来源，同时验证身份字段、原 sourceId、OPEN/空 owner 和 bigint generation。

旧单身份基础 helper 包装同一核心，仍不作为持久证明的生产发布入口。DB index 已有 `export *`，无需修改共享导出文件；未改变 Schema、迁移、job-contracts 或依赖关系。JSON 严格 version 1 parse/serialize 继续由调用方使用 job-contracts 完成。

## 验证环境和恢复依据

仅使用显式 `QUEUE_KERNEL_TEST_DATABASE_URL` 指向 `127.0.0.1:55432/dedup_data_next`，沿用已完成正式111迁移的合成专库。没有运行 deploy/generate/db:push，未访问真实数据库、真实媒体、主工作区或其他冻结/执行器专库。

新 PG 测试使用随机 `dedup-sources-<uuid>` 命名空间；只写来源夹具及用于回滚断言的合成 Artwork。业务失败场景事务整体回滚；提交的来源和本次新建空根行由 afterAll 按精确命名空间/ID清理，保留预先存在的根身份。无文件 I/O，无真实隔离/恢复/删除动作。该夹具清理是本批恢复依据，不代表生产备份或恢复演练。

| 检查                                             | 结果                          | 原始证据                                     |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------- |
| 新来源 helper PostgreSQL 套件                    | 10/10通过，最终耗时3.06秒     | `/private/tmp/dedup-source-groups-pg.log`    |
| DB TypeScript，额外启用 noUncheckedIndexedAccess | 通过                          | `/private/tmp/dedup-source-groups-types.log` |
| 主应用全小写路径检查                             | 无大写路径，rg退出1表示无匹配 | 本批工具输出                                 |

实际命令为 `pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-sources.postgres.test.ts`（显式专库环境）和 `pnpm --filter @pixishelf/db exec tsc --noEmit --noUncheckedIndexedAccess`。首次 PG 运行9项通过、1项因测试观察 SQL 的 `pg_blocking_pids` 参数需显式 integer 转换失败；修正测试并保证并发 promise 在失败时也等待收束后，最终完整新套件通过。该初始失败不涉及生产 helper 拒绝路径。

覆盖：输入/组上下界、非规范身份与 bigint、重复身份/ID、原 sourceId 交换或缺失、数据库身份字段不匹配、超过 JS 安全整数的代次、陈旧代次、HOLD/TOMBSTONE、两方向目录重叠、相邻目录段与根变化、单项失败整页业务写回滚、新来源插入回滚。10000组共享同一来源只保留一行；测试同时断言 capture/assert SQL 数量为常数级，不把该边界用例当独立来源规模或媒体性能验收。

真实并发用例同时提交40组×2个不同 provider 的正/逆序批次，验证创建与断言无 ABBA；持锁时另一连接触发 PostgreSQL lock_timeout，证明串行争用。根锁用例通过 `pg_blocking_pids` 观察另一事务确实等待根协调，此时第三连接仍可锁定 provider，证明未在根之前取得来源锁；另有两根/来源逆序批次并发通过。没有用 sleep 推断争用，也没有模拟 release 周期。

## 冻结与后续

| 文件                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `artwork-dedup-claims.ts`                | `08b6edabd545b326d87a5e6f1f87f25adac113e8069b66dca9ea6e12d035081a` |
| `artwork-dedup-sources.postgres.test.ts` | `228249798a8f3b8f2a148e9bfa59a745031e9b1441478fdc033538c88ca2a7a0` |
| `claims-contracts.md`                    | `73286ddaf3fb5534025e613682a1abdc6c7bf4d1ce09a50379ae3b5b57896fc1` |

App/Executor 生产冻结和消费由并行任务接线并单独提供验收；本批没有实现 release、双向重叠 generation 传播、URL drain、staging 文件动作或任何额外解锁 helper，也不替代原文件基础被平台阻断的独立复审。旧 null 证明不得通过重捕获当前代次升级。未重复全量 build/test 或50万规模测试，不宣称整个阶段完成。

文档检查239份通过，日志 `/private/tmp/dedup-source-groups-docs.log`；本批四文件 Prettier 检查和限定路径 diff --check 通过。图示检查首次因缺少捆绑 Playwright Chromium 未运行，改用本机已安装 Chrome（`WEBP_BROWSER_CHANNEL=chrome`）后通过，日志 `/private/tmp/dedup-source-groups-diagrams.log`；未下载浏览器或修改图源/生成图。全仓 diff 检查另见共享 records/README.md 的既有末尾空行，已通知统筹，由其合并时处理，本批未改该共享索引。

## 独立审查 P2：路径页重叠查询修复

原 Sol 审查发现，第一版重叠 SQL 只按逻辑根/根身份联接，随后对路径条件过滤，导致不相交输入与同根既存来源产生乘积。审查专库临时表证据 `/private/tmp/dedup-source-groups-review-plan.log` 中，1000个 HOLD PATH 与1000/10000输入分别产生100万/1000万候选过滤。10000组共享 provider 的常数查询测试未覆盖此成本。

修复只修改本记录、声明契约、claims.ts 和新来源 PG 套件。查询拆为精确路径、输入祖先匹配被持有目录、被持有祖先匹配输入目录三个完整键等值判定。两份祖先集合显式 MATERIALIZED；仅拆条件仍会被 PostgreSQL 重排为先按根联接再展开路径，新增计划回归实际捕获了这一失败，加入物化边界后通过。只有输入包含 DIRECTORY 才执行被持有祖先展开。没有新增索引、Schema、hash、锁类别或每输入 SQL，原根→来源锁序与整页事务保持。

新增一个边界用例和四个独立页计划用例：空根目录两个方向、目录自身、其他逻辑根、旧根身份；1000/10000个不同 PATH 或 DIRECTORY 各配1000个不相交既存来源（500 PATH HOLD、500 DIRECTORY TOMBSTONE）。每例创建 `LIKE ... INCLUDING ALL` 的事务临时来源表，复制现有约束/索引并 ANALYZE；生产 helper 真实执行 capture/assert，再对截获的同一 Prisma.Sql 执行 EXPLAIN ANALYZE，未另写简化查询。所有临时表和数据最终主动 rollback；没有修改或清除既存专库来源。

| 独立输入  | 输入数 | 全计划过滤数（含普通 Filter，按 loops 加权） | Join Filter 拒绝数 | EXPLAIN 执行毫秒（仅证据） |
| --------- | ------ | -------------------------------------------- | ------------------ | -------------------------- |
| PATH      | 1000   | 2500                                         | 0                  | 9.631                      |
| PATH      | 10000  | 10500                                        | 0                  | 84.092                     |
| DIRECTORY | 1000   | 1500                                         | 0                  | 16.228                     |
| DIRECTORY | 10000  | 500                                          | 0                  | 95.104                     |

断言采用计数边界 `8 × (输入数 + 既存持有数)`、零 Join Filter 拒绝及每页固定查询预算，不断言绝对耗时。两份 PATH 计划的 `CTE held_ancestors Actual Loops` 均为0，证明第三分支未展开。输入10000的 DIRECTORY 过滤少于1000例来自优化器采用既有索引；这些样本不构成全媒体规模验收。

最终同一专库的新来源套件15/15通过，总耗时8.19秒，日志 `/private/tmp/dedup-source-groups-p2-pg.log` 保存完整 JSON 计划、计数和测试结果；`pnpm --filter @pixishelf/db exec tsc --noEmit --noUncheckedIndexedAccess` 通过，日志 `/private/tmp/dedup-source-groups-p2-types.log`。修复期间的定向日志在 `/private/tmp/dedup-source-groups-p2-focused.log`。只运行本套件与必要类型检查，没有重跑全量 build、docs、diagrams 或50万规模验证。文件按以下散列重新冻结，待原 Sol 差异复审关闭 P2：

| 文件                                     | 修复后 SHA-256                                                     |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `artwork-dedup-claims.ts`                | `655019d3a12173fd1929214f88e97a8b397775934e7988509203a287c703636d` |
| `artwork-dedup-sources.postgres.test.ts` | `8807d0ccaf186d48f2cdaa2127b6e8ca54ceed6d0e0a0b159ad93040b1448d59` |
| `claims-contracts.md`                    | `b7a30a353547fb851ae0926080158aec4a76f2cf1c7ac0c795db720f5dfe216e` |

本修复不增加 release/drain、补捕获历史证明、生产文件动作或更高阶段授权；门禁和先前独立文件复审阻断维持原状。
