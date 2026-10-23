---
status: historical
scope: 第二阶段专用 PostgreSQL 规模、真实 reader I/O 与归档并发资源测量
date: 2026-10-23
---

# 去重第二阶段性能记录

本记录使用第一阶段基线 `9c0f23bc` 之后的第二阶段实现。前两段测量跨越审查修复；后续有界续跑使用优化提交 `b0174077` 与基准修复 `c2d6be73`，因此全候选冷轮不是固定源码基线。源码入口是 [scale benchmark](../../packages/pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts) 和 [contention benchmark](../../packages/pixishelf-job-executors/scripts/artwork-dedup-contention.ts)，检测调用实际 `executeArtworkDedup`、PostgreSQL 队列 claim/fence、独立 reader 子进程与实际文件系统。没有替代检测算法或模拟内容读取计数。规模与并发实测均已完成；浏览器交互仍留最终统一验收，所有下述限制继续保留。

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

前两段资源限制为媒体页 500、stat 并发 4、hash 并发 1、提交批次 100、约 10 秒或 256 MiB 后在文件边界让行、真实等待 3 秒后重新 claim。后续提交 `b0174077` 将 HASH 取页收紧到实际提交批次 100，并移除热路径重复全成员计数；该性能改动与中断一起保留在测量口径中。没有使用虚拟时钟或缩短冷却来制造吞吐。

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

稀疏候选、全部候选冷轮和热轮均已完成。80 条登记媒体 smoke 的冷、热完整执行分别为 960 ms / 820 ms；两轮均为 120 次 inspect，冷轮读取 40 次 / 163,840 字节，热轮读取 0 次 / 0 字节，均形成 1 个重复组。该 smoke 仅校验测量链路，不替代 50 万规模结果。

| 规模轮          | 状态       | 总耗时    | inspect / read / hit | 真实内容字节 | 主进程 / reader 峰值 | slice / event |
| --------------- | ---------- | --------- | -------------------- | ------------ | -------------------- | ------------- |
| 50 万稀疏冷轮   | 完成       | 581.535 s | 501,000 / 1,000 / 0  | 4,096,000    | 174.80 / 135.50 MiB  | 45 / 134      |
| 50 万全候选冷轮 | 完成，有遥测缺口 | 4,496.737 s 墙钟 / 1,894.302 s 已观测分段 | 已提交 1,000,000 / 500,000 / 0 | 已提交 2,048,000,000 | 已观测 184.28 / 135.13 MiB | 146 / 440 |
| 50 万全候选热轮 | 完成，遥测完整 | 2,287.431 s 墙钟 / 1,752.734 s 已观测分段 | 1,000,000 / 0 / 500,000 | 0 | 186.08 / 131.97 MiB | 135 / 404 |

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

第二段最后完整测量为 `2026-10-23T15:15:26.012Z` 的 slice 68：累计 inspect 570,383、read 70,383、内容字节 288,288,768，第二段已观测耗时 588,948 ms。之后进程退出但未留下错误或退出码；统筹及测量 agent 访问原会话 22216 均返回 `Unknown process id`。在 `2026-10-23T15:28:12.062576Z` 的专用库快照中，run 为 RUNNING/HASH，readerState 为 ACTIVE 且 token 保留，job 租约已于 `15:16:29.013Z` 过期；持久 owner 的 parent PID 98585 与 child PID 4929 均不存在。没有证据将其归因于业务失败或工具自动清理。完整诊断是 `/tmp/dedup-scale-second-interruption.json`。

| 第二次中断的计量边界           | statMedia | hashedMedia |   readBytes |
| ------------------------------ | --------: | ----------: | ----------: |
| 最后持久化的 reader slice 累计 |   570,383 |      70,383 | 288,288,768 |
| 数据库已提交累计               |   571,600 |      71,600 | 293,273,600 |
| 已提交但未观测的窗口           |     1,217 |       1,217 |   4,984,832 |

最后一行只证明数据库已提交进度，不能补成精确 reader 测量。该窗口的 reader inspect/read、IPC、RSS、响应延迟、事务/SQL 及额外未提交读取尾部均未知；真实物理设备 I/O 更无法从数据库字节数推出。恢复日志以 `measurement-gap` 单独保留此窗口，`readerMetrics` 与 `sql` 明确为 null。后续 `aggregate` 只累加实际收到并持久化的 slice hook，`measurementCoverage.complete` 保持 false；`committedWithoutMeasurement` 单列缺口，仅以“已观测 + 已提交缺口”与最终数据库计数做一致性核对，不将缺失遥测伪装成精确整轮值或产品失败。

最终 `run-result` 区分包含人工修复间隔的总 `wallMs`、当前 `segmentWallMs`、已观测分段时长 `observedSegmentMs` 和上一个已记录 slice 到续跑的 `gapSinceLastSliceMs`；最后一个字段包含原冷却及未精确定位的退出时间，不能当作精确的进程停机时长。`run-resume` 明确标出各段，slice 编号继续递增。`allSliceSql` 仅合并实际持久化的逐 slice SQL 计数，排除段间 claim/统计查询与未观测的退出尾部；`sql` 仍明确标作当前段范围，不能伪装成整轮所有 SQL。

新增可选 `--max-segment-ms 300000` 以进程启动时间计算软预算，仅在执行完 slice 且确认 writer lease 为 0、reader token 为 null、任务进入 RETRY_WAIT 后写 `run-segment-end` 并退出 75。它不强杀进行中的 slice，实际时长可以多一个 slice；默认 0 表示无限制。冷轮恰好完成时会正常收尾，若预算已耗尽则在创建热轮前退出 75。退出 75 表示有界分段暂停，退出 0 表示本次请求已完成（或只读检查完成），其他非零退出需先诊断；不要在单个工具会话中用无限 shell 循环包装续跑。

本次遗留 RUNNING 由 `--resume` 调用原 `PostgresQueueRepository.recoverExpiredExecution('BACKGROUND_WRITER')` 回收过期队列执行；执行器随后通过身份探测子进程的同机/同启动/PID 退出证明释放旧 reader token。脚本不直接修改 reader token、gate 或租约；活跃未过期执行会明确拒绝重复启动，异常终态会停止。后续已由统筹运行真实回收与有界续跑，冷轮最终完成，reader 回到 IDLE 且 token 为空。 窄审 M203 修正了脚本的 attempt 断言：正常让行应回到本次 claimed attempt 减 1；过期恢复已消耗的历史 attempt 会保留，不能固定要求为 0。没有重写或清零数据库 attempt。对 claim 前 attempt 0 与 1 的表达式检查分别确认 claim 后 1/2、让行后 0/1，并拒绝未扣回的值。

从工作树根目录逐段执行如下命令；stdout 追加保留，JSONL 仍在原 fixture 内。首次恢复原 run，冷轮完成后同一入口开始热轮，不清已提交数据或缓存：

```bash
DEDUP_BENCHMARK_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_scale?connection_limit=20&pool_timeout=20' \
pnpm --filter @pixishelf/worker exec tsx \
  --tsconfig ../pixishelf-job-executors/tsconfig.json \
  ../pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts \
  --case all --tag phase2-all --artworks 1000 --media 500 --resume \
  --max-segment-ms 300000 >> /tmp/dedup-scale-all-segments.log 2>&1
```

这轮包含脚本中断及审查修复期间的显式 fixture 格式升级，不是一次固定源码、不中断的冷测。物理文件仍只有共享的 500 个 / 2,048,000 字节，50 万指数据库登记媒体数。

## 全候选冷轮完成与冻结副本

冷轮于 `2026-10-23T16:03:00.268Z` 输出终态：1,000 部完成、0 变化、0 失败，1 个重复组、999 部副本；500,000 条内容缓存和 500,000 条临时媒体记录。数据库已提交 inspect 1,000,000、hash 500,000、内容字节 2,048,000,000，重试读取字节 0。已观测 reader 为 inspect 998,783、read 498,783、2,043,015,168 字节，加上前述唯一已提交缺口正好与数据库一致；未观测的未提交读取尾部仍未知。

冷轮共有 6 个执行段、146 个 slice、440 条事件。4,496.737 秒墙钟包含人工排错及段间等待，1,894.302 秒仅为有记录的执行段耗时；两者不能当作一次不中断的固定代码吞吐。已观测主进程/reader 峰值为 193,232,896 / 141,688,832 字节，缺口使其不能证明整轮全局峰值。持久 slice 的 SQL 为 847,304 条、含写入 81,905 条，BEGIN 35,500 / COMMIT 35,503 / ROLLBACK 0，累计 SQL 时间 221,760 ms；不覆盖中断窗口或段间查询。

为支持第三至第五阶段并行开发，后续测量从 `c2d6be73` 导出到 `/tmp/dedup-phase2-code-c2d6be73`，并复制第 106 版 schema 对应的 Prisma 客户端；功能开发的 generate 和新迁移不会改变测量库。热轮已从同一 500,000 内容缓存开始。测量与功能编译/定向测试在同一主机并行，资源竞争仍可能影响耗时，不能将此轮标为无外部负载。

有界续跑应在冻结副本的 `packages/pixishelf-worker` 目录直接用 `pnpm exec tsx` 执行同一参数；递归 `pnpm --filter … exec` 会把子进程正常分段退出 75 包装为外层退出 1，不应误判为产品错误。逐段保留日志 `/tmp/dedup-scale-all-segments.log`，完整 JSONL 位于 `/tmp/dedup-scale-phase2-all/measurements.jsonl`，去除大体积表统计的已完成轮摘要为同目录 `summary.json`。

## 全候选热轮完成

热轮于 `2026-10-23T16:41:09.522Z` 完成，run 为 `2c32027d-e5df-4237-90b9-306669eefab1`。1,000 部完成、0 变化、0 失败，1 个重复组；100 万次 inspect、50 万次缓存命中、0 次内容读取、0 内容字节。135 个 slice 与数据库计数全部对齐，无未观测窗口；结束后 reader 为 IDLE 且 token 为空。

热轮分 6 段运行，墙钟 2,287.431 秒含人工续跑间隔；已观测分段为 1,752.734 秒，reader 执行时间累计 1,351.306 秒。主进程/reader 已观测峰值为 195,117,056 / 138,379,264 字节。slice SQL 共 737,460 条、含写入 56,748 条，BEGIN 35,449 / COMMIT 35,451 / ROLLBACK 0、累计 SQL 时间 200,427 ms；IPC 消息 1,000,270，inspect 响应延迟累计 543,425 ms。事务起止差和 SQL 口径遵守上文定义，不解释为数据库事务泄漏。

此结果证明有效指纹缓存消除了本样本的内容重读，不证明热轮无需检查属性/写检查点，也不能把合成小文件、人工分段和并行主机负载下的耗时推广为真实 NAS 吞吐。冷轮代码和遥测有变化、热轮代码已冻结，两轮不是严格受控的测速对照。

## 下载、浏览、发布和多艺术家争用

并发脚本在规模基线完成后运行，未修改正在测量的冻结范围。它复用全候选 fixture 的同一合成根，冻结两个不同艺术家、各 20 部作品 × 500 媒体，并进行有界 FULL 检查，预期真实读入 81,920,000 字节。

归档负载使用本机 loopback HTTP 服务提供 60 个随机像素 PNG，调用真实 `ARCHIVE_DOWNLOAD` 执行器完成流读取、staging、哈希/格式校验、封存与 phase handoff，再由真实 `ARCHIVE_PUBLISH` 执行器竞争同一个 `BACKGROUND_WRITER` 并发布媒体和数据库记录。该合成 provider 只替代外部来源发现和远端站点，不替代下载、存储或发布算法。

浏览负载要求 `DEDUP_BENCHMARK_BROWSER_URL` 指向真实 App 的 `artwork.cardList` 只读请求，`DEDUP_BENCHMARK_BROWSER_COOKIE` 或 `DEDUP_BENCHMARK_BROWSER_COOKIE_FILE` 使用合成账号的有效会话；响应须是 HTTP 200 且实际 `result.data.items` 包含合成作品。先记录无后台负载基线，再在并发期间读取响应体并记录延迟、响应字节和成功状态；登录重定向不作为成功浏览。使用独立 5440 端口、合成账号和冻结代码，实际并发结果如下。

并发 fixture 在首个数据库写入前保存 `contention-retained.json`，从而禁止 baseline 的 `--cleanup-only` 删除仍被共享的原件或记录。该并发现场默认保留供审查，不能直接移除 marker 再重跑清理；需要先确认全部相关 reader/lease 已释放，按精确 prefix 清理并发 run、两个艺术家及其归属、归档 import/execution/publication 和相应 source/write/recovery 引用，再核对根没有外部引用，最后才移除 marker 和清理 baseline。当前脚本不自动销毁这个共享现场。

独立审查提出的 M201 清理边界已修复：在活跃的 500,000 媒体 fixture 上以临时保留 marker 调用 `--cleanup-only`，脚本在首条数据库删除前退出 1，前后 Image 均为 500,000、原根保留；随后仅移除了测试 marker。M202 发布异常循环已加明确 job/import 终态检查、十分钟总期限与两分钟 writer 无进展期限，失败会记录 `contention-failed` 并保留现场，不把 FAILED/PAUSED 记为发布完成。这两项的代码与定向检查已完成；并发成功路径现已实际执行，不能据此替代发布异常的故障注入。

## 并发实测结果

`2026-10-23T16:46:23.125Z` 至 `16:47:39.222Z`，总计 76.097 秒。两个不同艺术家各 20 部作品 × 500 媒体均完成 FULL：每个 run inspect 20,000、hash 10,000、readBytes 40,960,000，共内容读取 81,920,000 字节，各形成一个重复组。共 9 次 writer 执行，检测 slice 后均释放 reader token 和 writer lease。

真实归档执行下载 60 个 PNG，共 49,870,680 字节，60 次 loopback 响应，18.043 秒完成下载；发布等待 BACKGROUND_WRITER 2.345 秒，执行 1.045 秒，于开始后 21.382 秒完成，产生一个作品和 60 个媒体，归档状态 COMPLETED、sealedGenerations 为 1。等待发生时检测仍在持续推进。

| 鉴权列表请求 | 请求数 | P50 | P95 | 最大 |
| --- | ---: | ---: | ---: | ---: |
| 无后台样本基线 | 20 | 29.218 ms | 38.545 ms | 38.545 ms |
| 并发期间 | 264 | 28.228 ms | 81.512 ms | 336.378 ms |

全部请求真实返回 HTTP 200 且包含合成作品，累计并发响应 1,660,294 字节；表中分位采用排序数组 `floor(n*p)` 对应项，20 条基线的 P95 恰为最大值。此为本机开发模式 HTTP/API 响应，不是浏览器绘制、生产构建或远程 NAS 延迟；并发执行器和数据库也处于同机环境。

冻结副本的外部依赖软链接不被 Turbopack 接受，因此首次测试 App 启动失败；没有修改产品配置，改用 `next dev --webpack` 后成功。第一次 Python 预热遇到系统代理 502，改为显式直连 loopback 后确认 200/24 项，约 9.2 秒首次编译预热不计入表中基线。后续 Node 实测请求全部有效。测试 App 仅使用 5440，未占用/停止用户 5430；结果取得后按 PID 工作目录核验停止测试 App。

原始并发日志为 `/tmp/dedup-scale-contention.log` 及 `/tmp/dedup-scale-phase2-all/contention-measurements.jsonl`，精简结果为同目录 `contention-summary.json`。合成 session、媒体、缓存和 contention-retained 标记保留；不能用普通 baseline 清理命令删除共享现场。真实浏览器回归及手机真机检查仍未完成。

## 检查、证据与未覆盖项

- 错库 guard 实际以 `dedup_tests` URL 调用，连接前退出 1；日志 `/tmp/dedup-scale-guard-check.log`。
- 最小恢复计量验证：相同 run 连续两次 `--inspect-measurement-only --resume --max-segment-ms 300000` 均保留一个 1,217 媒体 / 4,984,832 字节缺口；run/job/token/lease 的完整前后快照一致，没有 claim、回收或新 reader。日志 `/tmp/dedup-scale-measurement-inspection-1.log`、`/tmp/dedup-scale-measurement-inspection-2.log` 与 `/tmp/dedup-scale-measurement-inspection-state.json`。负数和缺失 `--max-segment-ms` 值均在连接数据库前被拒绝，见 `/tmp/dedup-scale-segment-parameter-negative.log` 与 `/tmp/dedup-scale-segment-parameter-missing.log`。
- 两个基准脚本使用独立 [tsconfig](../../packages/pixishelf-job-executors/scripts/tsconfig.benchmark.json) 做定向类型检查；不重复全量 build/test。
- 原始日志：`/tmp/dedup-scale-sparse-full.jsonl`（清理前保存的完整稀疏日志）、`/tmp/dedup-scale-smoke.log`、`/tmp/dedup-scale-sparse.log`（首次失败）、`/tmp/dedup-scale-sparse-measure.log`（有效稀疏规模轮）、`/tmp/dedup-scale-all-measure.log`（全候选第一段与中断）、`/tmp/dedup-scale-all-resume.log`（续跑段）。完成摘要位于上文 summary.json / contention-summary.json，关键数值已纳入本记录。
- 不宣称 NAS 实测、生产部署、浏览器交互验收或全量 FULL 50 万媒体检查通过。浏览器交互按总安排留到最终统一验收。
