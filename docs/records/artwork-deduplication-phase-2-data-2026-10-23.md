---
status: historical
scope: 同艺术家去重第二阶段数据契约、领域 API 与控制面定向验证
last-verified: 2026-10-23
sources:
  - docs/design/artwork-deduplication/phase-2-contracts.md
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
---

# 第二阶段数据与控制面验证

本记录只对应 `codex/artwork-deduplication` 工作树阶段 2 的数据、契约和 API 实施，不代表生产部署或浏览器验收。按用户调整，每阶段进行定向测试与独立审查，真实浏览器留最终统一验收。未提交源码，由主 agent 统一审查、汇总和提交。

## 实施范围

- 冻结有效 ArtworkArtist 范围；同艺术家活动 run 的数据库唯一约束涵盖暂停。稳定 runId、执行版本、控制版本与账户绑定幂等命令。
- 分页 Item/Media/Group/Member 表；大小和内容多重集合在 SQL 内精确聚合，不保存两两关系或把全集媒体塞入 payload。
- 最终分组核对当前内容源 revision/mediaEpoch、成员签名及完整计数，失效项转 CHANGED。局部失败不冒充整 run 失败，根故障与正常零重复有不同状态/文案。
- `ARTWORK_DEDUP_SCAN@1` 严格 payload；SYSTEM/900/BACKGROUND_WRITER 固定，包括 aging。通用 enqueue/child/pause/resume/cancel/retry/priority 拒绝绕过领域。
- authProcedure 与 expectedUserId 匹配；实例管理事实共享，requestedBy 仅审计。DTO 不包含原媒体路径、完整 hash 或私人标记。
- 持久 reader 占用在失租约后仍保留。离线恢复复用三通道停写门禁，绑定 inspect 摘要、原 token/版本和操作者，保留审计；不修改源 gate 或原媒体。
- run.rootBindings 保留首次根身份，继续和 retry 不能静默接受新根（执行器核验由执行器记录覆盖）。

## 环境、迁移与恢复依据

仅使用本机专用 `dedup_tests` PostgreSQL fixture；没有访问浏览器业务库或真实媒体。正式部署 `20261023004000_artwork_dedup_detection`，验证发现的失败原因同步和根绑定分别追加 `20261023004100_artwork_dedup_failure_causes`、`20261023004200_artwork_dedup_root_bindings`。最终共有 106 个 migration；通过 `db:deploy` 和 `db:generate`，未使用 db:push。

04000 在同一未提交阶段的最初 fixture 部署后补齐 STARTING 检查；该单项检查只在可丢弃 `dedup_tests` fixture 中以同一 SQL 对齐。此后变更全部使用追加正式迁移。最终 04000–04200 的空/非空升级测试均在事务隔离 schema 中应用源码迁移并回滚，核对旧 Artwork/Image/Job 未重写、BigInt 精度保留、新 CHECK/unique/FK/trigger 生效以及 schema 自清理。生产升级仍需按备份恢复基线保存数据库和媒体同点检查点；本阶段 migration 只增表/列/约束，不进行媒体回填或文件 I/O。

## 实际检查

| 检查                                            | 结果                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| DB `artwork-dedup.postgres.test.ts`             | 6/6 通过：冻结分页、精确候选、指纹碰撞分组、变更/旧执行拒绝、reader 占用、离线精确恢复 |
| DB `artwork-dedup-migration.postgres.test.ts`   | 2/2 通过：空/非空旧 schema 升级、约束与状态同步                                        |
| App `artwork-dedup-service.postgres.test.ts`    | 5/5 通过：并发启动、幂等/CAS、共享实例权限、原范围 retry、通用入口保护、事务失败零写入 |
| Router `artwork-dedup-auth.test.ts`             | 3/3 通过：无 Session、错账户、伪造字段/超限输入                                        |
| Contracts `artwork-dedup.test.ts`               | 2/2 通过：严格 payload、lane/默认资源上限、输入身份                                    |
| Runtime `artwork-dedup-policy.postgres.test.ts` | 2/2 通过：禁止子任务通用创建/通用取消、24 小时 aging 后仍 priority 900                 |
| Worker `artwork-dedup-reader-recovery.test.ts`  | 1/1 通过：强制停写确认、精确 token/digest、未知/重复参数拒绝                           |
| DB `database-client.test.ts`                    | 27 通过、11 为既有 skip：同步新 readiness inventory/latest migration                   |
| 既有 media-content-recovery 停写相关定向回归    | 5 通过、31 因 `-t` 范围未运行；覆盖 live writers 与跨通道停写保护                      |
| DB/contracts/runtime/Worker typecheck           | 通过                                                                                   |
| App `tsc --noEmit`                              | 通过，日志 `/tmp/dedup-app-tsc-final.log` 为空                                         |
| Prisma validate/generate                        | 通过                                                                                   |
| 新增数据/API/恢复入口及相关测试定向 oxlint | 15 文件 0 warning / 0 error |
| 主应用普通路径大小写与 git diff --check         | 通过                                                                                   |
| 图示一致性检查 | 环境阻塞：缺少 Playwright chromium_headless_shell-1194；本子任务未修改图源或 SVG |
| 文档链接检查                                    | 最终 200 Markdown 文件通过                                     |

使用现有 pnpm/rg；未运行主应用全量 build/test。第一次调用 ESLint 发生既有配置循环 JSON 异常，仓库实际 lint 使用 oxlint，后续按实际配置运行定向 oxlint，新文件的 curly 项已修复。对既有 queue-repository.ts 的扩展 lint 检查报告既有超 1200 行与未使用 EXECUTING_JOB_STATUSES；未扩大本阶段范围修改该历史文件结构。早期测试发现并修复 Prisma advisory lock 参数 bigint/int 重载与测试跨包 import 路径；修复后对应测试通过。

规模、NAS、下载/浏览/发布竞争和真实 controlled reader 测试由主 agent 与执行器记录汇总。此记录不将 SQL 聚合或单元检查称作 NAS/浏览器验收。独立数据代码审查由未参与实施的 agent 另行记录。

## P2-D201 最终发布并发窗口修复

针对[独立数据审查 P2-D201](./artwork-deduplication-phase-2-data-review-2026-10-23.md)，本次只修改 `buildArtworkDedupGroups` 的最终事务锁定和相应契约、回归。复用既有 `lockCreatorCatalog`，在 resource/job fence、run 锁之后取得创作者协调锁，再由数据库按 Artwork ID 升序锁住本 run 全部 COMPLETE 项对应作品；锁定查询只返回计数，不把全集作品或媒体搬入 Worker。随后复核归属和完整内容证据、建组，保持锁直到调用方真实 `scope.complete` 最终 CAS 和事务提交。没有新增锁体系、迁移、目录/Image 锁或执行器调用要求。

锁序核对：创作者编辑、合并与发布遵循 catalog → Artwork；owner publication 先取得目录/pathWrite 锁，业务回调再取得 catalog/Artwork。最终分组不再取得目录或 Image 锁，因此不会形成 Artwork → 目录的反向等待。Image UPDATE/DELETE 的既有语句触发器在推进内容源前按 Artwork ID 取锁；分组仅普通读取内容证据，不等待 Image 行锁。写入先完成时，新语句快照使过期项转 CHANGED；检测先获得锁时，内容/归属写入在完成提交之后才能使结果失效。

新增运行时 `artwork-dedup-publication.postgres.test.ts` 使用真实 `PostgresQueueRepository.withFencedExecutionTransaction` 与 `scope.complete`，在 helper 最终复核 SQL 之后设置双事务屏障，并用 `pg_blocking_pids` 确认真实数据库等待关系。7/7 通过：Image 路径修改、Image 删除、`editArtworkCreators` 移除有效归属各自覆盖检测先锁/写入先锁两种交错；另覆盖建组后最终租约过期，确保组、DONE 状态和完成意图全部回滚且锁释放。检测先锁时写入事务能够观察到已提交 COMPLETED；写入先锁时失效项为 CHANGED，组和成员均为零。

验证仅使用 `127.0.0.1:55432/dedup_tests`，唯一 `dedup-publish-<uuid>` 合成夹具；测试不读文件、不替换其他测试租约，最终按自身 IDs 清理。新增用例放在 runtime 既有测试目录，以直接使用真实完成围栏，未让 DB 包依赖 runtime。既有 DB `artwork-dedup.postgres.test.ts` 6/6 通过；DB/runtime 类型检查、两个改动 TypeScript 文件的定向 oxlint、文档链接与空白/路径检查通过。日志为 `/tmp/dedup-d201-publication-test.log`、`/tmp/dedup-d201-db-test.log`、`/tmp/dedup-d201-db-typecheck.log`、`/tmp/dedup-d201-runtime-typecheck.log`、`/tmp/dedup-d201-lint.log`。未执行全量测试、构建、浏览器或规模基准；独立复审结论待原 reviewer 确认。
