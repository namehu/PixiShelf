---
status: historical
scope: F02 第一批视觉缓存批量读写的独立代码审查与定向证据复核
last-verified: 2026-10-26
sources:
  - docs/design/artwork-deduplication/matching-extension.md
  - docs/features/artwork-deduplication.md
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor.postgres.test.ts
---

# F02 第一批独立审查

2026-10-26，Sol 6.1 / xhigh 独立审查 `codex/dedup-cache-batching` 相对基线 `a0ae9bce7577b6b065bb6cf6e5844be6526d5eba` 的未提交差异；实施者为 Astra。**结论：本批审查通过，未发现阻塞缺陷。** 审查者未修改生产代码、运行全量任务或操作开发数据库与真实媒体。

本批每页最多预取 50 条身份／缓存；FULL 不查询缓存，有效命中仍要求完整身份、算法／归一化版本及特征结构一致。只有新完成的视觉处理结果进入批量 upsert，命中不更新持久缓存。提交先取得根／目录锁，再按 Artwork ID 递增核对作品快照，随后逐项复核归属、路径、源 revision、写令牌、目录绑定及预取后的媒体类型；命中和 miss 共用这一发布校验。

cache upsert、任务媒体状态／特征和游标同事务提交，结果更新行数不符会回滚；整数、状态及 JSONB 参数类型明确。短前缀让行只推进已完成媒体，后缀沿 image ID 游标续行；待写内存限于当前页。队列事务前后 lease 围栏及取消检查保留，源／目录变化或事务失败不会发布该批结果。视觉算法、Schema、规模上限、App、删除流程、三条 lane 和跨次关系复用均未改变。

审查者读取实施者提供的最终原始日志，没有重复跑测试：`/tmp/f02-pg-batched.log` 的 10 项相关 PostgreSQL 用例通过（28 项按过滤跳过），覆盖跨页冷／热／改一张／FULL、短前缀续行、取消、失 lease、源／目录变化、回滚及既有相关视觉行为；`/tmp/f02-pg-hot-identity.log` 新增 1 项通过（38 项按过滤跳过），在全热预取后修改最后一项媒体类型，零视觉处理、零 cache 写，整批 PENDING、cursor 0、FILE_CHANGED，原 cache 逐字段不变。`/tmp/f02-unit.log` 的视觉／reader 28 项单测及 `/tmp/f02-typecheck.log` 的 executor typecheck 通过。审查者执行 `git diff --check` 通过，主应用路径大小写检查没有匹配项。

52 图隔离样本的日志与断言一致，四轮配对证据相同：

| 阶段     | 视觉处理调用 | 视觉读取字节 | cache SELECT | cache 写语句 | 改写 cache 行数 |
| -------- | -----------: | -----------: | -----------: | -----------: | --------------: |
| 冷轮     |           52 |       60,797 |            2 |            2 |              52 |
| 未变热轮 |            0 |            0 |            2 |            0 |               0 |
| 改一张   |            1 |        4,733 |            2 |            1 |               1 |
| FULL     |           52 |       64,185 |            0 |            2 |              52 |

视觉处理调用数是受控 `reader.visual` 调用／图片数，不是 libvips 底层解码次数插桩。改单张通过重新编码同图改变字节身份，证明失效范围；不是视觉内容变化真值样本。总查询事件 995／824／920／994 包含完整 executor 的 SHA 阶段、事务控制、围栏和任务发布，不是单独视觉阶段成本；本审查未据此推导版本间加速比例。

结论限于本批差异和本地隔离 PostgreSQL／合成临时媒体证据，未枚举全部身份字段与命中比例组合；代码共用逐项发布校验，全热最后一项变化另有定向证明。不代表浏览器验收、生产部署、真实图库／NAS 性能、50 万吞吐、同 SHA 跨媒体复用或关系增量完成。必要构建、浏览器及长期证据位置由本批汇总记录登记；临时日志为本次复核来源。
