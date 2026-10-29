---
status: historical
scope: 2026-10-29 来源忽略范围、稍后决定与部分归档的集成、独立审查及验证证据
last-verified: 2026-10-29
sources:
  - packages/pixishelf/services/archive-uploader/discovery-deferred-service.ts
  - packages/pixishelf/services/archive-uploader/__tests__/discovery-deferred.postgres.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts
  - packages/pixishelf-db/prisma/migrations/
---

# 三项归档功能集成验证

基线为 `3a5b5ee26eec303378ed8b852379b033ef625420`。三个功能均在独立分支和环境开发、经独立审查修复后，按 A→B→C 合入第四 worktree 的 `codex/archive-features-integration`。没有合入 main、推送或创建 PR。当前规则分别由[来源发现](../../features/archive-discovery.md)、[部分归档与补全](../../features/archive-partial-coverage.md)维护；本记录只保存证据与剩余边界。

## 原分支审查关闭

下表替代各分支早期记录中的“待复审”状态；独立复审结论由总架构师收集，作者定向测试不替代独立审查。

| 分支                            | 已审提交               | 独立发现与修复                                                                     | 独立复审证据                                             |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A `codex/archive-scoped-ignore` | `7584bd77`、`1f120aa7` | 扫描完成未刷新来源忽略成员列表；补单来源及批量扫描失效                             | 53 项复验通过，P2 关闭                                   |
| B `codex/archive-deferred`      | `049828a5`、`06b611c6` | 扫描完成未刷新稍后列表；旧收件项重试成功未清暂缓；补身份锁、成功入队清理和缓存失效 | 76 项及原挑战 1 项通过，两个 P2 关闭                     |
| C `codex/archive-partial`       | `a0663196`、`e2d8ae89` | MANUAL 改范围后 Intake 显示旧范围；创建、复用、并发恢复均同步实际 Import 范围      | 原 48 项真实 PG 通过；补丁原挑战与回归 9 项通过，P2 关闭 |

A/B 合并时保留“查看本来源已忽略”和“查看本来源稍后决定”两个入口，并保留扫描完成后两类列表的失效。C 的导入冲突只合并 helper 导入，不回退 B 已审的 creator→identity→capacity 锁顺序或暂缓清理。收件 DTO 选择移到 `archive-intake-wire.ts`，用于遵守主应用文件长度规则。

集成补齐 B 新入口：`downloadDeferredItems` 接收 `ALL | FIRST_20`、默认 `ALL`，范围转发到收件服务并参与批量收据指纹。共用设置控件及客户端请求 key 已携带范围；来源删除后，单项及批量仍使用服务器保留的合法来源地址。

## 数据库迁移与恢复边界

独立 PostgreSQL 容器 `pixishelf-integration-postgres` 绑定 `127.0.0.1:5472`，运行库为 `pixishelf_integration_dev`，另有仅用于空库重放的 `pixishelf_integration_fresh`。未连接业务库。凭据仅保存在本 worktree 忽略的 `.env.local` 与 `.local-data/runtime/postgres.env`，没有写入版本库。

两条迁移路径均成功：

1. 运行库先部署 A/B 的 131 项迁移，再追加 C 的部分归档迁移。
2. 新空库按目录顺序部署全部 132 项迁移，其中末三项依次为 `20261029110000_archive_discovery_deferred`、`20261029110000_archive_partial_coverage`、`20261029110100_archive_deferred_commands`。

两库 `pg_dump --schema-only --no-owner --no-privileges` 去除随机 restrict 标记后完全一致，SHA-256 为 `dcf9c55ff05908c632b11cd3a92a16fdf96ad6ab1419a0df7dcc60f99f85a469`。14 类批量命令和 6 类目标全部保留，包括四类暂缓命令及 `DEFERRED_DISCOVERY_ITEM`；未使用 db:push、未删除枚举或改写迁移历史。对应日志为 `/tmp/archive-integration-{upgrade,fresh}-deploy.log`，schema 快照为 `/tmp/pixishelf_integration_{dev,fresh}-schema.sql`。

这些证据验证空库和已装 A/B schema 的前向迁移，不代表生产备份恢复演练。正式实例须按[部分归档升级手册](../../operations/runbooks/archive-partial-coverage.md)建立数据库与媒体同点恢复集合；退休目录已删除后不能直接运行旧程序。

## 集成定向验证

| 检查                             | 结果                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 暂缓与范围实际 PG 事务           | 14 项通过，含删来源后的 ALL/FIRST_20、收据重放／范围冲突、混合存活来源的批量统一范围，并继续生成 30／20 项真实下载计划 |
| 部分归档下载、发布、恢复整组     | 54 项通过                                                                                                              |
| 退休后 purge                     | 另增 1 项通过：旧部分目录已退休缺失→回收→恢复→再次回收→永久清理，验证 Artwork 删除和所有相关物理路径清除；套件现 55 项 |
| 按来源全局忽略 PG                | 1 项实际执行通过；该用例显式允许本集成隔离库，仍拒绝其他数据库                                                         |
| 来源／暂缓 UI 和输入契约         | 50 项通过；共享批量扫描组件另有 8 项通过                                                                               |
| 共享入箱服务、补全服务及入箱组件 | 51 项通过                                                                                                              |
| 应用类型检查                     | 通过                                                                                                                   |

测试不访问真实原站，不使用用户媒体。数据库测试期间正常停止集成 Worker，完成后重启，未操作原三个功能环境。日志分别保存在 `/tmp/archive-integration-{deferred-pg,partial-pg,retired-purge,ignored-pg,ui-scope-fix,entry-regression,typecheck}.log`。

### 已知基线失败

B 扩展回归 `services/archive-intake/__tests__/archive-intake-service.postgres.test.ts` 得到 **13 失败、3 通过**。作者将未修改基线 `3a5b5ee` 解包到 `/private/tmp/pixishelf-deferred-main-3w5xvib4`，用同锁文件依赖和同隔离库重跑，同样 13 失败、3 通过。主要为旧 Provider 链接夹具／来源证明假设，以及锁顺序测试 5 秒超时。基线输出位于 `/Users/namehu/.codex/worktrees/archive-deferred/PixiShelf/.local-data/runtime/baseline-intake-tests.log`，基线路径文件在同目录 `baseline-path`；集成架构师已读取并核对结果。没有放宽失败断言，也不把该套件计入通过数量。后续最终检查若出现其他失败须单独核对，不能据此一概归为基线。

## 独立运行与人工入口

| 环境       | Web  | ImgProxy | PostgreSQL | Worker health |
| ---------- | ---- | -------- | ---------- | ------------- |
| A 忽略     | 5440 | 5441     | 5442       | 5443          |
| B 暂缓     | 5450 | 5451     | 5452       | 5453          |
| C 部分归档 | 5460 | 5461     | 5462       | 5463          |
| 集成       | 5470 | 5471     | 5472       | 5473          |

集成 worktree 为 `/Users/namehu/.codex/worktrees/archive-features-integration/PixiShelf`。媒体、派生媒体与 Pixiv 路径均位于该 worktree 的 `packages/pixishelf/.local-data/`；容器只读挂载对应媒体目录，未复用三个功能环境的数据。运行 PID 与日志保存在 `packages/pixishelf/.local-data/runtime/{web,worker}.{pid,log}`；启动时 Web PID 90566，Worker 经定向 purge 后重启为 91204。

Web 在 `packages/pixishelf` 执行 `pnpm prepare:webp` 后运行 `pnpm exec next dev --hostname 127.0.0.1 --port 5470`。Worker 在 `packages/pixishelf-worker` 执行 `node --env-file=../pixishelf/.env.local dist/main.cjs`；就绪检查使用相同 env-file 运行 `dist/healthcheck.cjs --mode=ready` 和 `dist/capability-audit.cjs`。不要运行根目录 pnpm dev。HTTP 登录页实测返回 200，Worker ready 健康检查通过，能力审计确认 1 个 READY Worker、39 种任务／62 个版本。

首次访问 `http://127.0.0.1:5470/login?entry=direct` 创建该空库的首个管理员，使用独立测试用户名及至少 8 位密码。账户已存在时正常登录；没有默认密码，也不使用生产账户。随后访问 `http://127.0.0.1:5470/admin/archive/inbox?entry=direct`。A/B/C 的空库也遵循同一流程，换用对应端口。初始化细节见[空库初始化记录](./archive-partial-coverage-2026-10-29.md#空库首次账户初始化)。

## 尚待完成

集成实现须由新的独立 reviewer 审查，修复与复审后才执行最终主应用 lint/test/提升权限 build、受影响 Worker/job 依赖链及文档检查。最终结果随后在本节登记，不以此前分支检查代替。按用户要求未做浏览器验证，登录后的交互和真实原站行为由用户人工回归；未执行部署、推送或合入 main。
