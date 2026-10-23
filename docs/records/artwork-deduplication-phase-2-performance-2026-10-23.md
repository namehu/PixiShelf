---
status: historical
scope: 第二阶段专用 PostgreSQL 规模、真实 reader I/O 与归档并发资源测量
date: 2026-10-23
---

# 去重第二阶段性能记录

本记录使用第一阶段基线 `9c0f23bc` 之后的第二阶段未提交实现。源码入口是 [scale benchmark](../../packages/pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts) 和 [contention benchmark](../../packages/pixishelf-job-executors/scripts/artwork-dedup-contention.ts)，检测调用实际 `executeArtworkDedup`、PostgreSQL 队列 claim/fence、独立 reader 子进程与实际文件系统。没有替代检测算法或模拟内容读取计数。此记录还在执行中，以下未完成项目不能作为通过证据。

## 环境、隔离与恢复依据

- MacBookPro17,1，8 个逻辑 CPU、16 GiB 主机内存；Docker Desktop 可见 8 CPU、8,215,117,824 字节内存。数据库为 PostgreSQL 15，正式迁移已到第 106 个 `20261023004200_artwork_dedup_root_bindings`。
- 仅使用 `127.0.0.1:55432/dedup_scale`，脚本同时校验 URL 的 loopback 主机与库名，并查询 `current_database()` 再确认；没有环境默认数据库回退。
- 原媒体与结果日志仅在 `/tmp/dedup-scale-*`。每个标签使用严格的 ownership manifest，删除前校验真实路径、reader token 与租约；所有数据库删除前还核对外部艺术家/冻结 run/媒体根引用与 write/recovery 证据；数据库删除限定该标签的合成 run/job/作品/图片/艺术家及已无媒体引用的专属根身份。
- 真实图库、真实数据库、功能测试库均不参与读写。样本可按脚本重新生成，因此恢复单位是指定标签的合成 fixture；不创建或声称存在生产备份。
- 一个数据库只允许一个逻辑媒体根。80 媒体 smoke 的残留根最初导致规模轮在 **0 次媒体读取** 时返回 `ROOT_CHANGED`；已仅清理 smoke 自有数据，然后复用原 50 万登记记录重建这个尚无内容缓存的失败 run。该失败保留在 `/tmp/dedup-scale-sparse.log`，不计入有效测量。

## 样本与口径

| 场景         | 登记作品 / 媒体 | 物理文件与大小             | 路径共享方式                                                                            | 预期候选与真实内容读取                                 |
| ------------ | --------------- | -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 稀疏候选     | 1,000 / 500,000 | 1,498 个；6,635,307 字节   | 前两作品共享 500 个 4,096 字节文件；其他作品各有一个独立大小文件，并共享剩余 499 个文件 | 2 个候选作品；1,000 次内容读，4,096,000 字节           |
| 全部候选冷轮 | 1,000 / 500,000 | 500 个；2,048,000 字节     | 所有作品的 500 个登记路径指向同一组真实文件；每部作品内路径唯一                         | 1,000 个候选作品；500,000 次内容读，2,048,000,000 字节 |
| 全部候选热轮 | 同上            | 原文件、路径和属性保持一致 | 沿用冷轮已提交的逐 Image 指纹缓存                                                       | 500,000 个内容缓存命中；0 内容读字节                   |

“冷”只指对应内容指纹缓存为空。未清空 macOS 文件缓存、Docker 磁盘缓存，也没有 NAS 冷盘数据。这是 50 万数据库登记规模和真实 reader 协议/文件读取压力，**不等价于 50 万独立文件的目录或 NAS I/O 压力**。共享文件没有减少应产生的逐 Image 内容读次数；计数来自 reader 的实际 inspect/read 与 PostgreSQL 提交结果。

默认资源限制保持源码配置：媒体页 500、stat 并发 4、hash 并发 1、提交批次 100、约 10 秒或 256 MiB 后在文件边界让行、真实等待 3 秒后重新 claim。没有使用虚拟时钟或缩短冷却来制造吞吐。

`statMedia` 同时包含初步属性检查与候选哈希前的二次属性检查；全候选因此应是 1,000,000。`statLatencyMs` 为 reader 响应延迟累计值，包含 IPC 等待；均值为该累计值 / inspections，不能解释成单次 NAS 系统调用延迟。RSS 是 reader hook 观察到的主进程与子进程峰值，不是 Docker 数据库或全机内存。

SQL 事件记录语句数、包含 INSERT/UPDATE/DELETE 的语句数、BEGIN/COMMIT/ROLLBACK 与数据库执行时间累计。它不是磁盘写字节；`onMeasurement.transactions` 只覆盖执行器包装的事务，另有 reader 所有权释放与最终队列事务。原始日志还保留 `pg_stat_user_tables` 前后累计值，它可能受 PostgreSQL 统计刷新的短暂延迟影响，不用来冒充精确物理写量。

## 可复现入口

由调用方显式注入专用 fixture 的 `DEDUP_BENCHMARK_DATABASE_URL`；不要使用真实环境文件。以下从仓库根目录执行：

```bash
pnpm --filter @pixishelf/worker exec tsx \
  --tsconfig ../pixishelf-job-executors/tsconfig.json \
  ../pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts \
  --case sparse --tag phase2-sparse --artworks 1000 --media 500 --cold-only
```

保存 stdout 与 `/tmp/dedup-scale-phase2-sparse/measurements.jsonl` 后，以同样参数加 `--cleanup-only` 清理稀疏 fixture；然后运行全部候选的冷、热两轮：

```bash
pnpm --filter @pixishelf/worker exec tsx \
  --tsconfig ../pixishelf-job-executors/tsconfig.json \
  ../pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts \
  --case all --tag phase2-all --artworks 1000 --media 500
```

每个 slice 的日志都保存 reader 指标、累计提交计数、SQL 增量、job 状态/attempt、剩余冷却、reader token 和 writer lease 数。`--resume` 只恢复相同 manifest 的已存在 fixture；`--reset-runs --resume` 仅允许在不存在内容缓存和活跃占用时重建尚未有效读取的失败 run，不能把热缓存标成冷轮。

## 规模结果

稀疏候选规模轮已完成；全部候选冷、热轮正在执行。80 条登记媒体 smoke 的冷、热完整执行分别为 960 ms / 820 ms；两轮均为 120 次 inspect，冷轮读取 40 次 / 163,840 字节，热轮读取 0 次 / 0 字节，均形成 1 个重复组。该 smoke 仅校验测量链路，不替代 50 万规模结果。

| 规模轮          | 状态   | 总耗时    | inspect / read / hit | 真实内容字节 | 主进程 / reader 峰值 | slice / event |
| --------------- | ------ | --------- | -------------------- | ------------ | -------------------- | ------------- |
| 50 万稀疏冷轮   | 完成   | 581.535 s | 501,000 / 1,000 / 0  | 4,096,000    | 174.80 / 135.50 MiB  | 45 / 134      |
| 50 万全候选冷轮 | 执行中 | 待完成    | 待完成               | 待完成       | 待完成               | 待完成        |
| 50 万全候选热轮 | 未执行 | —         | —                    | —            | —                    | —             |

稀疏轮形成 1 个组，2 部完整候选作品、998 部大小唯一作品；没有 changed/failed 项。持久临时媒体记录 500,000 条，内容指纹 1,000 条。实际 44 次让行后检查到的冷却余量为 2,970–2,993 ms；每轮 writer lease 均为 0、reader token 均为 null，最终 readerState 为 IDLE。事件是 134 条，随 slice 而非逐文件写入。

| 稀疏轮数据库与 IPC 指标     | 实测                  |
| --------------------------- | --------------------- |
| SQL 语句 / 含写入语句       | 399,552 / 45,658      |
| BEGIN / COMMIT / ROLLBACK   | 16,614 / 16,614 / 0   |
| 执行器 hook 事务次数        | 16,435                |
| SQL 执行时间累计            | 52,857 ms             |
| reader IPC 响应 / 进度消息  | 503,090               |
| inspect 延迟累计 / 每次均值 | 235,980 ms / 0.471 ms |

## 全候选冷轮中断与续跑口径

全候选冷轮在 `2026-10-23T14:53:01.789Z` 记录第 23 个 slice 后，旧基准脚本把下一次 `claim()` 返回 null 直接断言为失败而退出。最后已记录耗时 298,830 ms、已提交 inspect 230,904 次、内容读取 0。诊断时真实 job/run 仍为 `RETRY_WAIT`、attempt 0，error、reader token、worker/lease 均为空；因此没有把这次脚本中断当作检测失败或重新开始样本。原始空 claim 当时的精确时钟未记录，不能把推测的毫秒级提前唤醒写成已证明原因。

修复后的脚本反复重新读取 `availableAt`，允许短暂空 claim，以 100 ms 间隔重试并有两分钟上限；异常终态立即停止。真实冷却已经被诊断查询部分消耗也不再触发假失败。仅以 `--resume` 使用同一个 run `f450739c-9422-4168-bfbc-aa0253a551a3`；没有清媒体、清内容缓存或清检查点。实际续跑记录时间为 `2026-10-23T15:05:37.074Z`，距离上次 slice 的已记录间隔为 755,275 ms。续跑首个 slice 编号 24，新增 8,196 次 inspect，累计从 230,904 增至 239,100；writer lease 与 reader token 再次释放。

暂停期间执行器的独立审查 P2-E201 将根绑定升级为显式 `{version:1,source,archive,archiveRelativePrefix}`，旧非空格式按产品策略拒绝自动接受。按统筹授权，仅对此专用合成 run 做了一次精确旧 JSON CAS：确认原命令与 manifest 都是同一个 source/archive 根，真实 reader 再次解析到相同身份，且全库无 reader token/lease 后，追加 `version:1` 与 `archiveRelativePrefix:''`。实际操作在 `2026-10-23T15:00:19.092Z`，只更新 1 行；属性计数和临时媒体行数前后均为 230,904。完整依据与 before/after 位于 `/tmp/dedup-scale-root-bindings-upgrade.json`。没有更改产品的旧格式拒绝策略。

最终 `run-result` 会明确区分包含人工修复间隔的总 `wallMs`、当前 `segmentWallMs`、已观测分段时长 `observedSegmentMs` 和上一个已记录 slice 到续跑的 `gapSinceLastSliceMs`；最后一个字段包含原冷却及未精确定位的退出时间，不能当作精确的进程停机时长。日志以 `run-resume` 明确标出第二段，slice 编号继续递增，reader 指标合并两段并与最终数据库计数核对。旧段没有保存完整 SQL 累计计数，故 `allSliceSql` 仅合并实际持久化的逐 slice SQL 计数，排除两段间的 claim/统计查询；`sql` 仍明确标作当前段范围，不能伪装成整轮所有 SQL。

这轮包含脚本中断及审查修复期间的显式 fixture 格式升级，不是一次固定源码、不中断的冷测。物理文件仍只有共享的 500 个 / 2,048,000 字节，50 万指数据库登记媒体数。

## 下载、浏览、发布和多艺术家争用

并发脚本待规模基线结束后运行，避免污染单独测量。它复用全候选 fixture 的同一合成根，冻结两个不同艺术家、各 20 部作品 × 500 媒体，并进行有界 FULL 检查，预期真实读入 81,920,000 字节。

归档负载使用本机 loopback HTTP 服务提供 60 个随机像素 PNG，调用真实 `ARCHIVE_DOWNLOAD` 执行器完成流读取、staging、哈希/格式校验、封存与 phase handoff，再由真实 `ARCHIVE_PUBLISH` 执行器竞争同一个 `BACKGROUND_WRITER` 并发布媒体和数据库记录。该合成 provider 只替代外部来源发现和远端站点，不替代下载、存储或发布算法。

浏览负载要求 `DEDUP_BENCHMARK_BROWSER_URL` 指向真实 App 的 `artwork.cardList` 只读请求，`DEDUP_BENCHMARK_BROWSER_COOKIE` 或 `DEDUP_BENCHMARK_BROWSER_COOKIE_FILE` 使用合成账号的有效会话；响应须是 HTTP 200 且实际 `result.data.items` 包含合成作品。先记录无后台负载基线，再在并发期间读取响应体并记录延迟、响应字节和成功状态；登录重定向不作为成功浏览。端口与鉴权配置由统筹者准备。尚无并发通过结论。

并发 fixture 在首个数据库写入前保存 `contention-retained.json`，从而禁止 baseline 的 `--cleanup-only` 删除仍被共享的原件或记录。该并发现场默认保留供审查，不能直接移除 marker 再重跑清理；需要先确认全部相关 reader/lease 已释放，按精确 prefix 清理并发 run、两个艺术家及其归属、归档 import/execution/publication 和相应 source/write/recovery 引用，再核对根没有外部引用，最后才移除 marker 和清理 baseline。当前脚本不自动销毁这个共享现场。

独立审查提出的 M201 清理边界已修复：在活跃的 500,000 媒体 fixture 上以临时保留 marker 调用 `--cleanup-only`，脚本在首条数据库删除前退出 1，前后 Image 均为 500,000、原根保留；随后仅移除了测试 marker。M202 发布异常循环已加明确 job/import 终态检查、十分钟总期限与两分钟 writer 无进展期限，失败会记录 `contention-failed` 并保留现场，不把 FAILED/PAUSED 记为发布完成。此项当前为代码及定向类型验证，实际并发结果待执行。

## 检查、证据与未覆盖项

- 错库 guard 实际以 `dedup_tests` URL 调用，连接前退出 1；日志 `/tmp/dedup-scale-guard-check.log`。
- 两个基准脚本使用独立 [tsconfig](../../packages/pixishelf-job-executors/scripts/tsconfig.benchmark.json) 做定向类型检查；不重复全量 build/test。
- 原始日志：`/tmp/dedup-scale-sparse-full.jsonl`（清理前保存的完整稀疏日志）、`/tmp/dedup-scale-smoke.log`、`/tmp/dedup-scale-sparse.log`（首次失败）、`/tmp/dedup-scale-sparse-measure.log`（有效稀疏规模轮）、`/tmp/dedup-scale-all-measure.log`（全候选第一段与中断）、`/tmp/dedup-scale-all-resume.log`（续跑段）。最终汇总与摘要待完成后补齐。
- 不宣称 NAS 实测、生产部署、浏览器交互验收或全量 FULL 50 万媒体检查通过。浏览器交互按总安排留到最终统一验收。
