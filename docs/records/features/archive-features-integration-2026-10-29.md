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

## 集成独立审查

集成实现提交 `a18a9d91` 经新的独立 reviewer 审查，未发现必修问题。独立复跑 74 项：来源／暂缓 UI 与输入契约 58 项、暂缓下载 PG 14 项、来源忽略 PG 1 项、退休后 purge PG 1 项，全部通过；另核对两条迁移路径的 schema 快照一致。测试期间只停止集成 Worker，结束恢复并通过 ready 检查。

最终完整 lint 发现共享来源组件合并后为 1219 行，超过仓库 1200 行限制。提交 `3ff5986f` 将已有错误展示组件原样移到相邻 `archive-discovery-source-error.tsx`，没有新增状态或修改回调、文案。该两文件差异再次独立复审通过，来源组件 47 项测试通过；完整 lint 与应用 typecheck 复跑通过。此问题按集成缺陷修复，未归入基线失败。

最终主应用测试首轮为 3 个文件、20 项失败：两个路由鉴权测试仍按旧入参期待，缺默认 `downloadScope: ALL`；详情布局测试新增 coverage 读取后未声明服务替身，18 项误触发真实数据库初始化。提交 `eb01db7c` 只更新三个单测文件：保留原鉴权、URL 参数、布局和链接断言；新增当前 revision 数量、作品／修订传入页脚和页脚位于媒体之后的验证。定向 47 项通过，独立复审再次执行 47 项全部通过，确认未削弱覆盖。最终主应用完整复跑 3476 项通过、351 项按环境门禁跳过，首轮失败日志单独保留；不把这些失败归入既有 PostgreSQL 基线问题。

Worker 依赖链首轮还发现 publisher 直接入队退休任务违反既有架构边界。提交 `10abadeb` 保持原测试不变：publisher 仅写领域发布与退休意图，现有 `phase-handoff.ts` 负责同一 fenced finalizer 内退休任务、`job.queued` 审计和父任务完成。新增真实 PG 故障注入证明，父完成提交失败时新 revision、退休意图、子任务、图片扩容均回滚，原 20 张保留；重试只创建一个 v2 退休任务及 queued 事件。完整发布／退休／恢复／purge 56 项和架构边界 1 项通过；执行器完整复跑 941 项通过，Worker 116 项通过。独立 reviewer 再次核对事务、版本、审计、幂等与结果结构，并独立复跑正常补全、purge、publish-rollback 三项 PG 和架构边界一项，全部通过，无必修发现。

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

测试不访问真实原站，不使用用户媒体。数据库测试期间正常停止集成 Worker，完成后重启，该轮未操作原三个功能环境。最终 C 修复回灌的验证和重启另记下文。日志分别保存在 `/tmp/archive-integration-{deferred-pg,partial-pg,retired-purge,ignored-pg,ui-scope-fix,entry-regression,typecheck}.log`。

### 已知基线失败

B 扩展回归 `services/archive-intake/__tests__/archive-intake-service.postgres.test.ts` 得到 **13 失败、3 通过**。作者将未修改基线 `3a5b5ee` 解包到 `/private/tmp/pixishelf-deferred-main-3w5xvib4`，用同锁文件依赖和同隔离库重跑，同样 13 失败、3 通过。主要为旧 Provider 链接夹具／来源证明假设，以及锁顺序测试 5 秒超时。基线输出位于 `/Users/namehu/.codex/worktrees/archive-deferred/PixiShelf/.local-data/runtime/baseline-intake-tests.log`，基线路径文件在同目录 `baseline-path`；集成架构师已读取并核对结果。没有放宽失败断言，也不把该套件计入通过数量。后续最终检查若出现其他失败须单独核对，不能据此一概归为基线。

## 独立运行与人工入口

| 环境       | Web  | ImgProxy | PostgreSQL | Worker health |
| ---------- | ---- | -------- | ---------- | ------------- |
| A 忽略     | 5440 | 5441     | 5442       | 5443          |
| B 暂缓     | 5450 | 5451     | 5452       | 5453          |
| C 部分归档 | 5460 | 5461     | 5462       | 5463          |
| 集成       | 5470 | 5471     | 5472       | 5473          |

保留分支与对应 worktree（父目录 `/Users/namehu/.codex/worktrees/`）：

| 分支                                 | 目录                                     | 功能分支最终提交                              |
| ------------------------------------ | ---------------------------------------- | --------------------------------------------- |
| `codex/archive-scoped-ignore`        | `archive-scoped-ignore/PixiShelf`        | `1f120aa74e7974df90d5ea4da991d387576fc8e1`    |
| `codex/archive-deferred`             | `archive-deferred/PixiShelf`             | `06b611c618bfa9999d179d5080427ebe6d09ba23`    |
| `codex/archive-partial`              | `archive-partial/PixiShelf`              | `b78a1fcd212ff469e65378d331fa52517555e6fc`    |
| `codex/archive-features-integration` | `archive-features-integration/PixiShelf` | 三功能已审代码及最终验收修复；查看该分支 HEAD |

main 保持 `3a5b5ee26eec303378ed8b852379b033ef625420`，各功能分支工作区干净。推荐人工回归集成入口；三个独立功能入口保留；C 自身的修复已同步回 C，暂缓范围等集成专属差异未反写原分支。

集成 worktree 为 `/Users/namehu/.codex/worktrees/archive-features-integration/PixiShelf`。媒体、派生媒体与 Pixiv 路径均位于该 worktree 的 `packages/pixishelf/.local-data/`；容器只读挂载对应媒体目录，未复用三个功能环境的数据。运行 PID 与日志保存在 `packages/pixishelf/.local-data/runtime/{web,worker}.{pid,log}`；最终 Web PID 97330，Worker PID 96901；C Worker 已重建为 PID 97228。PID 只表示此次交付时刻，之后以对应 pid 文件和实际监听为准。

集成 Web 最初使用独立 dev 服务；最终构建前正常停止该服务，构建成功后在 `packages/pixishelf` 运行 `pnpm exec next start --hostname 127.0.0.1 --port 5470`，现使用已验证的生产产物供人工回归。原 A/B/C 仍为各自端口的开发服务。Worker 在 `packages/pixishelf-worker` 执行 `node --env-file=../pixishelf/.env.local dist/main.cjs`；就绪检查使用相同 env-file 运行 `dist/healthcheck.cjs --mode=ready` 和 `dist/capability-audit.cjs`。不要运行根目录 pnpm dev。四个 Web 的 `/login?entry=direct` 和四个 Worker 的 `/readyz` 均实测 HTTP 200。集成与 C 的新 Worker ready 检查通过，各自能力审计确认 1 个 READY Worker、39 种任务／62 个版本。

首次访问 `http://127.0.0.1:5470/login?entry=direct` 创建该空库的首个管理员，使用独立测试用户名及至少 8 位密码。账户已存在时正常登录；没有默认密码，也不使用生产账户。随后访问 `http://127.0.0.1:5470/admin/archive/inbox?entry=direct`。A/B/C 的空库也遵循同一流程，换用对应端口。初始化细节见[空库初始化记录](./archive-partial-coverage-2026-10-29.md#空库首次账户初始化)。

## 人工回归清单

1. 在两个来源发现相同画廊，忽略后分别核对“本来源已忽略”和全局列表；恢复后确认各处同步消失。
2. 把单项及多项放入“稍后决定”，刷新、切换来源、删除原来源后查看保留记录；从稍后列表选择全部或前 20 张，核对入箱范围和批量一致性。
3. 对超过 20 张的 E-Hentai 画廊选择前 20 张，确认详情只展示本地文件、数量为本地／来源总数，底部原站入口新标签打开。MANUAL 解析后再改范围同样应正确入箱。
4. 给部分归档设置阅读进度、评分与图片标记后补全，下载过程中旧图仍可读；完成后原图状态保留，新图未读，详情数量更新，退休任务成功后旧重复目录清除。
5. 重复扫描／入队不自动补齐或缩小已有归档；若补全期间来源身份／顺序证据变化，确认失败提示、旧内容保留，并按现有完整更新确认流程处理。

## 最终统一检查与 C 同步

最终实现代码为集成 `10abadeb8ed2b0706cc94de9c740e104ecc0628e`；随后仅更新本验收记录。所有实现差异均已独立审查通过。

| 最终检查                                       | 实际结果                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| 主应用 `pnpm lint`                             | 0 警告、0 错误                                                                      |
| 主应用 `pnpm typecheck`                        | route typegen 与 tsc 通过                                                           |
| 主应用 `pnpm test`                             | 472 文件通过、49 文件跳过；3476 测试通过、351 跳过，无失败                          |
| 主应用提升权限 `pnpm build`                    | 通过；编译 16.0 秒，46 个静态生成项完成。只执行一次生产构建                         |
| DB `db:validate` / `db:generate`               | 架构有效；合并后已 generate，132 迁移双路径通过                                     |
| `pnpm --filter @pixishelf/worker... typecheck` | DB、contracts、runtime、executors、worker 全通过；职责修复后 executors 类型再次通过 |
| `pnpm --filter @pixishelf/worker... build`     | contracts、runtime、executors、worker 构建通过；集成 Worker 运行该产物              |
| `pnpm docs:check`                              | Markdown 链接、锚点、路径大小写及围栏通过                                           |
| `pnpm docs:diagrams:check`                     | 34 个图源、23 个内嵌 Mermaid 块检查通过                                             |
| 主应用 kebab-case / `git diff --check`         | 无大写路径，diff 检查通过                                                           |

Worker 依赖链测试先生成本地 dedup 原生模块；首轮在上文架构测试处中断，修复后只复跑受影响 executors 及尚未开始的 worker，没有重复已通过的其他包。最终各包结果如下：

| 包            | 通过 | 跳过 |
| ------------- | ---- | ---- |
| DB            | 191  | 277  |
| job-contracts | 173  | 0    |
| job-runtime   | 29   | 99   |
| job-executors | 941  | 497  |
| worker        | 116  | 11   |

标准单元命令未设置 PostgreSQL 专用测试环境变量，因此对应测试按自身门禁跳过；不将跳过计入通过。真实 PG 已另执行上文迁移、暂缓、忽略、发布／退休／恢复等专项。`pnpm test` 本身排除主应用 integration、jsdom e2e 命名套件和扫描 fixture，未宣称完整浏览器或全仓库所有组合都已验证。最终日志位于 `/tmp/archive-integration-final-{app-lint,app-typecheck,app-test,app-build,db-validate,chain-typecheck,chain-test,executor-worker-test,chain-build,publication-pg,docs,diagrams}.log`；首轮 app 失败另存 `app-test-first.log`。

为避免保留的独立 C 环境留有已知问题，机械回灌 `eb01db7c` 为 `0ef04862`，已审 purge 测试 patch 为 `e5464c56`，`10abadeb` 为 `b78a1fcd`。独立 reviewer 核对两个 range-diff 完全匹配、purge patch-id 一致、七个文件与已审集成一致，无冲突或丢失行为。C 本地再次通过页面／鉴权／页脚 47 项、架构 1 项、正常补全／提交失败回滚／purge 三项真实 PG；应用和执行器 typecheck 通过，Worker 重建并通过 ready/capability。只对选中的三个 PG 场景执行回归，其余 53 项在该次定向命令中未选中；集成已执行完整 56 项。

没有未解决的本次实现或审查问题。已确认仍存在上文基线 PostgreSQL 套件的 13 个既有失败，未修改或掩盖。按用户要求未做浏览器验证，登录后的交互和真实原站行为由用户按清单人工回归；未部署、推送、创建 PR 或合入 main。
