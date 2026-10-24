---
status: historical
scope: 冻结的有界来源证明 groups 增量独立审查；仅数据库 capture/assert，不含文件动作或生产接线验收
last-verified: 2026-10-24
sources:
  - packages/pixishelf-db/src/artwork-dedup-claims.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-sources.postgres.test.ts
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/records/artwork-deduplication-source-groups-2026-10-24.md
---

# 有界来源分组证明独立审查

2026-10-24，按指定 GPT-6.1 Sol / xhigh 对 `codex/artwork-deduplication`、HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 的未提交现场进行独立窄审。工作区为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`。初审只新增本记录，没有修改生产实现、测试、契约或其他协作者文件。初审发现一项 P2，随后对修复差异复审确认关闭，详见本文末节；当前窄审无未解决的可行动问题。不能据此提高发布门禁3。

## 审查对象与固定版本

| 冻结文件                                                                     | SHA-256                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/pixishelf-db/src/artwork-dedup-claims.ts`                          | `08b6edabd545b326d87a5e6f1f87f25adac113e8069b66dca9ea6e12d035081a` |
| `packages/pixishelf-db/src/__tests__/artwork-dedup-sources.postgres.test.ts` | `228249798a8f3b8f2a148e9bfa59a745031e9b1441478fdc033538c88ca2a7a0` |
| `docs/design/artwork-deduplication/claims-contracts.md`                      | `73286ddaf3fb5534025e613682a1abdc6c7bf4d1ce09a50379ae3b5b57896fc1` |

同时审阅本批[实施记录](./artwork-deduplication-source-groups-2026-10-24.md)。审查重点为新增 single/groups 包装、数据库身份键权威、身份/sourceId/bigint generation 绑定、跨组共享与组内去重、全根先于来源的锁顺序、页级回滚和查询规模。既有 claim/path guard 只阅读必要依赖，没有重复上一批基础审查。

## 初审问题与证据

### P2：路径页与同根 HOLD 来源形成成对扫描（修复后已关闭）

位置：`packages/pixishelf-db/src/artwork-dedup-claims.ts` 第144–148行。

重叠检查只以 `logicalRoot`、`rootIdentity` 连接输入与既存来源，再在联接过滤器中比较精确路径和双向目录包含。对同根不相交的输入，数据库仍需检查每个输入与每条 HOLD/TOMBSTONE 的组合。合法的10000组不同 PATH 页会放大已有持久来源集合；这段查询执行时已经持有根协调锁，因此也延长同根其他捕获、声明和内容写入的等待。SQL 往返数量固定不能消除这一复杂度。

受限复现仅连接 `127.0.0.1:55432/dedup_data_next`，在单事务中创建 `LIKE ArtworkDedupSourceIdentity INCLUDING ALL` 的临时表，插入1000条同根 HOLD PATH 并 `ANALYZE`，使用与实现相同的连接及重叠谓词执行 `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)`。输入和 held 分别使用不相交的 `input/<n>` 与 `held/<n>`，命名空间为 `dedup-source-groups-review-20261024`，每条 SQL 使用8秒 `statement_timeout`。

| 输入 PATH 数 | HOLD PATH 数 | 执行计划                           | 被联接过滤器排除的候选数 | 耗时        |
| ------------ | ------------ | ---------------------------------- | ------------------------ | ----------- |
| 1000         | 1000         | 按根 Hash Join，路径为 Join Filter | 1,000,000                | 113.065 ms  |
| 10000        | 1000         | 按根 Hash Join，路径为 Join Filter | 10,000,000               | 1136.477 ms |

这是规模行为的受限证明，不是全系统性能门槛。10000个不同 PATH 对应已约定的 CLIENT_LIST 输入上限；同根既存1000条 HOLD 只需有限维护批次即可出现。LOCAL_DIRECTORY 页使用 DIRECTORY，仍会走相同的按根候选组合，但本次没有额外测量该分布，不推定其耗时。

建议最小修正：将精确路径和两向目录重叠拆成可按路径键匹配的集合查询，复用现有 claim 中按规范路径段展开祖先的有界方式，避免只按根形成输入与既存来源的成对联接。保留全部根先锁、数据库统一身份键、集合 SQL 和完整路径段语义，不新增身份编码或执行框架。增加独立路径页加不相交 held 来源的受限计划/计数回归；现有测试第129–138行的10000组共享同一 PROVIDER 会去重为一条且跳过路径重叠，不能覆盖该退化。

证据脚本：`/private/tmp/dedup-source-groups-review-plan.sql`；原始计划：`/private/tmp/dedup-source-groups-review-plan.log`。两次测量完成后事务显式 `ROLLBACK`，临时表自动清除；未向业务表持久写入夹具，没有访问真实媒体或其他数据库。这是本次验证的恢复依据。

## 其余审查结果与限制

静态审查未发现本批其他可行动问题：单输入一至两项、groups一至10000组及组内重复拒绝；跨组共享统一去重且恢复两层输入顺序；身份键仍由同一个 PostgreSQL jsonb SHA-256 表达式计算；assert 不插入来源，锁后核对完整身份字段、原 sourceId、OPEN/空 owner 与原 bigint generation；所有根协调在来源插入和来源行锁前取得，来源按数据库 C 排序；异常继续向外抛出，使调用事务回滚。这些结论只覆盖本次阅读的增量和直接依赖，不替代生产调用方事务、fence 和完整 groups 接线验收。

读取并核对实施者的定向 PostgreSQL 日志 `/private/tmp/dedup-source-groups-pg.log`：10/10通过，含真实锁争用、逆序批次、失败回滚与共享来源常数查询。没有机械重跑该套件或类型检查；本审查新增执行仅为上述两次受限 EXPLAIN ANALYZE。未运行全量 build/test、图示或50万规模测试。

release、双向重叠 generation 传播、drain、staging/文件动作、App/Executor 生产接线不属于本批已审范围。历史 native 文件基础独立复审仍被平台阻断；本次没有访问或绕行该项，也不声称其通过。没有进行生产验收。

记录交付检查：本记录 Prettier 与限定文件 `git diff --no-index --check` 无问题；主应用大写路径扫描无命中；`pnpm docs:check` 通过241份 Markdown，日志 `/private/tmp/dedup-source-groups-review-docs.log`。未改图源，按本次窄审约定未运行图示任务。交付前再次核对上述三份冻结文件哈希，均未变化。

## P2 修复差异复审

同日对原实施者重新冻结的四文件增量进行了差异复审，仅更新本记录。结论：原 P2 已实质解决，未发现修复引入的新可行动问题。本节覆盖下列散列；前文原问题、行号和证据保留为初审历史。

| 文件                                                                         | 修复后 SHA-256                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/pixishelf-db/src/artwork-dedup-claims.ts`                          | `655019d3a12173fd1929214f88e97a8b397775934e7988509203a287c703636d` |
| `packages/pixishelf-db/src/__tests__/artwork-dedup-sources.postgres.test.ts` | `8807d0ccaf186d48f2cdaa2127b6e8ca54ceed6d0e0a0b159ad93040b1448d59` |
| `docs/design/artwork-deduplication/claims-contracts.md`                      | `b7a30a353547fb851ae0926080158aec4a76f2cf1c7ac0c795db720f5dfe216e` |

### 修复实质与语义核对

claims 第145–163行把原混合重叠谓词拆为三条集合等值判定：精确路径；输入路径祖先与既存 held DIRECTORY；既存 held 路径祖先与输入 DIRECTORY。三者均以完整 `(logicalRoot,rootIdentity,canonicalPath)` 键匹配。两份祖先集合显式 MATERIALIZED，使路径展开先于最终键匹配；第三条由是否存在输入 DIRECTORY 的 CASE 控制，PATH 页无需展开既存来源祖先。根筛选仍是半联接，不输出输入与 held 的成对候选。

对现有规范路径，三条判定与原完整路径段重叠语义等价：祖先集合包含路径自身和空根，因此目录自身、空根覆盖及两个方向的包含均保留；`a` 与 `ab` 不共享相应路径键；逻辑根和根身份同时参与匹配。新增边界测试第262–321行覆盖空根两个方向、目录自身、其他逻辑根与旧根身份，原双向包含和相邻段用例保留。

第140行仍先取得全部根协调，重叠检查后才在第166–173行按统一 identityKey 排序插入（仅 capture）和锁来源。身份键计算未变，没有新增 JS 身份编码、索引或锁类别。第175–179行完整身份与 OPEN/空 owner 核对、第226行 assert 使用非 capture 模式、第229–230行原 sourceId/generation 比对均保留。拒绝仍向外抛出，未增加补行、补代次、局部成功或捕获后继续提交路径。

### 已核对的修复证据

独立读取并解析 `/private/tmp/dedup-source-groups-p2-pg.log` 的四份完整 JSON 执行计划，确认实际联接条件、过滤计数和祖先分支执行次数与实施记录一致：

| 独立输入  | 输入数 | 既存 held 数 | 全计划过滤数（按 loops 加权） | Join Filter 拒绝数 | held_ancestors loops | 执行毫秒 |
| --------- | ------ | ------------ | ----------------------------- | ------------------ | -------------------- | -------- |
| PATH      | 1000   | 1000         | 2500                          | 0                  | 0                    | 9.631    |
| PATH      | 10000  | 1000         | 10500                         | 0                  | 0                    | 84.092   |
| DIRECTORY | 1000   | 1000         | 1500                          | 0                  | 1                    | 16.228   |
| DIRECTORY | 10000  | 1000         | 500                           | 0                  | 1                    | 95.104   |

夹具为500 PATH HOLD和500 DIRECTORY TOMBSTONE，路径与输入不相交。测试第324–413行截获真实 helper 的 Prisma.Sql 后对同一语句执行 EXPLAIN ANALYZE，并以过滤工作量及零 Join Filter 拒绝断言回归，不用绝对耗时作为通过条件。临时表复制既存约束/索引，capture/assert 真实执行，事务最后主动 rollback；没有将简化查询冒充生产查询。

同一日志记录最终15/15通过，涵盖先前真实锁争用、整页回滚及不补来源行用例；实施者的严格 DB 类型检查记录为通过，日志 `/private/tmp/dedup-source-groups-p2-types.log` 无诊断。本轮独立复审没有重复套件、类型检查或新增数据库写入，新增执行仅为冻结哈希核对、代码/测试差异阅读及原始 JSON 计划解析。没有执行全量 docs、diagrams、build/test 或50万规模验证。

本轮记录更新仅运行限定 Markdown 的格式与 diff 检查，并再次扫描主应用大写路径；前文241份 docs:check 是初审交付时证据，本轮没有将其冒充为修复后的全量文档检查。生产接线、release、双向 generation 传播、drain和文件动作仍未验收，历史 native 文件基础被平台阻断的独立复审维持原状。
