---
status: historical
scope: 2026-10-30 热批默认零来源回归、隔离样本单次 A/B 与失败归因
last-verified: 2026-10-30
sources:
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/hot-run.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/hot-run.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor-lifecycle-telemetry.test.ts
---

# 热批回退专项与同样本测量

基线源码为 `f2b7e20f`，修复源码来自本轮独立 worktree。最终计量源码、同一驱动及各产物 SHA-256 见 [source-hashes.json](./source-hashes.json)。测量后逐一核对，最终运行时源码与工作树相同。此前仅用于准备的 `after-source/after-bundle` 没有执行计量；唯一修复后计量使用最终格式收口的 `after-final-source/after-final-bundle`。

## 输入、隔离与恢复依据

复用原有 2,000 张合成图片／50 部作品，媒体始终原地只读。原暖缓存 dump SHA-256 为 `27f56230021955550eae72292d8db06e02894177ced3008653e1a2fe46835b0a`；文件内容及 size、mtimeNs、inode、device 组合摘要为 `8680a87f640a4e625c6443d49fa8582c6252b49759f6c5d7ffbdd82c0a92977a`。完整校验见 [preserved-input.json](./preserved-input.json)。未修改主目录、开发／生产数据库或旧样本库；没有删除操作。

只新建 `dedup_hot_fallback_baseline_20261030`、`dedup_hot_fallback_after_20261030` 和空的 `dedup_hot_fallback_core_20261030`。两份样本都从同一原 dump 恢复，并应用已有 v9 任务策略迁移；本轮没有新迁移。

原暖 dump 的作品来源版本为 1，生产核验条件是作品 Source 缺行、合法指纹版本和 epoch 均为 0。为了复现同一条件，两份新克隆都将 50 条 `ArtworkContentFingerprint.sourceRevision` 和 50 条历史完成项 `ArtworkDedupItem.snapshotRevision` 从 1 映射为 0，再删除对应的 50 条非写入、epoch 为 0 的作品 Source。未修改任何内容哈希、成员／视觉签名、历史摘要或删除授权快照。图片级 Source、指纹、目录和视觉缓存不变。

逐表摘要验证仅允许上述两列与 Source 行发生变化，其他域数据在变换前后不变，两份克隆的域摘要也相同。原 v8 检查点没有整轮复用检查点；视觉签名不编码作品来源版本，新运行的输入摘要由运行时正常计算。详细变换与摘要口径见 [fixture.json](./fixture.json)。准备阶段先用断言阻止了直接删除版本 1 Source，未执行错误条件的基准，也没有改原 dump。

## 单次串行 A/B

先测基线，再完成专项，最后测修复；两次计量均无其他本轮 App／Worker／数据库测试争用，各版本仅一轮，真实调度睡眠均为零。结果见 [measurement.json](./measurement.json)。

| 相同计量口径 | 基线 | 修复后 |
| --- | ---: | ---: |
| 执行器完整墙钟 | 8,065.031 ms | 3,090.967 ms |
| 实际 SQL BEGIN，含队列／围栏 | 471 | 24 |
| 驱动 mutation + finalization 包装事务 | 468 | 21 |
| 其中 mutation 包装事务 | 467 | 20 |
| 实际 SQL 总条数，含控制语句 | 7,724 | 704 |
| Prisma API 调用 | 5,588 | 593 |
| 整个基准进程定时采样 RSS 峰值 | 156,925,952 bytes | 178,290,688 bytes |
| 热批数／复用作品数 | 0／0 | 4／50 |

墙钟减少 61.674%，SQL BEGIN 减少 94.904%，驱动包装事务减少 95.513%。运行时持久事务计数另为 469／22，不能与驱动包装事务混用。RSS 每 20 ms 采样整个基准进程，不是额外工作集或子进程合计；修复后估算的任务元数据峰值为 6,990,976 bytes。旧运行时记录的元数据 0 是未实际采样造成的伪零，原证据保留，没有回填。

两侧都是 2,000 原件缓存命中、25 组、2,125 复制行、25 个复用关系；读取字节、哈希重算、解码、索引重建／节点访问、候选与精比均为 0。语义结果摘要完全相同：`9c8c620c96e92375cf1ed94477297d09527affbf2697bbf774d1c0be912a6bb0`。

这是本机相同合成输入的一次暖缓存观察，没有统计置信区间，也不推算 NAS 耗时。生产的 53 部作品／7,905 图只提供根因条件，不与这组样本混作性能对照。完整私有输出、驱动和恢复文件保留在 `/private/tmp/pixishelf-hot-fallback-20261030/validation`；凭据和环境文件未复制到仓库。

## 专项与最终检查

受影响快速专项最终 28／28 通过，见 [unit-telemetry.log](./unit-telemetry.log)：热批 14 项与生命周期遥测 14 项。新增覆盖缺 Source 默认零、非零版本／epoch 拒绝、真实写入标志、混合来源、提交回退、502 原件的数量／慢属性／让行边界；日志按执行片原因去重，保留观测时已提交前缀，后续进度与回滚不污染该快照，未知元数据不伪造为零。

PostgreSQL 共覆盖 32 个不同场景。使用编译 reader 的完整套件先通过 30 项，只有 2 个新增断言把“首批未提交的未知热计数”误写成 0；更正为 null 后，最终仅定向复验这两项并通过。最终两项还在真实新增事件上运行 [只读运维 SQL 模板](../../../operations/queries/artwork-dedup-hot-fallback.sql)，验证运行、版本、阶段、原因及作品 ID。见 [完整覆盖输出](./postgres-full-coverage.log)与[最终定向输出](./postgres-final-targeted.log)。这是组合覆盖 32 项，**不是一次 32 项全绿的运行**，也没有把重复执行累加为覆盖数。

原有取消、租约丢失、回滚、目录／成员变化、500 原件断点、重新加载与证据复制／发布校验均在上述 30 项中通过。DB 类型检查与最终源码的执行器类型检查通过，见 [db-typecheck.log](./db-typecheck.log)和[executor-typecheck.log](./executor-typecheck.log)。未执行全量 App lint、test 或 build。结构化汇总及日志校验值见 [validation.json](./validation.json)。

## 失败归因与保留

[首轮 PostgreSQL 输出](./postgres-initial.log)按原样保留，不计为通过：

- 新合成图片创建过程会产生非零作品来源版本，新增正例最初误以为天然为零。修正为在这些全新合成作品冷预热前明确构造缺 Source，随后冷预热自然生成合法零缓存；没有改哈希或放宽实现校验。
- 首轮新增事件断言没有处理既有 null 事件数据，已修正断言。
- 直接用 TypeScript 入口启动视觉线程超时，阻塞后续共享队列 claim，产生连锁失败。复验使用相同源码的编译 reader／视觉线程，源摘要与最终计量对应产物完全一致。首轮结束后检查 core 的作品、图片、运行、任务、目录与元数据状态均已由测试清理为空，无需清库；没有修改 A/B 库。
- 编译 reader 的完整套件中，两个新增拒绝用例把未知计数误断言为 0；最终定向复验改为明确 null，保留“没有提交成功热批”的语义，未修改生产代码。

以上搭建与断言失败未触发额外基准，原 baseline 没有重跑或覆盖。后续桌面验收使用另建 browser 克隆及独立服务，属于功能证据，不进入本表计量。
