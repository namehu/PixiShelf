---
status: partial
scope: D3-05 的 50 万媒体记录 HTTP、有界 PREPARE 窗口与 SQL-only 清单测量
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/03-review.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-prepare.ts
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf-db/src/artwork-dedup-ownership.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# D3-05 有界规模测量

**结果部分完成。** 在含 500,000 条媒体记录的隔离库中，真实 Next HTTP 启动请求、100 行预览/旧游标续页、两段约 10 秒的真实只读 PREPARE 均完成。另一个 SQL-only 500,000 行文件清单先后暴露缺失成员查询和全量 ownership 回写超时；两项窄修经独立复核后，最后仅续接一次，在生产 30 秒事务预算内以 STALE/OWNERSHIP_CHANGED 原子完成，完整判断 500,000 行、只回写 100 条诊断。有效清单的最终字节聚合仍未执行。不能据此宣布全量 PREPARE 完成，也不能把 SQL 合成清单当作完整文件系统检查证据。

## 样本与边界

时间为 2026-10-24 02:10–02:14（Asia/Shanghai）。代码为 `c2d6be73` 后已独立审查的只读 PREPARE/编排工作区与数据线 gate 3 集成版本；没有为此构建 App/Worker，没有运行阶段二 hash 测量。文件写基础的独立复审仍被平台拦截，ISOLATE/RESTORE/PURGE 未开放。本测量没有移动、删除或写入任何原媒体。

- 新建库 `dedup_prepare_scale`，在确认源库 `dedup_scale` 没有连接后使用 PostgreSQL TEMPLATE 克隆；没有终止源连接、修改源库、冻结代码或实际媒体。只对新库从正式 106 部署至 110，没有 db:push/generate。
- 克隆前宿主可用 49 GiB、Docker 数据卷可用 7.1 GiB，源库 1,617 MB；克隆后的数据库和测量文件保留作为失败证据，不是生产备份或恢复演练。
- 复用已完成检测 run `2c32027d-e5df-4237-90b9-306669eefab1`（version 271）：1,000 作品、500,000 媒体记录，**500 个共享实际路径**，位于原合成根 `/tmp/dedup-scale-phase2-all`。本次只读 stat，不新增 500,000 个实体文件。
- 推荐范围为 1 个重复组，1 个 KEEPER、999 个 COPY。共享路径应得到 SHARED/BLOCKED，不能把该样本解释为 500,000 个独占可隔离文件。
- 新库专用合成用户/会话，独立 Next dev `127.0.0.1:5441`，一次服务启动；没有浏览器、没有改动用户 5430。服务启动 2.2 秒，首个路由请求包含约 2.23 秒按需编译/认证时间。所有测量都是本机存储与开发服务结果，不是 NAS 吞吐或生产 p95。

## 真实 HTTP 与文件检查窗口

operation `73967b32-89a6-476a-9245-cd7cc6aba9d9`，job `95d73c16-965c-4bd1-bee0-278a48bf0894`。

| 项目 | 观测 |
| --- | --- |
| `prepareCleanup` HTTP | 200，145.43 ms，请求 JSON 260 B，响应 781 B |
| 持久 job payload | 92 B，仅 operationId / executionVersion / mode |
| 第 1 片 | 10,189 ms，1,650 次 inspect；preparedFiles=1,650，afterArtworkId=1,011 |
| 第 2 片 | 10,106 ms，1,700 次 inspect；preparedFiles=3,350，afterArtworkId=1,014 |
| 每片退出 | reader IDLE/null；job RETRY_WAIT，持久 attempt=0，约 3 秒冷却 |
| 内容读取 | 两片 reads=0、bytesRead=0，没有 hash |
| inventory 应用端最大页 | Image 51（50+lookahead）；DedupMedia 50；OperationArtwork 1；原始 SQL 返回数组最大 1 |
| 100 行预览 | 第 1/2 片后 51.57 / 47.40 ms，27,036 / 27,037 B |
| 旧游标续看 | 第二片后使用第一片游标，200、100 行，28.41 ms、27,023 B |
| 执行器测量进程内存 | 100 ms 采样 max RSS 170,180,608 B（162.3 MiB）、max heap 53,484,272 B |
| reader 内存 | 两片 childPeakRss 108,363,776 / 105,218,048 B |

仅运行这两片；3,350/500,000 条库存检查不代表目录 INSPECT/VERIFY 全部完成。旧游标被接受且继续返回 100 行，未验证 BUILDING 期间新增随机 fileId 对全量遍历的快照一致性。HTTP 在片间读取，没有并发 HTTP 压测，浏览器刷新交互也未在本轮重验。进程内存采样不包含 PostgreSQL 总内存；Next 服务一次 RSS 快照 308,416 KiB，不是峰值。

测量完成后通过现有 CANCEL API 取消该 operation，保留 3,350 行与检查点，防止后续通用 worker 意外继续整批运行。取消不清 reader token，reader 已由执行器正常确认 close。

## SQL-only 500,000 行清单

单独 operation `8e09708b-7a3a-45d9-98f3-64c0b08b481d`，job `41b73562-96fb-4a50-9a9b-2111ce94fffd`。通过真实 HTTP 冻结范围，再以单次 INSERT SELECT 从克隆的阶段二证据产生 500,000 个文件行，耗时 17,906.70 ms。SQL 夹具显式合成 `linkCount=1`、FILE 类型、VERIFIED 检查状态及 inventory/inspection 完成标记；这些值**不是本轮 reader 的证明**，仅用于测量分页和最终关系核验。没有启动 reader 或访问媒体内容。

| 项目 | 观测 |
| --- | --- |
| 新 `prepareCleanup` HTTP | 200，142.44 ms，响应 781 B |
| 500,000 行中第 1 页 | 100 行，609.12 ms，24,723 B |
| 第 2 页 | 100 行，436.37 ms，24,634 B |
| 进程 max RSS / heap | 183,517,184 / 37,780,288 B，应用未加载完整文件数组 |
| `completeArtworkDedupPrepare` | 30,127.65 ms 后失败，SQL 57014 / statement timeout；事务回滚 |
| 停止位置 | `packages/pixishelf-db/src/artwork-dedup-review.ts:287–288` 的 missing 成员计数，单 SQL 30,001 ms |
| ownership 与最终 logicalBytes 聚合 | 尚未执行，不能报告通过或耗时 |

所有连接设置 `statement_timeout=30000`；未增加上限、未重跑该查询。超时不是 JS 假造计时，日志包含 PostgreSQL statement timeout 和 ROLLBACK。正式最终快照复核查询在此之前 79 ms 完成。

首次大批量 INSERT 后立即进入核验，OperationFile 的 autoanalyze 于 `2026-10-23T18:13:02.342Z` 才完成，因此首次结果包含新表统计信息时点的影响。随后只读取了**不带 ANALYZE 的估算 EXPLAIN**：MEDIA 子计划仍使用 `(operationId, artworkId, fileId)` 索引，再 filter imageId/role；外层为约 500,000 行 Image 的 Hash Join。已存在唯一 `(operationId, referenceKey)` 索引，可由数据线评估精确 `media:<id>` / `chapter:<id>` 寻址并保留身份核对。估算计划不是第二次实测，也不能单凭此次结果断言所有生产形态都会超时。

此性能阻塞已交数据 Astra，后续只在保留的新库/operation 上做单查询窄修复与复核；无需重跑两片 I/O 或完整 HTTP 轮次。交接时 SQL operation BUILDING/INVENTORY、reader IDLE/null，测量进程已退出；job 尚 RUNNING 且租约等待正常到期/回收，没有手动清占用或伪造完成。不要直接启动通用 worker 消费此 SQL-only 夹具。

## 缺失查询修复后的单次续接

2026-10-24 02:19，仅复用上述 SQL-only operation 和 500,000 行，没有重跑 HTTP、两片 reader、导入或 hash。数据线缺失成员查询改为规范 referenceKey 定位既有唯一索引，详见[缺失成员窄修记录](./artwork-deduplication-prepare-query-2026-10-24.md)。

使用现有 `recoverExpiredExecution('BACKGROUND_WRITER')` 正常回收 attempt 1 的过期租约，再正常 claim 同 job（attempt 2）；未直接改 job 状态、清 lease 或 reader token。`SHOW statement_timeout` 确认为 30s，测量事务超时保持原 35s，lease 默认 60s；该测量事务配置不改变 Worker 默认 30s 事务配置，不能据此声称满足生产总事务时限。

| 项目 | 观测 |
| --- | --- |
| 修后完整性 missing 查询 | 2,403 ms，通过 |
| 全量 ownership UPDATE | 30,019 ms，SQL 57014 statement timeout |
| 最终事务总时间 | 32,594.34 ms，ROLLBACK |
| 最终 totals / logicalBytes | 未执行 |
| 测量进程 max RSS / heap | 158,957,568 / 36,226,896 B |

停止于 `artwork-dedup-ownership.ts` 的 `refreshArtworkDedupFileOwnership` 全量 `WITH files AS MATERIALIZED ... UPDATE`。只补取不带 ANALYZE 的估算 EXPLAIN；计划包含文件全集物化、按地址分组、多个 Hash Join/聚合和全量 UPDATE，尚没有执行节点级耗时证据，不能据估算自行指定根因。读取统计时点为 `2026-10-23T18:19:54.474Z`：OperationFile reltuples=503,350，relpages=29,624，last_autoanalyze=18:13:02.342Z，n_dead_tup=386,409。该更新超时已回滚逻辑变更，但留下的物理死元组及缓存状态是后续比较的限制；没有为优化成绩主动 vacuum/analyze 或重试。

新证据：`/private/tmp/dedup-prepare-scale-finalize.mts`、`dedup-prepare-scale-finalize.log`、`dedup-prepare-scale-finalize-result.json`（SHA-256 `aef541ea23777cdb2f0e3c2acd14ac9178df00a23840f5c58f3d34dcb73f9d1c`）；估算计划 `dedup-prepare-scale-ownership-plan.sql` / `.json`（JSON SHA-256 `ad90bfbfc17dea4e05fc9b2b9e76e24d7b722159068ef81ff21f555d82b04cbc`），统计 `dedup-prepare-scale-ownership-stats.txt`。

所有权查询超时已交数据线，保留同库同 operation 供最小诊断；本轮不再尝试。测量进程已经退出，reader 从未启动。job attempt 2 的租约继续交由既有正常回收处理，未伪造终态；不要启动通用 Worker 消费此 SQL-only 夹具。D3-05 的完整 SQL 最终核验、生产总事务预算和真实 500,000 文件全过程仍未闭合。

## 有界 ownership 独立复核后的最后一次续接

2026-10-24 02:36，在[独立数据复核](./artwork-deduplication-stage-3-data-review-2026-10-24.md)确认有界回写与 STALE 生命周期后，只对同一 SQL-only operation 再执行一次完整 `completeArtworkDedupPrepare`。没有新增场景、导入、HTTP、文件检查或 hash。本次使用 **生产总事务预算 30,000 ms**，`SHOW statement_timeout`=30s；没有沿用前两次的 35s 测量事务。

正常 `recoverExpiredExecution` 回收 attempt 2 的旧执行，再正常 claim attempt 3；无直接状态修改或清 token。原 `withFencedExecutionTransaction` 中执行 complete helper 与 scope.complete，事务成功提交后再读取最终状态并断言：

| 项目 | 结果 |
| --- | --- |
| 完整围栏事务 | **5,134.59 ms**，提交成功 |
| missing 成员查询 | 2,318 ms |
| ownership 完整判断＋有界回写 | 2,664 ms；changedFiles=500,000、updatedFiles=100、totalFiles=500,000 |
| 冻结范围前后 | 500,000 File、1,000 Artwork、1 Group，全部保留 |
| Operation | STALE / DONE / OWNERSHIP_CHANGED；version 1→2，executionVersion 仍 1 |
| 已落盘诊断 | 100 条 BLOCKED / SHARED / SHARED_PATH |
| 未回写历史行 | 499,900 条保留原 VERIFIED / UNCONFIRMED；它们属于已过期 operation，不是新授权 |
| 容量 | logicalBytes=null，未执行 totals SQL |
| Job 与 reader | 同一围栏事务后 job COMPLETED / attempt 3 / errorCode null / leaseToken null；reader IDLE/null，未启动 reader |
| 测量进程 max RSS / heap | 164,544,512 / 37,402,360 B |

上述范围、版本、100 条诊断、空容量和成对终态断言全部通过。这里验证的是共享路径大范围失效分支的完整数据库事务；并未在本次故障注入观察中间提交状态，原子性另依赖已独立审查的同事务围栏与小规模回滚测试。缓存、autovac 与前次物理死元组回收时点不同，不把 2,664 ms 与原全 UPDATE 超时简单解读为固定倍率。

原始脚本 `/private/tmp/dedup-prepare-scale-bounded-finalize.mts`（SHA-256 `8b44d0ffc98de9b947eb0536e9c9e2ee488b3741897e9b7a720c9be14b7e1a8f`），输出 `dedup-prepare-scale-bounded-finalize.log`，详细 JSON `dedup-prepare-scale-bounded-finalize-result.json`（SHA-256 `62061ed01cfb85e826f74658d92d29a28e57a26aeff82db95606f212ebf1063e`）。旧失败 JSON 保持原样，不用新结果覆盖。

截至本次，保留夹具已正常终态，无需清理租约。D3-05 的 500,000 行 HTTP 分页、两片有界只读窗口，以及共享失效场景的完整最终事务已有证据；**50 万实体文件全过程、有效唯一路径清单 READY 的最终容量汇总、并发 HTTP 压测和最终浏览器验收仍未覆盖**。STALE 不是 READY，不能据本次分支通过宣称全部 D3-05 完成。

## 证据与续接

所有脚本/JSON/日志保留在 `/private/tmp`，本轮没有引入生产接口：

- `dedup-prepare-scale.mts` / `dedup-prepare-scale-result.json`：真实 HTTP 与两片只读 reader；JSON SHA-256 `73d3a3bd7516d736134e187c3aecac732cce03bde902801c70ebad3903a46c72`。
- `dedup-prepare-scale-sql.mts` / `dedup-prepare-scale-sql-result.json`：SQL-only 清单及首次超时；JSON SHA-256 `4af430fb1b89e1c791b3587f949876d356a6e2e0b3b921e4559e27f5d9467bc2`。
- `dedup-prepare-scale-missing-plan.sql` / `.json`：精确缺失计数 SQL 与只估算计划；JSON SHA-256 `98e1b20dbb15ad706b24533113987239a3ed533e1dadea3833353012694e4781`。
- `dedup-prepare-scale-indexes.txt`、`dedup-prepare-scale-final-state.txt`、`dedup-prepare-scale-deploy.log`、`dedup-prepare-scale-next.log` 以及两个 run 日志。

脚本使用现有源码 tsconfig 映射，不依赖重新构建的 dist。最初启动脚本遇到本地 tsx 路径和包源码映射问题，进入业务前即失败；补齐克隆样本原来不存在的合成 UserBA 后才开始 HTTP 测量。服务自身只启动一次。不要直接重跑脚本，它会创建新的 operation；窄复核使用保留 SQL 与已交接的 operation。

```bash
# 仅估算计划，不执行全量核验；SQL 文件固定指向隔离 operation。
docker exec -i pixishelf-dedup-postgres psql -v ON_ERROR_STOP=1 \
  -U dedup -d dedup_prepare_scale -qAt \
  < /private/tmp/dedup-prepare-scale-missing-plan.sql
```

5441 的进程 5980 / 5973 / 5967 已核验端口、cwd 与父子链后 SIGTERM，端口不再监听，5430 未触碰。新库与证据保留。

gate 3 对应的唯一测试改动：原“PREPARE 关闭”用例更新为生产 PURGE 门禁仍关闭，assert reader 未创建；`maintenance-executor.postgres.test.ts -t 'production PURGE gate'` 在专库 dedup_executor_next **1 passed / 10 skipped**。结果由当次工具输出记录，没有另造原始日志；未重复原有 11 项编排测试。其余本轮无生产代码变更。

文档校验：`pnpm docs:check` 通过（225 Markdown）；`git diff --check`、主应用路径大小写检查通过。`pnpm docs:diagrams:check` 因本机缺少 Playwright chromium_headless_shell-1194 可执行文件失败；本批没有变更图源，不下载/修复浏览器或重试该检查，既有图证据保持原验证范围。
