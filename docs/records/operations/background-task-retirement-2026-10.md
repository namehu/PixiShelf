---
status: historical
scope: 2026-10 后台任务退役的开发验证、实例确认与证据限制
last-verified: 2026-10-11
sources:
  - docs/deployment/background-task-retirement.md
---

# 后台任务退役验证与生产确认

以下保留原记录，未在文档整理中重新执行发布或读取生产。版本、数量和本地路径仅描述对应日期。当前适用操作见[专用手册](../../operations/runbooks/background-task-retirement.md)。

## 实例上下文

2026-10-07 原记录保存的用户确认：NAS 部署目录为 `/vol1/1001/docker-compose/pixivShelf`，使用同目录 `.env` 与 `docker-compose.yml`；`config --services` 显示 postgres、app、imgproxy、worker，没有 scheduler。此信息仅属于当时实例，不是其他部署应复制的路径或服务清单。

## 验证证据

2026-10-07 在 v0.50.8（15e79aa5）工作区基线上完成第一阶段验证。数据库使用临时 PostgreSQL 15 容器，未连接生产库。

| 验证                                  | 结果                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| App lint、typecheck、production build | 通过；删除计划 time 字段后，两处卡片残留引用已修复并重跑                                                                                       |
| App 单元测试                          | 364 文件、2,342 项通过；默认跳过的 168 项 PostgreSQL 测试已分批指定专用数据库执行，全部通过                                                    |
| Worker 依赖链 typecheck、build、test  | 通过；原套件 1,391 项，加新增迁移回归 1 项，共 1,392 项通过                                                                                    |
| App test:integration                  | 13 项通过，18 项专用阅读/删除/系列测试因未配置各自环境跳过；image-count 既有清理逻辑仍输出 Artist 外键错误（不影响断言，但不能视为清理验收）   |
| 迁移                                  | 空库完整 90 份 migration 通过；v0.50.8 非空合成 fixture 升级保留 2 条任务、1 条失败确认和 1 条计划；新增自动化回归覆盖空值、中文路径与旧列不变 |
| 审计                                  | before/after 通过；注入 25 条非终态 v0 后，退出 1、计数 25、样本上限 20，25 条原状态均未改变；清理 fixture 后再次通过                          |
| 读取与恢复                            | 独立生成的 v0.50.8 Prisma Client 能读取升级后的任务/确认/计划；升级前 pg_dump 在另一空库 pg_restore 后计数一致                                 |
| 查询索引                              | 事务内 20,000 条合成记录，EXPLAIN ANALYZE 确认现代 payload 与 legacyDisplay 查询各自命中新增索引；样本已回滚                                   |
| 运行冒烟                              | 本次构建的 Worker + 临时媒体目录通过 READY 和 33 类型/38 版本 capability 检查；旧开关均为 false 时两个 lane 仍启动，SIGINT 正常排空退出        |
| Compose / 路径规范                    | dev/deploy Compose 解析通过；主应用大写路径检查和 git diff --check 通过                                                                        |

核心复验命令：`pnpm --filter @pixishelf/next lint`、`typecheck`、`test`、`test:integration`、`build`，以及
`pnpm --filter @pixishelf/worker... typecheck`、`test`、`build`。PostgreSQL 套件应显式设置对应测试环境变量，
不能只提供 DATABASE_URL 就把被跳过的套件计为通过。初始化测试要求独立的 `init_admin_test` 数据库。

以上为第一阶段初次验证时点的隔离合成 fixture、构建产物和客户端级证据。该时点尚未验证真实生产数据副本、App/Worker Docker 镜像升级与镜像级回退、
NAS 媒体同点恢复、真实浏览器媒体链路或 7 天观察；这些仍是相应发布门禁。此后用户确认两阶段均已部署生产，见文末生产确认记录。

## 本次开发环境实操

2026-10-07 已在开发环境完成实际升级：停止旧 Worker，确认无执行中任务与活跃租约，复制三个媒体目录、配置及 PostgreSQL custom dump；备份位于 `.local-data/retirement-backup-20261007-153746`，含文件哈希和旧镜像 ID。只应用 `20261007100000_background_task_retirement_read_model`，before/after 审计均通过，90 份 migration 已同步。

子 agent 审查后修复三处问题：关键帧历史重复投影、新审计命令在 entrypoint 中先迁移的顺序错误，以及 Worker 缺少新 schema 门禁。新增外层查询 PostgreSQL 回归 4 项、数据库门禁 19 项、Worker 配置/预检/部署边界 26 项通过；App lint/typecheck 通过。

开发 Docker Worker 已重新构建并重启，镜像 ID 为 `sha256:bd31428449fe7d34649ddb198372f8b2bf7ff32130df6d42ef8aae31c31fe869`，READY 和 33 类/38 版本 capability 检查通过。宿主机 App 在 `http://localhost:5430` 运行。

浏览器回归由 GPT-6.1 Sol（high）在本地 Chrome 执行：确认计划设置不再编辑旧时间，历史筛选、详情、媒体空队列正常；通过页面提交 Pixiv AI 标签只读预检 `cmuxsygc20002nph6twvmqclw`，新 Docker Worker 在 1 秒内完成，`dryRun=true`，核对 5/5、应用新增/移除/转换均为 0，历史和实时更新可见。测试未执行正式回填或清理。开发库无失败归档收件、无 v0 关键帧/优化任务样本，这些路径的证据仍由隔离 PostgreSQL 回归提供。

## 二阶段开发验证记录（2026-10-11）

- 子 agent 分别实现 App、DB 和 Runtime/Executor，交叉独立审查后未发现阻断问题；补齐了 Worker 关键帧失败发现和旧 cutover 审计的旧列依赖。
- 空库完整 92 条 migration 通过；开发检查点恢复至隔离 PostgreSQL 后，before/upgrade/after 通过。新增迁移测试覆盖违规数据拒绝、事务回滚、v0 历史、失败确认、计划删除与约束正反例。
- DB 全套 189 项通过，增强门禁后聚焦 35 项通过；Job contracts 102、Runtime 108、Executor 常规 787 与 PostgreSQL 132、Worker 112 项通过。上述数字为各次套件结果，聚焦重跑不重复相加。
- App 全量 2,456 项通过，另外 5 项因沙箱禁止监听/tsx IPC 首次失败，在提权的 35 项定向复验中全部通过；172 项 PostgreSQL 测试显式启用并串行执行通过。App lint/typecheck/build、Worker 依赖链 typecheck/build、Prisma validate、路径规范与 diff 检查通过。
- App integration 13 项通过；20 项专用阅读/删除/系列用例未配置各自环境而跳过，不计通过。image-count 既有清理继续输出 Artist 外键错误，不能视为其清理流程验收；与本次任务相关的归档删除等 PostgreSQL 套件另已执行。
- 开发检查点 `.local-data/retirement-phase2-backup-20261011` 保存数据库 dump/哈希、配置、142 个媒体文件的核对清单和旧 Worker 标签 `pixishelf-worker:retirement-before-phase2-dev-20261011`；备份成功恢复到隔离库。未修改生产环境。
- 开发库实际只新增应用 `20261011000000_background_task_retirement_contract`，before/after 均 ready，92 条 migration 同步。新 Docker Worker 镜像 `sha256:7e0a08f0d3d4ceee368b1b0c6faf49f6a3fcf4be6bd0bbc5c3e1d5692f9e99b1` 已启动，READY 与 33 类/38 版本 capability 检查通过；App 运行于 localhost:5430。
- 此开发记录不证明真实生产数据副本或 NAS 媒体恢复演练完成；生产观察和发布结果见后续用户确认，缺少的实例证据仍需归档。

浏览器验收由 GPT-6.1 Sol high 在真实 Chrome 完成（`entry=direct`、既有登录会话）：计划窗口/优先级/上次入队、历史失败详情、媒体队列和归档页显示正常。只读预检 `cmv33eqcm0001ihyv3fy9561c` 核对 5/5，实际新增/移除/转换均为 0，新 Worker 执行事件 707–712 完整，页面无需刷新即完成。报告与截图位于 `/tmp/pixishelf-phase2-browser-20261011/report.md`。原生浏览器工具无法检查控制台和网络，SSE 传输未独立验证；媒体/归档没有记录，未覆盖单项控制；未保存计划或触发自动计划。相应业务约束由隔离 PostgreSQL 回归覆盖，不将空页面检查计作完整业务验收。

最后补充的 12 项迁移回归使用真实外键验证：失败确认完整保留，迁移后删除计划触发 `ON DELETE SET NULL`，任务原计划日期、状态和来源保留，删除后审计通过；DB typecheck 再次通过。隔离测试容器已停止，开发 App/Worker 保持运行。

## 二阶段生产确认（2026-10-11）

用户在本会话确认一阶段生产观察无异常，随后使用 latest 镜像流程完成二阶段部署，并确认：

- 迁移前、迁移后审计均为 ready；
- Worker 检查通过；
- 只读预检通过。

以上属于用户确认，代理未直接连接 NAS，未读取实际 digest、原始审计输出或快照记录。确认日期不代表精确部署时间，也不据此推断单独的周级 GC、恢复演练或全部业务链路已有独立证据。本次代码退役与生产发布已完成，不需要继续删除 legacyDisplay、历史任务、失败确认或已发布 migration。

运维收尾：把实际 App/Worker 容器的镜像 ID、RepoDigests、审计报告和数据库/三个媒体目录的恢复依据归档到本次备份目录；latest 会变化，不能作为唯一版本依据。保留本次迁移前恢复集合和旧镜像，正常使用中观察真实任务及下一次自动计划/GC。隔离恢复验证库可在证据归档且确认无依赖后单独清理，不批量删除备份或 Docker 卷。删列后回退仍须匹配的数据库、媒体、配置和镜像。
