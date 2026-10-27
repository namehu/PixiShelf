---
status: historical
scope: F02 第三批同 SHA 跨媒体视觉特征复用的独立审查
last-verified: 2026-10-27
sources:
  - docs/design/artwork-deduplication/matching-extension.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/prisma/migrations/20261027000100_artwork_dedup_shared_visual_cache/migration.sql
  - packages/pixishelf-db/src/artwork-dedup-visual.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-pipeline.ts
---

# F02 第三批独立审查

## 范围与结论

2026-10-27，Sol 6.1/xhigh 独立审查分支 `codex/dedup-shared-visual-cache` 相对基线 `3e6da00d` 的未提交差异。审查者未参与实现；只写本记录，没有改动实现或运行重复测试。范围为 Schema、正式迁移、共享特征查询、视觉准备流水线、相关新增／调整测试，以及功能规格、runbook、契约和时序图的一致性。

静态审查及最终专项日志复核未发现 P1/P2，无代码审查阻塞项，可以进入独立桌面浏览器验收。此结论不代替浏览器验收、提交或发布通过。

## 静态核对

- 内容键包含原件 SHA-256、大小、视觉算法与规范化版本。新键只随核对成功的视觉读取结果或已经通过完整视图校验的共享特征物化；沿用原字节阶段的独立 SHA／属性证据。自身旧缓存命中不写回，因此不会自动补键并成为共享供体。
- 每页最多 50 媒体；缺失键先去重，数据库帮助函数另设 50 键上限。`VALUES`＋`CROSS JOIN LATERAL ... LIMIT 1` 每键最多返回一个 JSON，复合索引覆盖全部键字段。应用使用既有 `validVisualViews` 校验全部视图、尺寸、10 个哈希及信息数组。无效供体按 miss 处理，不为寻找另一个有效供体加载热门 SHA 的全部记录。
- `page.shared`、自身缓存、待提交结果只覆盖当前 50 行页；每页结束释放。完整检查不读取自身／共享缓存，也不建立同页复用键，逐路径执行视觉读取。
- 共享目标使用自己的 `visualIdentity(row)`、路径、源版本和文件属性。预取后的目标校验及提交阶段的根／目录锁、作品快照、源写令牌、媒体类型、租约和取消检查保持在原事务边界内。持久缓存、任务媒体结果、字节计数与游标同事务提交；事务失败不会只推进游标。
- 特征查询不建立供体的外键或跨 run 依赖；目标物化后具有自身完整缓存与任务 JSON。供体并发删除不会使已读取的纯内容特征丢失，目标提交仍独立受目标自身围栏约束。历史清理与最终发布逻辑没有被本批改动。
- 迁移只增加两个可空列和非唯一索引，无回填、删列或媒体扫描；旧身份、JSON、时间戳保留。新字段未新增数据库 CHECK 约束；合法键由现有原字节约束、读取帮助函数和受控写入路径保证。普通建索引会占用迁移期写锁，仍遵循 runbook 的停写、先迁移后部署流程；未将其描述为在线无锁升级。
- 功能规格、runbook 与第三批契约和代码一致；新增时序分支保持原件独立核验和最终发布保护。已查看 `/private/tmp/f02-shared-cache/detection.png`，本批新增分支可读。

## 动态证据状态

审查者只读取实施者保存的日志，不把静态推断写为实际运行通过。

- `/private/tmp/f02-shared-cache/empty-deploy.log`：隔离库 `127.0.0.1:55432/dedup_shared_cache` 正式执行全部 124 个迁移成功，含本批迁移。
- `/private/tmp/f02-shared-cache/db-tests.log`：2 个数据库专项通过，覆盖非空旧 schema 的旧值保留、索引、热门键单供体结果、键不兼容、页预算和供体删除。索引计划测试关闭顺序扫描，只证明索引可用，不证明大规模查询性能。
- `/private/tmp/f02-shared-cache/executor-focused-tests.log`：聚焦组 29 个案例通过，200 张案例失败后单独修复重跑；通过项包含共享命中后的取消／失租约／源写入／目录变化／事务回滚，以及既有预取身份变化、短前缀续行、最终发布围栏和历史 GC 回归。
- `/private/tmp/f02-shared-cache/shared-200-tests.log`：200 张案例最终单独通过，与前一份日志合计覆盖 30 个不同执行器案例；没有把前一次失败描述为全组通过。冷／热／FULL 的视觉处理调用为 120／0／200，独立原字节读取为 200／0／200；改一张分别为 1／1，跨次新增两张副本分别为 0／2。冷／热／FULL 视觉缓存读／写语句为 8／4、4／0、0／4。完整测量见同目录 `metrics.json`，与日志一致。
- `/private/tmp/f02-shared-cache/fixture-isolation-tests.log`：两个最终修改过夹具 metadata 的既有视觉专项单独重跑通过。其中 52 张夹具冷／热／改一张／FULL 视觉处理为 27／0／1／52，summary 和媒体 ID 配对一致；三作品相近图夹具的视觉关系 summary 也一致。日志中的旧 `contentBytes/contentReads` 字段当时实际为 Reader 总量，最终源码已更名为 `readerBytes/readerCalls`；本记录不将这些旧字段当作独立原字节测量。
- `/private/tmp/f02-shared-cache/db-typecheck.log`、`executor-typecheck.log`：两个受影响包类型检查通过。`worker-build.log`：单次必要 Worker 构建成功。

200 张共享 80 页夹具的关系查询包含 `PARTIAL`；其冷／热／FULL 关系等价只证明本夹具的字节部分重复结果。疑似视觉关系等价另由上述相近图回归证明。处理调用数与实际 Reader 字节分别记录，不冒充 Sharp 内部解码次数。

## 测量修正复核

首轮字节断言把 Reader 总读取字节又加上视觉字节，造成重复计算。最终 `measureSharedScan` 分别包装 `reader.read` 与 `reader.visual`，断言独立原字节调用数等于精确 `hashedMedia`，且两种读取字节之和等于持久 `run.readBytes`。最终记录冷轮总字节 4,168,320、FULL 5,210,400，与真实两类读取之和相符；运行时代码没有为此改动。

`statMedia` 同时累计初始属性检查与 HASH 阶段的缓存再检查。改一张时，所属 100 张作品进入 HASH，99 张未变媒体又检查一次，因此 200＋99＝299。把该专项的属性计数断言从恒等 200 改为至少 200 与现有语义相符。该下界本身不能证明逐路径检查；另行静态核对未改动的 STAT 逐媒体遍历、HASH 命中属性比较及本批共享命中后逐目标的源／目录／快照提交围栏，没有新增跳过目标原字节准备的分支。冷／FULL 原字节读取仍精确为 200，热轮日志仍记录 200 项属性检查。

失败夹具曾留下孤立 Image 缓存，使重新编码后与其他测试内容相同的文件合法共享。最终按夹具使用独立 EXIF 标识、保留变换所需 metadata，并清理测试自身 Image；同一夹具内的相同内容仍共享同一 Buffer。修改后真实视觉关系回归再次通过，没有放松核心共享匹配条件或视觉关系断言。

## 限制

本审查没有实际操作浏览器或删除，不验证手机、生产升级、真实图片识别效果、在线并发建索引或 50 万媒体性能。并发源写入和目录代次变化由专项实际验证；实际文件系统并发替换的完整发布路径未在本批新增专项中单独实测，不能由守卫静态审查扩大声明。独立桌面验收与最终文档检查由主线程另行登记。
