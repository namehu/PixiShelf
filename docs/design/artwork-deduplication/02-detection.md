---
status: draft
scope: 去重第二阶段的后台检测、持久运行、调度、读取进程和资源验收
last-verified: 2026-10-23
sources:
  - packages/pixishelf-job-contracts/src/job-types.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - packages/pixishelf-job-executors/src/maintenance/creator-maintenance.ts
  - packages/pixishelf-job-executors/src/maintenance/sharp-animation-probe-pool.ts
  - packages/pixishelf-worker/src/dispatcher.ts
  - packages/pixishelf/services/background-task/job-command-service.ts
  - docs/adr/0008-separate-archive-download-and-publication.md
---

# 第二阶段：后台检测与资源控制

本文是尚未实现的开发规格，依赖[第一阶段](./01-fingerprints.md)验收。公共权限、设计图及阶段门槛见[总计划](../artwork-deduplication.md)。本阶段产出持久检测结果和任务中心控制能力，不执行隔离或删除。第三阶段将在同一 writer lane 注册维护任务 PREPARE 准备冻结计划；第四、五阶段再开放实际文件维护模式。

## 任务、接口与数据

执行器 agent 负责检测执行和 reader 进程；数据 agent 负责 run、冻结作品项、结果组及查询索引；主 agent 接入路由、任务注册、数据库类型/lane 约束、生产 capability 与通用命令保护。新任务 `ARTWORK_DEDUP_SCAN@1` 固定在 `BACKGROUND_WRITER`，不新增 lane。

| 接口         | 输入与结果约定                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `start`      | artistId、expectedUserId、幂等键、检查模式（增量/完整）；返回稳定 runId 与当前任务 ID                  |
| `getRun`     | runId、expectedUserId；返回范围、状态、阶段、聚合计数、可用控制、脱敏失败原因                          |
| `control`    | runId、expectedVersion、expectedUserId、幂等键和 pause/resume/cancel/retry；服务端返回新版本与当前状态 |
| `listGroups` | runId、expectedUserId、受限游标；第三阶段补齐审核 DTO，不返回完整媒体清单                              |

run 保存操作者、艺术家、冻结时间、模式、算法版本、状态版本、计数、检查点和任务关联。作品项保存冻结 ID、成员/源证据、完成/跳过/已变化/失败结果。结果组使用稳定 ID，关联同 run 的完整作品结果；通过数据库分组或分页聚合形成，不存储平方级两两关系。

一个艺术家只能有一个活动 run，数据库唯一约束与领域事务共同保证。排队、运行、请求暂停和已暂停均占活动资格；完成、失败和取消释放资格。重复幂等请求返回原 run，同幂等键不同参数报冲突。retry 仅重试失败/已取消 run 的原冻结范围，保留 runId、提高执行版本、复用有效已提交证据；已有其他活动 run 时拒绝。重新检查已完成范围使用 start 创建新 run。

暂停在 reader 安全边界生效，界面区分“暂停中”和“已暂停”；继续恢复原范围。取消停止后续处理并保留已提交缓存，已取消结果不能直接授权清理。已变更或局部读取失败允许产出“完成但有未检查项”，成功组仍可审核；根/数据库/执行环境错误中止整次 run，不伪装为零重复。

## 检测流水线与持久检查点

1. 短事务冻结有效 ArtworkArtist 归属的活动、未删除作品 ID，使用现有有效归属查询语义。新增作品留到下次检查；艺术家被合并/删除或成员离开范围时，不向新范围自动扩展。
2. 按媒体 ID 游标批量读取已发布 Image 及源状态，reader 检查实际属性，形成文件数量和排序大小多重集合。数据库未知/过期大小不能直接用作排除依据。
3. 仅至少包含两部作品且所有大小可靠的桶进入 SHA-256 阶段；完整检查也保留该安全筛选，但候选文件不复用内容缓存。大小分桶的摘要命中后核对实际清单，不能用摘要碰撞排除/接受候选。
4. 依第一阶段协议读/复用缓存并提交；逐作品核对完整成员和当前艺术家有效归属，再发布结果。未完成文件不得参与完整组。
5. 按内容指纹分组，再核对规范多重集合；稳定排序持久化组和成员。最后发布结果版本、统计和范围时间，旧执行不能覆盖新版本。

检查点保存游标、阶段及已提交单元的 ID，媒体清单和组成员保存在分页表中，不塞进 job payload/JSON。恢复时重查根身份、运行版本、源状态与完整成员；文件缓存可复用，未提交批次可重做，当前中断文件从头计算。进度是实际已提交结果与实际读取字节，重试读取字节另计，不用游标推断成功数量。

## 调度与读取进程

默认参数集中维护并由契约测试锁定：媒体页 500、属性检查并发 4、内容哈希并发 1、缓存提交批次 100。约 10 秒或 256 MiB 后在文件边界保存检查点，以现有 `schedulingYield`/`preserveAttempt` 释放 writer，冷却 3 秒；大文件可以超过批次预算，不把完整文件错误分片成多份 SHA。

任务使用 SYSTEM/低优先档，初始 priority 900，发起者保存在 run 审计中；控制重试必须回到领域入口，不得被通用 retry 提升成 RETRY/MANUAL。通用 enqueue、retry、replay 同样校验任务类型；合法用户不能靠直接 API 改 lane 或优先档。进度约 10 秒聚合一次，状态转移额外记事件，禁止每张文件创建事件或 checkpoint 事务。

单受控 reader 进程处理一批工作，固定可执行入口、结构化 IPC，不拼 shell。所有可能阻塞的 stat/open/read/realpath 放在该进程；主 Worker 保持续租、控制和故障上报可响应。IPC 页和未确认响应队列有上限，不从多艺术家任务再开并行 reader。

默认 30 秒没有文件属性结果或读取字节进展，进入停滞终止流程；正常持续读的大视频不因固定总时长失败。暂停/取消/失租约时停止接收新结果，终止 reader 并等待实际 close；发送 kill、Promise 超时或数据库 lease 到期均不代表 I/O 已停止。无法确认 close 时暴露故障并禁止新 reader，保留当前任务和现场交恢复，不循环生成失联进程。

`ARCHIVE_RESOLVE`、`ARCHIVE_DOWNLOAD` 与 `BACKGROUND_WRITER` 仍各有效并发 1。归档下载会同时写 staging、恢复复制及校验，因此 hash 并发 1 不等于全局磁盘并发 1。检测只遍历数据库已发布媒体，不扫描 staging/归档恢复目录。资源验收必须包含下载、浏览和 writer 发布竞争；不靠提高并发掩盖 NAS 卡读。

## 验收案例与阶段门槛

| ID     | 场景与必须证明的结果                                                                              | 证据                       |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------- |
| D2-01  | 同艺术家并发 start 仅一活动 run；幂等重放稳定；艺术家范围冻结、后来新增不追赶                     | PostgreSQL 并发测试        |
| D2-02  | 少量候选只读候选内容；全候选正确分组；以前无哈希作品进入候选后首次补齐                            | 计数 reader + 文件 fixture |
| D2-03  | 冷/热/完整检查统计真实，热检查无内容重读但仍有属性访问                                            | 可复现性能记录             |
| D2-04  | pause/resume/cancel/retry、kill Worker、失租约和 DB 断线后不发布旧结果，run ID 与已提交证据可追踪 | 故障注入                   |
| D2-05  | stat 卡住、read 卡住、关闭失败时主进程可响应，旧进程未退出不启动新 reader                         | 子进程故障 fixture         |
| D2-06  | 通用 retry/enqueue 不能提升优先级；10 秒/256 MiB 让行及 3 秒冷却有效；事件量有界                  | 队列与契约测试             |
| D2-07  | 50 万登记媒体，候选稀疏/全部候选：RSS、查询、IPC 和事件不随文件全集无界堆积                       | 隔离规模测试               |
| D2-08  | 同时下载、浏览、发布、多艺术家检测时记录实际读字节、stat 延迟、吞吐及等待；没有队列永久占用       | 并发负载记录               |
| D2-09  | 根掉线/身份变化、局部错误和正常零重复返回不同状态，恢复不能自动接受空根                           | 故障 fixture               |
| D2-B01 | 桌面/手机任务中心启动、进度、刷新、暂停/继续/取消、失败重试均与服务端状态一致                     | 6.1 Sol xhigh 浏览器记录   |

根据[测试策略](../../development/testing-strategy.md)运行受影响包的静态/测试和 capability 核验，完成独立代码审查、修复复审，再执行 D2-B01。规模测试和 NAS 实测分开记录；NAS 缺失不得用临时内存文件替代并宣称通过。阶段记录通过后进入[第三阶段](./03-review.md)。
