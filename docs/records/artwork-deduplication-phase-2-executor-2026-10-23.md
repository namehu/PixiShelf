---
status: historical
scope: 同艺术家去重第二阶段执行器、受控读取进程、Worker 接入及隔离故障测试
last-verified: 2026-10-23
sources:
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader.ts
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
  - docs/design/artwork-deduplication/phase-2-contracts.md
---

# 第二阶段 Executor 验证记录

适用版本为 `codex/artwork-deduplication` 分支、阶段一 `79b19167` 后的阶段二未提交工作树。实现由 GPT-6 Astra / xhigh 完成；本记录只登记执行器范围的实际检查，独立代码审查、规模测试与最终浏览器验收分别登记，不能据此认定上线。

## 环境与恢复依据

Mac 本地 Node 20.19.4，独立 PostgreSQL `dedup_executor_tests`（回环端口 55432），仅生成临时目录与合成媒体，不访问用户图库。正式迁移链已部署到 106 份，末项 `20261023004200_artwork_dedup_root_bindings`；未使用 `db:push`。数据库连接中断测试只终止该隔离事务自己的 backend，未停止共享数据库服务。fixture 在测试结束删除所属 run、job、Artwork、Artist 和临时文件。

检测本身只读取原媒体；可回收证据为本轮检测表和阶段一内容缓存。取消保留已提交文件缓存；所有结果提交仍通过现有执行租约围栏与完整成员、内容源及艺术家范围 CAS。没有真实媒体写入、隔离或删除，不需要对真实收藏执行恢复操作。

## 已实现与定向结果

- `ARTWORK_DEDUP_SCAN@1` 注册到现有 BACKGROUND_WRITER，生产能力清单增加该能力；SYSTEM/900 和领域入队由数据侧契约维护。
- 固定子进程入口处理 roots、stat、realpath、open、read 和 SHA-256。stat 并发 4、hash 并发 1，在途 IPC 最多 4；内容进展采用有确认的有界通知。
- STAT 阶段持久化可靠属性与媒体游标；仅可靠大小多重集合候选进入 HASH。缓存批最多 100、媒体页最多 500，约 10 秒或 256 MiB 在文件边界保存并让行 3 秒，保留 attempt。完整文件之外不保存部分 SHA 状态。
- 暂停、取消、失租约和停滞停止接受 reader 结果；实际 close 后才释放持久 reader 标记。close 无法确认时保留 BLOCKED，并使本 Worker supervisor 保持故障。
- reader 首次媒体请求前保存机器/boot/PID 命名空间及 PID 证明。Worker 崩溃后，仅固定 identity-only 子进程核验相同主机/命名空间下原 PID 已不存在，或可靠机器身份相同但 boot 已变化，才解除原 token。PID 复用、其他主机或无法核验保持阻断，使用数据侧离线恢复入口。
- 最小 Linux 容器没有 machine-id 时使用 boot 作用域身份：同 boot 可以核验；重新启动主机后保守转为显式恢复。macOS 使用硬件 UUID 与启动时间。identity-only 核验进程不安装媒体请求处理器，也有关闭故障保护。
- 每 slice 固定并复核 run 根绑定；根变化即使发生在无候选的 STAT 续跑阶段也使整 run 失败。根错误、局部文件错误和正常零重复结果分开。

当前定向测试结果：

| 范围                                                          | 结果  | 证明内容                                                                                                                                                                |
| ------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artwork-dedup/__tests__/executor.postgres.test.ts`           | 9/9   | 冷/热/FULL、少候选/全候选、3 秒让行与 attempt、暂停/取消、缺文件/根掉线、501 媒体游标、跨 slice 根变化、真实 PG 连接终止回滚、真实 Worker SIGKILL 恢复、旧 lease 零发布 |
| `artwork-dedup/__tests__/reader.test.ts`                      | 12/12 | 真实 child 读取与字节、零字节/缺文件、stat/read 停滞、真正卡死子进程时父进程可响应、取消迟到响应、close 失败不替代、startup 取消、字节进展看门狗、主机/PID 证明         |
| 阶段一 `content-foundation` 与 `artwork-fingerprint.postgres` | 11/11 | 因复用完整指纹聚合和根错误分类而执行的相关回归；500 文件热缓存、外部变化与 CAS                                                                                          |
| Worker `executor-registry` 与 `capability-audit`              | 15/15 | 任务注册和完整生产 inventory                                                                                                                                            |
| Worker `artwork-dedup-bundle`                                 | 1/1   | 与生产相同 CJS 构建后的固定 reader 实际读取合成文件                                                                                                                     |

501 媒体案例在第 104 个 stat 后让行，数据库确实保存 104 行与媒体游标；恢复后总 inspect 数为 501，没有重查已提交前缀。真正杀 Worker 的案例先提交一个文件缓存，再在下一个文件读取完成、数据库提交前 SIGKILL 独立执行进程；租约回收后由新执行确认旧 reader 退出，继续同 run 和游标，最终形成完整组。

## 命令与交付边界

定向命令（隔离数据库环境变量单独注入，不在文档保存连接凭据）：

```bash
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/reader.test.ts src/artwork-dedup/__tests__/executor.postgres.test.ts
pnpm --filter @pixishelf/job-executors exec vitest run src/media-content/__tests__/content-foundation.test.ts src/media-content/__tests__/artwork-fingerprint.postgres.test.ts
pnpm --filter @pixishelf/worker exec vitest run src/__tests__/executor-registry.test.ts src/__tests__/capability-audit.test.ts src/__tests__/artwork-dedup-bundle.test.ts
pnpm --filter @pixishelf/job-executors typecheck
pnpm --filter @pixishelf/worker typecheck
pnpm --filter @pixishelf/worker build
```

本轮未运行主应用全量 lint/test/build，不重复运行未变化的全量依赖链。Worker 构建运行的唯一 warning 为源码开发入口的 `import.meta` 在 CJS 中不可用；生产分支使用 `__dirname` 下的固定 CJS reader，实际 bundle 测试已运行该读取模式。图源未变化，图示检查由主协调统一复用已有证据。

计数语义以[第二阶段契约](../design/artwork-deduplication/phase-2-contracts.md#检测读取计数与崩溃窗口)为准：`readBytes` 为已提交完整文件的读取字节；`retryReadBytes` 仅覆盖仍存活进程观察到的未提交字节。SIGKILL 最后未聚合窗口不可恢复，不能把持久计数宣称为跨崩溃精确的物理 I/O 总量。正常性能报告使用 reader measurement hook，SQL 往返另行测量；操作系统缓存与 NAS 实际吞吐不混称冷盘。

50 万媒体与并发下载/浏览/发布的资源测量由独立 benchmark 工作登记；本记录不声明通过 D2-07/D2-08，也不替代真实 NAS 验收。用户已改为最终统一浏览器验收，本阶段未重复浏览器操作。

## P2-E201 定向修复（2026-10-23）

独立审查在基线 `9c0f23bc` 的阶段二工作树确认：嵌套归档目录从 A 切换到同一 source 内的 B 时，两者共享 logicalRoot/rootIdentity，旧绑定没有保存归档 prefix，续跑可能读取 A 并发布组。修复前新增真实 PostgreSQL/固定 child 用例分别在 STAT 和 HASH 续跑复现了 `COMPLETED / groupCount=1`，而 B 中对应内容不同；该结果用于证明缺陷，不能计为验收通过。

本次仅修改执行器的绑定检查、附近测试、[实施契约](../design/artwork-deduplication/phase-2-contracts.md)根绑定段及本记录。新绑定显式保存 `version:1` 和 `archiveRelativePrefix`（包括空字符串），每 slice 开始及结束按同一完整字段集合复核；retry 沿用原绑定。旧非空格式缺 version/prefix 一律 `ROOT_CHANGED` 并保留原值，不自动升级。null 只允许没有已处理 Item、媒体证据或读取计数的初始 STAT 绑定，已有进度不能通过删除绑定重新授权。该兼容处理不改 Schema，不修改阶段一共享物理根命名空间。

定向命令：

```bash
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/executor.postgres.test.ts -t 'archive root mapping'
pnpm --filter @pixishelf/job-executors typecheck
```

隔离库仍为 `dedup_executor_tests`，仅临时合成媒体；2026-10-23 22:59 的根映射测试 **11/11 通过**，同文件既有 9 项由 `-t` 排除并继承前述证据，未重复运行。覆盖 STAT/HASH 检查点切换 A→B、清理临时证据并增加 executionVersion 后的 retry、嵌套/分离根双向切换、slice 结束前映射变化、同 prefix 经 STAT/HASH 正常继续、旧嵌套/空 prefix 格式、缺 prefix 和已有进度的 null 绑定。变更拒绝用例断言零新组、原绑定保留；slice 开始拒绝还断言零 inspect/read，避免继续触碰旧 canonicalPath。retry 测试重建与服务一致的持久状态转换，App 控制幂等仍由其服务测试证明。

执行器包 typecheck 通过；`pnpm docs:check` 通过（206 份 Markdown），`git diff --check` 无输出，主应用路径大写扫描无匹配。没有重跑 reader/阶段一/Worker 已通过组，也没有重建 Worker 或全量 App；Worker 单包产物按协调安排留最后统一重建一次。代码修复完成后交独立 Sol 窄复审，本记录不代替该审查结论。专用规模夹具旧绑定的显式升级与续跑由 benchmark 记录单独说明，产品路径不为其放宽兼容规则。
