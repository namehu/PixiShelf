---
status: historical
scope: Pixiv 扫描发布优化的隔离性能与回归证据
last-verified: 2026-11-02
sources:
  - packages/pixishelf-job-executors/scripts/scan-publication-benchmark.ts
  - packages/pixishelf-job-executors/src/scan/scan-executor.ts
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
---

# Pixiv 扫描发布优化：隔离验证记录

## 环境与边界

优化前基线为 `0ac7241a5d5b8cee3a6349e10d2b8586254868c2`，开始时工作区干净。验证在 Windows、Node.js 22.18.0 和专用 PostgreSQL 15 容器中进行；数据库使用合成凭据、本机回环端口与临时存储，空库执行完整 137 条 migration。使用合成媒体和专用数据库，不连接生产数据库或真实媒体。该记录不是生产部署或生产恢复验收。

基准驱动 SHA-256 为 `b17e02bd33c69bb0e27f99472dc0e9d1c57b0c53254751aee86a87a762bb24e6`；两版使用同一脚本、相同已安装依赖、各自源码和 tsconfig 别名。每版从干净业务表开始三次预热、三次采样；固定 52 件作品、603 张图片，其中两件分别有 89、61 张，其余页数见脚本。`CLIENT_LIST` 使用 `SKIP`，并发为 4。每次都校验图片和标签聚合计数与实际关系一致。

该驱动执行真实扫描和 fenced PostgreSQL 事务，进度回调只在内存中记录；因此 SQL 数和耗时是执行器测量，不含生产 Dispatcher 的进度事件持久化，不能直接解释为完整生产任务的耗时。真实 Dispatcher 的节流及最终持久化另有 PostgreSQL 测试。

## 测量结果

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 总耗时三次样本（ms） | 5972.12、6088.89、6038.81 | 3765.61、3578.45、3566.47 |
| 总耗时中位数（ms） | 6038.81 | 3578.45 |
| SQL 数三次样本 | 10365、10369、10365 | 5712、5708、5708 |
| Image INSERT 语句 | 603 | 52 |
| Tag INSERT 语句 | 216 | 52 |
| ArtworkTag INSERT 语句 | 624 | 52 |
| fenced 事务数量 | 262 | 262 |

上述样本中位数降低约 40.7%，只适用于本机及此合成负载。两版每次的业务摘要均为 `fbcb56c1fb1267194c9884ad655954b8aba49dfddd154bd53aad02d300218c0d`，覆盖作品字段、图片路径及排序、章节、标签关系与来源引用；它不覆盖真实媒体内容或生产数据。

以下数字是每轮所有事务阶段用时的累计值的三次中位数。事务有并发，累计值不能作为墙钟占比；它们也不改变逐作品事务或围栏的边界。

| 事务阶段累计中位数（ms） | 优化前 | 优化后 |
| --- | ---: | ---: |
| 获取事务 | 200 | 201 |
| 前置围栏 | 16922 | 9782 |
| 事务体 | 5462 | 3007 |
| 后置围栏 | 258 | 251 |
| 提交及结束 | 112 | 109 |

优化后的单项日志还记录 checkpoint 读取、目录保护、元数据读取、媒体枚举、各事务阶段和单项总时长；未进入的阶段保持未知。基线没有对应单项日志，不伪造其阶段对比。

## 回归与限制

- 扫描 PostgreSQL 完整套件 69/69 通过，包含 501 图片跨批次回滚、重试、幂等和围栏，以及旧 NULL 统计恢复；随后不清库再次运行 501 图片用例通过，检查新增 fixture 图片残留为零。
- 扫描、进度和在线标签同步的聚焦单元测试 7 个文件、56/56 通过，覆盖 500 条分批、新旧图片、来源所有权、AI 标签和进度乱序；真实扫描发布及 audit apply 使用共享 publisher，在线 Pixiv 同步使用共享标签替换逻辑。
- Worker 的真实 Dispatcher 与 PostgreSQL 进度测试 1/1 通过，覆盖 REALTIME 节流和最终强制刷新。独立空库的扫描媒体保护 4/4 通过。
- 旧中断测试首次仍期待 CLIENT_LIST 处理计数为 NULL，按新约定改为零，保留无 checkpoint 和库存写入断言；另一新增 501 图片测试的固定路径与前轮遗留图片相撞，改为唯一前缀并清理专属图片。修正后结果如上；这两次初始测试失败不作为生产实现故障。
- Worker 依赖链 typecheck 和 build 通过；build 有三条既有 CJS `import.meta` 警告。contracts 测试 183/183、runtime 测试 141/141 通过。
- 全链首次启用隔离数据库时，DB 包文件仍并行，出现锁死、超时和 lane 冲突；重新逐文件串行后，DB 包 417 项通过、3 项条件跳过，两个测试文件要求另一固定地址。为这两个文件新建指定地址的专用库后 51 项通过、1 项失败。该失败期望拒绝 `ARTWORK_DEDUP_SCAN` v3，但当前完整 migration 允许该版本；冻结基线同库复现同一失败，本次未修改相关 DB 代码、迁移或测试。三个跳过项是需各自专用旧 schema 和显式独占开关的去重升级测试。
- executors 全量逐文件串行得到 1251 通过、260 失败、47 跳过；worker 为 130 通过、3 失败。结果不能称为全链通过。扫描恢复测试中 3 项 `ACTION_REQUIRED` 失败在冻结基线同库复现；扫描去重 B1 证据测试在指定专用库中 3 项通过、1 项迁移真实文件转移失败，冻结基线复现相同结果。三份原生文件和 reader 测试的 23 项失败也在冻结基线同环境复现。其余失败尚未逐项证明同因，涉及专用数据库地址、根绑定、文件系统和读取器等，不能统称为已知基线问题。
- 主应用 lint 和使用专用测试库的 build 通过。完整单元测试为 490 个文件通过、3 个失败、55 个条件跳过，共 3648 项通过、29 项失败、385 项跳过。失败集中在作品删除的 20 项、图片替换的 9 项，以及视频关键帧服务的一个模块加载失败；优化前基线在同机对这三个文件复现相同失败数量和加载错误，包括 Windows `fsync` 的 `EPERM`。它们不调用本次修改的扫描 publisher 或进度路径，不能据此说这些功能通过。
- 主应用 typecheck、`pnpm docs:check`、`pnpm docs:diagrams:check` 和主应用路径大小写检查通过。

## 复现方式

以下仅用于新建且已核对的专用空 PostgreSQL 与合成媒体目录，不要指向应用数据库。迁移通过显式的 `DATABASE_URL` 执行 `pnpm --filter @pixishelf/db db:deploy`，不使用 `db:push`。真实 PostgreSQL 套件通过 `QUEUE_KERNEL_TEST_DATABASE_URL` 显式注入测试库，`--no-file-parallelism` 避免非竞争套件争用全局锁。部分既有测试有固定主机、端口和库名安全约束，应另建满足其约束的专用容器，不更改门槛。

```powershell
pnpm --filter @pixishelf/worker... typecheck
pnpm --filter @pixishelf/db exec vitest run prisma/__tests__ src/__tests__ --no-file-parallelism
pnpm --filter @pixishelf/job-executors exec vitest run src/scan/__tests__/scan.postgres.test.ts --no-file-parallelism
pnpm --filter @pixishelf/worker exec vitest run src/__tests__/scan-realtime-progress.postgres.test.ts --no-file-parallelism
pnpm --workspace-concurrency=1 --filter @pixishelf/worker... build
```

其余 Worker 包的测试也逐包以各自 `vitest.config.ts` 和 `--no-file-parallelism` 运行；主应用在包目录执行 `pnpm lint`、`pnpm test`、`pnpm build`。基准脚本只接受专门指定的 `SCAN_BENCHMARK_DATABASE_URL` 并重置该库业务表。将相同脚本覆盖到冻结基线的相同路径后，分别从两版的 executors 目录以各自 tsconfig 执行。由于本机 executors 包没有 `tsx` 命令，使用已安装的 tsx 4.23.12 CLI：

```powershell
node <已安装的tsx目录>/dist/cli.mjs --tsconfig tsconfig.json scripts/scan-publication-benchmark.ts baseline <绝对输出JSON路径>
node <已安装的tsx目录>/dist/cli.mjs --tsconfig tsconfig.json scripts/scan-publication-benchmark.ts after <绝对输出JSON路径>
```

比较前核对两版驱动哈希与源码解析路径；基准重置只能用于新建的可丢弃测试库。专用容器和基线源码副本属于本次临时资产，验证完成后清理；本记录保留可复核的样本和命令。
