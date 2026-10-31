---
status: historical
scope: 去重选择复用普通作品删除的实施基线、升级门槛及隔离验收
last-verified: 2026-10-31
sources:
  - packages/pixishelf/services/artwork-service/delete-artwork.ts
  - packages/pixishelf/services/artwork-service/deletion-content-guard.ts
  - packages/pixishelf/services/archive/archive-maintenance-service.ts
---

# 去重复用普通删除

基线：`6007ba700622deecb6ecadd753519b8f1febeec9`；独立分支 `codex/dedup-use-artwork-delete`。本记录不代表生产已部署。本次仅对新建隔离数据库及合成媒体执行删除，不访问生产或开发既有媒体；恢复单位为可重新生成的 fixture，生产升级仍须数据库与媒体同点备份。

## 已确认方案

去重只负责发现、对照、保留选择和明确待删作品的解析。EXACT、CONTAINS、PARTIAL、VISUAL 可混批；后两者必须明确选择保留方。推荐全选只覆盖前两者且说明跨页。待删作品去重；保留与待删冲突指出作品并拒绝提交。不扩张关系，不合并图片或整理记录。

App 与 Worker 共用普通删除最小核心、报告和文件 manifest。URL_ARCHIVE 使用现有回收逻辑保留七天；其他来源沿用直接删除。一个确认弹窗列出两类作品、文件范围与内容/整理损失，默认勾选可选附属文件。准备只检查待删作品与现有删除范围，不读保留原件、不重哈希或运行相似度。

通用 SystemJob 的 payload 保存确认范围、逐项稳定 operationId，progress/result 保存进度及普通删除报告；逐作品串行，独立失败继续。停止后续删除为作品边界的领域操作，不忽略运行时失权/关闭信号；文件边界和事务边界检查执行权。归档只提交现有 ARCHIVE_MAINTENANCE，不等待占用 writer lane 的子任务。提交后留在结果页，刷新恢复后台进度。

## 升级停止条件

本版本不注册旧 ARTWORK_DEDUP_MAINTENANCE 执行器，旧 PREPARE/DELETE 新建和重试停止，历史保留只读。升级前必须盘点所有旧未结 operation/job/claims；无文件删除的任务明确取消并释放，已有文件删除的必须由旧版本按原清单收口。未结清不得部署移除执行入口的版本，不能盲删占用或终态字段。生产唯一已知卡住 operation `41d05b53-f315-4e41-8cc7-71c01263a22d`（job `b4de6eed-e85a-40c7-90c3-9b697957f7e8`）由用户于 2026-10-31 10:01:25.983+08 取消并复核，零文件删除；本次不再次操作生产。

根因已有证据：四个 Aug/Sep COMPLETED LEGACY 导入早于 Oct 23 generation 表，旧 drain 要求 `generations.length >= attempt`，导致每三秒永久排队且取消也卡在同一 guard。普通回收只拒绝真实活动导入，不对完成的历史导入补造 generation 要求。新流程不使用该 drain。

## 实现与独立审查

普通删除核心移至 `packages/pixishelf-job-executors/src/artwork-delete/`，App 保留原单作品接口。原有路径边界、共享引用、文件身份、当前写入冲突、两段短事务、会话身份及 manifest 重试继续适用。Worker 文件边界使用既有 signal，事务使用既有 fenced mutation；不新增逐文件数据库往返。停止后续删除持久化为领域请求，与失去执行权/Worker 关闭区分。未确认草稿不占来源，任务中心不能将其继续或重试入队。

根线程独立审查与实施线程修复后再次复核，重点关闭了以下实际遗漏：

- 入口：范围解析/预览改为管理员入口；通用任务控制和按钮均不能绕过确认；旧执行入口停用，旧 DTO 仅只读；结果页与“最近删除”均能找到新批次，旧历史折叠保留。
- 跨账户 payload：共享任务 DTO 只投影最小摘要，事件不透传私有 data，去重跳转读取摘要。确认损失中发起账户的评分、书签、阅读内容仅留 owner 检查后的批量详情。新增他账户共享 DTO 不含此信息的专项。
- 归档状态：回收提交与物理移动分开；摘要突出待移动/移动失败并链接既有回收任务；已 TRASHED 的重放直接显示已移入回收站，不因没有子任务而永久等待。
- 执行与性能：每项前置业务异常保留具体中文原因并继续独立项；失权向外传播；保存失败不覆盖已完成结果。显式选择只读所选组，跨页推荐保留已勾选的人工关系；轻量轮询在数据库侧投影摘要。确认文件清单展开才挂载并复用虚拟列表。
- 可读性/隐私：未知未核对数量保持未知，未配对数说明仅针对选中对照；归档也有损失摘要。动态进度提示只含编号/数量，标题继续使用隐私组件。最近一批紧凑显示，其余批次及逐作品明细按需展开。

未增加独立删除表、逐文件回执、来源 hold、去重墓碑或新恢复协议；不清除既有标记。upload/replacement 仅适配共享的小型内容/锁/manifest 工具，未整体重构。

## 隔离环境与样本

- 工作区：独立 worktree，主目录及用户现有服务未修改。
- PostgreSQL 16 容器 `pixishelf-batch-delete-postgres`，仅 `127.0.0.1:56432`；数据库 `pixishelf_batch`，通过既有 migrations deploy 初始化，未使用 db:push。
- 合成媒体、派生数据及日志位于 `/private/tmp/pixishelf-batch-delete-env/`；固定媒体根为其 `media/`。不读取真实/开发既有媒体或数据库。
- 独立 Next 开发服务 `127.0.0.1:56430`；独立 Worker 健康端口 `127.0.0.1:56411`。Chrome 桌面通过 `entry=direct` 实际登录、对照、选择、确认和刷新。
- fixture 包含四来源和四关系，PNG 与双帧 GIF，包含方多一张、部分重复一张未配对、疑似版本一张未配对及一张未核对动图；另加 20 组用于跨页。检测关系由 fixture 显式建立，本次未重新验收未改动的检测算法。

浏览器批次 `dd4fd03d-a9fa-4dbb-8b04-9640c5c7bb0a` 实际处理目标 #400/#402/#404/#406：三部直接删除，共 12 个媒体、303 个附属文件；#404 整包移入回收站，子任务 `cdb0ebd8-4218-4281-9b47-9ac5de64df99` 完成且保留期七天。24 部保留作品的 39 个媒体 SHA-256 全部与生成基线一致，另外 20 部未选作品及其 20 个媒体完好。完整脱敏结论见 [acceptance.json](assets/dedup-shared-deletion-2026-10-31/acceptance.json)。这些 SHA 只用于验收后的完整性核对，不在产品确认/删除链路中执行。

桌面截图：

- [逐张对照](assets/dedup-shared-deletion-2026-10-31/comparison.jpg)：疑似版本及未配对/未核对媒体。
- [跨页选择](assets/dedup-shared-deletion-2026-10-31/cross-page.jpg)：推荐与显式人工关系合计 24 部，翻页保留选择。
- [一次确认](assets/dedup-shared-deletion-2026-10-31/confirmation.jpg)：永久/七天回收分别列出，损失摘要、默认选中文件和折叠明细。
- [提交后刷新](assets/dedup-shared-deletion-2026-10-31/queued-after-refresh.jpg)：停留结果页，等待后台处理。
- [完成结果](assets/dedup-shared-deletion-2026-10-31/completed.jpg)：逐部结果，归档文件已移动。
- [最近删除](assets/dedup-shared-deletion-2026-10-31/records.jpg)：新记录可追溯，旧记录折叠。

## 专项与检查结果

下列结果按实际执行分组，不将重跑重复计数为额外覆盖。均通过；无待处理失败。

| 范围                             | 通过数 | 证据/执行说明                                                                                                                       |
| -------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| 既有普通单作品删除               |     44 | `services/artwork-service/__tests__/delete-artwork.test.ts`                                                                         |
| 普通确认文件虚拟列表             |     10 | `artwork-delete-preview.test.tsx`，含 2,000 文件选择/滚动                                                                           |
| 统一选择基础逻辑                 |      5 | `duplicate-selection.test.ts`                                                                                                       |
| 新批量 PostgreSQL/真实 FS 原八项 |      8 | 四源四关系、跨页/冲突/重复目标、未确认控制、独立失败/重试/停止、真实 writer/文件变化、正常关闭续跑、幂等竞争与旧升级 gate、阶段测时 |
| 定向新增故障                     |      2 | 真租约到期前首次文件动作被拒、数据库发布回滚后同 operationId 续跑且不重复 unlink/计数；只运行这两项，八项跳过是过滤结果             |
| 受影响 UI                        |     14 | review 5、comparison 6、旧 operation 只读 1、workspace 1、新进度展开/归档摘要/隐私 1                                                |
| 旧入口停用与共享 DTO 隐私        |      6 | candidate 2、disabled 2、public projection 2                                                                                        |
| Worker 注册表                    |     13 | 新执行器注册，生产不再注册旧删除版本                                                                                                |

故障细节：实际使 SystemJob 与 lane lease 到期，原文件 SHA 保持不变；发布事务在 Image/Artwork 删除后注入异常，数据库回滚且文件已删，再以原操作清单重放成功，无重复文件动作。归档已移动但父结果丢失的重放也覆盖。历史 FAILED 无占用允许启动；实际文件动作中断仍占用则阻止升级。共享文件、范围外文件、附属文件取消等普通安全不变量由保留的 44 项回归及新组合专项覆盖。

主要命令（在 worktree 根目录运行，App 测试路径相对 `packages/pixishelf`）：

```bash
pnpm --filter @pixishelf/next exec vitest run services/artwork-service/__tests__/delete-artwork.test.ts app/admin/artworks/_components/__tests__/artwork-delete-preview.test.tsx app/admin/duplicates/_components/__tests__/duplicate-selection.test.ts

# 仅本次隔离库；DATABASE_URL 与专项变量必须相同，测试也会核对。
task_validation_db='postgresql://pixishelf_batch:batch_fixture@127.0.0.1:56432/pixishelf_batch'
DATABASE_URL="$task_validation_db" QUEUE_KERNEL_TEST_DATABASE_URL="$task_validation_db" pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-batch-delete.postgres.test.ts
# 后补两项只运行最小过滤：
DATABASE_URL="$task_validation_db" QUEUE_KERNEL_TEST_DATABASE_URL="$task_validation_db" pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-batch-delete.postgres.test.ts -t 'fences the first|rolls back database'

pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-review.test.tsx app/admin/duplicates/_components/__tests__/duplicate-comparison-sheet.test.tsx app/admin/duplicates/_components/__tests__/duplicate-operation-sheet.test.tsx services/__tests__/artwork-dedup-direct-delete-candidate.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts services/background-task/__tests__/batch-delete-public-projection.test.ts
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-review.test.tsx app/admin/duplicates/_components/__tests__/duplicate-workspace.test.tsx
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-batch-delete.test.tsx
pnpm --filter @pixishelf/worker exec vitest run src/__tests__/executor-registry.test.ts

pnpm --filter @pixishelf/next typecheck
pnpm --filter @pixishelf/worker... typecheck
pnpm --filter @pixishelf/worker... build
pnpm docs:check
WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams
WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check
rg --files packages/pixishelf | rg '[A-Z]'
git diff --check
```

App `next typegen && tsc --noEmit`、Worker/DB/contracts/runtime/executors 类型检查与必要构建均退出 0。定向 oxlint 仅检查 63 个改动代码文件，0 警告/0 错误；Impeccable 四个主要变更组件检测为 `[]`。文档检查 360 篇通过，图检查 34 源与 23 内嵌 Mermaid 通过；本次只保留四张任务图源与对应输出，已打开成图核对。路径大写检查无命中（rg 退出 1 表示无匹配），diff whitespace 检查通过。没有执行全量 App lint/test/build。

执行中修复后重跑的情况：受影响 UI 首轮 17 通过/1 失败，失败是新测试未等待异步“删除所选”可用；补上等待后 review/workspace 6/6 通过。App 类型检查曾发现故障测试泛型包装错误，修正后退出 0。图检查首次缺默认 Chromium，改用已有 Chrome 后通过。Worker 构建保留既有 CJS import.meta 警告，不影响退出状态。真实浏览器还发现并修正对照查询重复取消、details onToggle 异步访问 currentTarget 的错误；后者由新增 UI 展开专项回归。

## Worker 重启证据

协议层专项先以 AbortController + release/reclaim 验证文件边界停止和 finally 释放普通锁。随后补做真实自建 Worker 进程 SIGTERM/restart，非仅模拟：

1. 合成目标 #568，稳定 operationId `c43e9581-00cd-46a3-ada2-6fd721997db4`，原清单 1,002 文件。任务 `068ccf04-d50b-4781-b1cb-c2b4cf31582d` attempt 1 在 `03:11:02.955Z` 开始。
2. `03:11:04.971Z` 已观察到 46 文件不存在，向自己的 Worker 发 SIGTERM。仅该验证进程使用已有 `WORKER_DISPATCH_DRAIN_GRACE_MS=1000`；全局默认 30 秒、dispatcher abort 宽限均未更改。
3. `03:11:05.971Z` grace 到期，`03:11:06.294Z` 任务 released，`03:11:06.307Z` 正常退出，无 ignored_abort；finally 释放文件锁。
4. 新进程在 `03:11:14.224Z` 领取 attempt 2，同 operationId 续原清单，`03:11:33.045Z` 完成。最终媒体 1、附属 1,001、失败 0，计数不重复，数据库作品已删。脱敏事件见 [worker-restart-events.json](assets/dedup-shared-deletion-2026-10-31/worker-restart-events.json)。

桌面四部批次也执行过默认 30 秒 grace 的正常 SIGTERM，该批在 grace 内完成，重启后的既有回收子任务完成移动。SIGKILL 残留 `.replace-write-lock` 未测试为自动恢复：沿用普通删除不偷锁规则，须停止写入并人工核对原清单/备份后恢复，不以超时删锁。

## 同配方样本阶段测量

普通入口与去重入口使用同一生成配方的四源四关系等价 fixture；已删除的物理文件不可能供另一入口再次删除。环境为隔离 PostgreSQL + 本地 SSD，不代表 NAS 延时。原始聚合见 [timing.json](assets/dedup-shared-deletion-2026-10-31/timing.json)。

| 已观测阶段/动作                      |    普通入口 | 去重批量入口 |
| ------------------------------------ | ----------: | -----------: |
| 确认准备                             |    57.05 ms |     78.01 ms |
| 本地派发排队                         |  无后台队列 |        66 ms |
| 执行总耗时                           | 1,082.87 ms |  1,076.26 ms |
| 文件准备聚合                         |    65.99 ms |     51.45 ms |
| 文件处理聚合                         |   314.63 ms |    280.48 ms |
| 删除 DB 阶段聚合                     |   566.65 ms |    418.91 ms |
| 执行期已观测事务调用                 |           7 |           15 |
| 原图片内容读取（readFile/open 监测） |           0 |            0 |
| unlink 次数                          |          15 |           15 |

事务口径是执行期调用观测，**不是全请求精确 SQL 事务数**：普通入口为三部直删的 6 次 guard begin/publish + 一次归档请求；批量为相同 7 次 + 每部前后共 8 次结果 checkpoint。普通归档事务由既有 App request 执行，专项明确补计一次。预览、确认提交、claim、队列心跳/进度、最终 finalize 等不在该 7/15 统计；归档物理移动另由其任务执行。DB 阶段耗时为共享核心观测点，亦不含全部排队/检查点成本，各聚合不要求相加等于总时长。生产 Worker 的 Started/Item 日志保留 queueMs、逐项阶段聚合；未采集为 null、确实不执行为 0，不冒充精确零耗时。

没有调用内容哈希或相似度算法，没有三秒 drain 循环。仍保留普通删除逐文件 fsync/manifest 成本；真实 1,002 文件恢复的文件阶段约 18.08 秒，不能据此给出 NAS 秒数承诺。本次没有额外性能改造。

## 环境停止与复现

2026-10-31 11:25:33+08 已停止自己的 App（Ctrl-C，退出 130）、Worker（SIGTERM，最后 PID 不存在）及数据库容器（Exited 0），保留容器、fixture、日志和截图。loopback 端口 56430、56411、56432 均已释放；没有停止用户服务。见 [cleanup.json](assets/dedup-shared-deletion-2026-10-31/cleanup.json)。

重新查看既有结果，可 `docker start pixishelf-batch-delete-postgres`，将终端 `DATABASE_URL` 设置为上述隔离 URL，并设置以下仅供本地验证的根：`SCAN_PATH`/`ARCHIVE_STORAGE_PATH`/`SOURCE_MEDIA_ROOT`/`ARCHIVE_ROOT` 指向 `/private/tmp/pixishelf-batch-delete-env/media`；`DERIVED_MEDIA_STORAGE_PATH`/`DERIVED_MEDIA_ROOT` 指向其 `derived`；`PIXIV_DATA_STORAGE_PATH`/`PIXIV_DATA_ROOT` 指向其 `pixiv`。App 在包内运行 `pnpm exec next dev --hostname 127.0.0.1 -p 56430`，使用本地验证专用 BETTER_AUTH_SECRET，BETTER_AUTH_URL/TRUSTED_ORIGINS 均为 `http://127.0.0.1:56430`。既有合成账户 `batch-review`，密码 `batch-fixture-pass`（仅隔离库）。查看 `/admin/duplicates?artistId=49&runId=86d69d03-f8e7-4412-b770-dd8a6cdc207b&entry=direct`。

需重建样本时，使用同隔离 URL 执行 `pnpm --filter @pixishelf/next exec tsx scripts/seed-batch-delete-validation.ts`，从输出读取新 run/artist；该脚本限制 loopback/端口/库名。真实续跑大清单脚本为 `scripts/seed-batch-delete-restart-validation.ts`，仅创建一次性合成任务。Worker 使用前述根环境、`WORKER_HEALTH_HOST=127.0.0.1 WORKER_HEALTH_PORT=56411`，运行 `node packages/pixishelf-worker/dist/main.cjs`；需要验证中途 SIGTERM 时才为该进程设置 1,000 ms drain grace。关闭时只对该次自建进程发 SIGTERM，确认退出，再 `docker stop pixishelf-batch-delete-postgres`。

本记录未执行生产升级、旧任务生产清理、NAS 验收、全量 App CI 或 SIGKILL 自动恢复。当前无未解决代码/专项失败；部署仍须先满足[旧任务收口门槛](../operations/runbooks/dedup-shared-deletion-upgrade.md)并按[备份恢复](../operations/backup-and-recovery.md)执行。
