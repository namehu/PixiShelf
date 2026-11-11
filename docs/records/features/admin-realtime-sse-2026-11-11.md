---
status: historical
scope: 任务总览、动图时长和归档收件箱改用 SSE 的本地验证、审查及发布边界
last-verified: 2026-11-11
sources:
  - packages/pixishelf-db/prisma/migrations/20261111000000_admin_realtime_revisions/migration.sql
  - packages/pixishelf/services/background-task/admin-realtime-source.ts
  - packages/pixishelf/app/admin/_components/admin-realtime-sync.ts
---

# 管理后台 SSE 刷新验证

适用版本：Git HEAD `88af8a59` 加本次工作区修改，日期 2026-11-11。当前规则见[后台实时进度](../../features/background-job-live-progress.md#任务总览与收件箱的事件刷新)。本记录不代表生产已部署。

发布目标：`v0.56.9`。用户确认本地检查无问题，授权提交并推送版本 tag 触发构建；按用户要求不跟踪远端发布过程，本记录不将触发构建等同于镜像发布成功。

## 环境与恢复依据

使用本机 macOS、Node、pnpm 和 Chrome；另建一次性 PostgreSQL 15 容器 `pixishelf-sse-test-20261111`，端口 `127.0.0.1:15432`。数据库 `ssetest` 用于隔离测试，`ssebrowser` 用于浏览器，均重放全部 142 个正式 migration。浏览器连接独立 Web 服务 `127.0.0.1:5435`，使用 `entry=direct`，只使用合成账户与数据，没有启动消费任务的 Worker。

上述隔离验证阶段只在空隔离库部署 migration，没有写入已有本地业务库、生产数据库或媒体根。隔离环境的恢复单位是空库及正式 migration，可重建；不需要保留合成业务数据作为业务恢复点。未登记生产备份集合或镜像 digest，不能以本地测试代替发布检查点。后续按用户要求执行的本地开发环境升级见下节。

验收结束后已停止专用 Web 服务和一次性 PostgreSQL 容器，保留原有业务服务。

发布前按[备份与恢复基线](../../operations/backup-and-recovery.md)建立可恢复检查点并记录旧／目标版本。先运行 generate／deploy，部署 `20261111000000_admin_realtime_revisions`，再升级 App，不使用 db:push。旧 Worker 写入由触发器覆盖，不新增调度任务。回退 App 时保留新增表、索引和触发器。

## 本地开发环境升级

2026-11-11 按用户要求构建并启动本地 Docker Worker、迁移本地开发数据库；App 留待用户通过 F5 启动。操作前没有 F5／Next.js 开发进程，5430 端口空闲；没有待执行或运行中任务。停止旧 Worker 后核实业务库其他连接数为零。

建立仓库外受限检查点 `pixishelf-local-upgrade-20261111`：custom-format 数据库 dump、三个媒体目录副本、实际 Compose／环境配置及镜像清单。dump SHA-256 为 `5dcc85b91265eb16518a543fe2a946e2c7986b0597a7a9c85048196da6bb55f6`。在无网络、无业务挂载的临时 PostgreSQL 15 空库恢复成功；作品、图片、任务、收件项和 140 条迁移计数匹配，1056 个媒体文件副本逐一校验哈希一致。临时恢复容器已删除。检查点位于本机临时目录，未异地复制，不作为长期灾难恢复备份；受限 manifest 保存实际位置，不将环境文件或媒体路径提交仓库。

使用 `db:generate`、`db:deploy` 应用两条待迁移：`20261106010000_video_optimization_mp4_candidates` 与 `20261111000000_admin_realtime_revisions`。`db:status` 确认 142 条迁移全部完成、无失败记录；新表两行资源、15 个触发器及三个索引均存在，迁移前后业务数据计数一致。未使用 db:push。

通过 `docker compose --env-file build/.env -f build/docker-compose.dev.yml build worker` 构建当前工作区，再以 `up -d --no-deps worker` 启动。旧镜像 `sha256:19973620bde85ec3cbc5967d09d15f008135270423d7cbe987182ecb176a83d6` 保留为 `build-worker:before-sse-20261111`；新镜像为 `sha256:b1a663c6a8ee1518e62c616844ccd6eec731885101e463d70dd705e984ee90cb`。READY、Docker healthcheck、capability audit 均通过，审计确认一个 READY Worker、41 种任务／57 个版本。PostgreSQL、ImgProxy 保持运行，5430 端口仍空闲。构建日志为本机临时文件 `pixishelf-worker-local-build-20261111.log`；此处只记录本地开发环境结果，不代表生产部署。

## 自动验证

- Prisma schema validate、客户端 generate 和隔离库 migration deploy 通过。
- 新增 migration 的 4 个 PostgreSQL 测试通过：语句级批量 100 项、增删改及状态流转、空写入、事务回滚对另一连接不可见、队列控制、关联目录和总览相关变化。
- App 隔离集成 4 项通过：真实服务提交 100 个合法链接、版本变化、暂停／恢复、自然到期、回滚、删除，以及原有归档逻辑任务回归。Executor 解析与收件保留期清理的 26 项 PostgreSQL 测试通过。
- 刷新协调器、Provider、SSE 路由、时间边界的定向测试通过；覆盖 250ms 合并、在途补查、无轮询、晚到快照、inactive 缓存失效、无 ID 通知、游标/reset、认证及连接释放。归档页面回归通过。
- 主应用 lint、typecheck、提升权限 production build 通过。最终以 `TZ=UTC pnpm run test:unit --maxWorkers=2` 执行与 `pnpm test` 相同的完整套件：516 个文件通过、55 个环境门禁文件跳过，3823 项通过、396 项跳过。
- 受影响依赖链 typecheck、build 通过。契约 186 项、DB 普通测试 184 项、runtime 35 项、Worker 121 项通过；环境门禁分别跳过 DB 290、runtime 106、Worker 12 项。Executor 全量为 1180 通过、565 跳过，reader 父进程 SIGKILL 退出证明用例失败；单独复跑 reader 文件 16 项全部通过。未把分次通过记录成一次全绿。

全量测试最初受到沙箱本地端口／tsx IPC 权限限制，后续使用提升权限执行；日期解析夹具按 UTC 运行。一次主应用全量复核为 3822 通过、396 跳过、1 个来源选择组件用例 5 秒超时；降低并发后的完整复核全部通过，未修改该用例或放宽超时。

`pnpm docs:check`（397 个 Markdown）、`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check`（34 个图源、23 个内嵌 Mermaid）、主应用路径大小写检查与 `git diff --check` 通过。本次没有修改图源。

提交前暂存区检查补充：新增 migration 文件末尾存在一个空白行。因该文件已应用到本地开发库，保留原字节与 migration checksum；使用 `git -c core.whitespace=-blank-at-eof diff --cached --check` 检查其余空白规则通过。此项不改变 SQL 行为。

## 旧 PostgreSQL 测试修复

首次验证时，`archive-intake-service.postgres.test.ts` 的 14 项及 `intake-batch.postgres.test.ts` 的 19 项未通过。夹具包含非数字 gallery ID、带连字符 token，以及拼接超过 JavaScript 安全整数范围的批量 ID，被现有 URL 校验拒绝。暂时禁用新增的 15 个触发器后，两个代表用例仍以相同原因失败。用户随后要求一并修复旧测试。

2026-11-11 追加验证：另建一次性 PostgreSQL 15 容器 `pixishelf-intake-fixtures-20261111`，在新空库 `fixtureclean` 重放 142 项正式 migration。修正 URL 后继续处理被入口校验挡住的旧夹具假设：为 READY／Import 补齐真实持久来源证明，Worker 使用当前契约版本，容量拒绝审计项按现有规则验证为不可直接重试；每轮真实 Worker 完成后清理该临时媒体根的持久写入声明，防止下一轮出现 `ROOT_CHANGED`。未放宽 URL、来源证明或根身份校验。

批量提交还暴露了逐项身份加锁导致的数据库往返超限。`lockDispositionItems` 改为单次有序批量查询，保留原 JS 去重排序、namespace、hashtext 和事务锁生命周期；顺序依据见 [PostgreSQL 15 SELECT 求值规则](https://www.postgresql.org/docs/15/sql-select.html#SQL-SELECT-LIST)。原 `≤150` 次执行门槛不变，100 项提交从 240 次降为 141 次。空闲及 transfer／checkpoint／publication 三阶段各三轮均为 141 次，测得 229–299ms。

两个完整文件 **35 项全部通过、无跳过**，覆盖原先失败的 33 项；相关 service 单元测试 28 项通过。5 秒以上锁等待、30 秒超时整批回滚、容量竞争、幂等重放及九轮真实 Worker 并发断言均保留并通过。Sol / xhigh 追加审查未发现阻断问题。来源证明记录保留在一次性测试库中，已随测试容器统一清理；未接触业务库或真实媒体。

追加改动的主应用 lint、typecheck、提升权限 build、文档与图示检查通过。修复后再次运行完整主应用套件：516 个文件通过、55 个环境门禁文件跳过，3823 项通过、396 项跳过，无失败；上述 35 项 PostgreSQL 测试已在隔离数据库中另行执行，全部通过。

## 其他验证限制

其他环境门禁跳过项没有全部配置真实外部服务，不记为通过。此次验证没有访问源站、处理真实用户媒体或进行生产上线验收。

## 独立审查

按用户指定，由 **GPT-6.1 Sol / xhigh** 子 agent 审查。确认并修复两个问题：部分 SSE 缓存更新会清除 inactive 查询的失效标记，以及归档单项操作成功后遗漏总览刷新。修复后新增回归测试，审查者再次确认；未留下其他已确认的正确性问题。

## 浏览器验收

由 **GPT-6.1 Terra** 子 agent 使用真实 Chrome 和隔离 Web／PostgreSQL 验证。

- 任务页与收件队列页分别稳定观察 65 秒，记录均为零 API 请求。
- 阻断 SSE 后只显示一处“实时更新不可用，当前状态可能已过期”；目标三个查询无轮询，保留已有数据。恢复后提示消失，三个查询合并到一个 HTTP batch，各同步一次。断线期间库自身每秒重连；范围外任务状态查询仍按原策略查询。
- 隔离库插入、删除收件项，页面各收到一次 summary／list batch，项目出现和消失。
- 双标签页 UI 暂停、恢复解析后，另一页对应按钮变化，每次各收到一次 summary／list batch。
- 预设 20 秒后到期的 READY 项目，随后没有写操作；到期后一次 summary／list batch，待确认数量 1 → 0，项目显示“快照过期”。
- 一标签页点击失败提醒的“忽略提醒”，另一标签页的“1 项失败”消失，并收到一次 dashboard 请求。
- Worker READY → STOPPING 后一次 dashboard 请求。另对普通心跳、过期和恢复分别观察 20 秒并捕获 `workers.snapshot`：普通心跳无 dashboard HTTP；将心跳设为 100 秒前后一次 dashboard 请求，恢复当前心跳后再一次请求。验证了既有 90 秒阈值，未以真实 Worker 进程停止代替合成心跳。
- 独立更新合成 `ANIMATION_DURATION_PROBE` 的进度并写入 `job.progress`，页面由 63% 直接变为 82%，随后观察 8 秒无任何 tRPC 请求。未运行真实媒体探测。

## 证据位置

无凭据的浏览器请求结果保存在[验收附件](./evidence/admin-realtime-sse-2026-11-11.json)。本机临时日志位于 `/tmp/pixishelf-sse-*.log`，浏览器脚本、网络记录及截图位于 `/tmp/pixishelf-sse-browser/`。临时位置不是仓库持久附件；不提交认证 storageState、环境文件或数据库凭据。以下日志名可用于本次环境复查：

- `pixishelf-sse-integration-final.log`、`pixishelf-sse-executors-postgres.log`：隔离 PostgreSQL 服务与 Worker 路径。
- `pixishelf-sse-db-revisions-final.log`：正式 migration 的语句触发器与回滚测试。
- `pixishelf-sse-regression-fixes.log`、`pixishelf-sse-review-fix.log`：审查修复后的定向测试。
- `pixishelf-sse-app-test-final.log`、`pixishelf-sse-app-test-confirm.log`：主应用全量及复核。
- `pixishelf-sse-worker-test-final.log`、`pixishelf-sse-reader-confirm.log`、`pixishelf-sse-worker-only.log`：依赖链与退出用例复核。
- `pixishelf-sse-lint-final.log`、`pixishelf-sse-typecheck-final.log`、`pixishelf-sse-app-build-final.log`：应用静态检查和构建。
- `pixishelf-intake-fixtures-postgres-final.log`、`pixishelf-intake-fixtures-unit.log`：旧夹具修复后的 35 项 PostgreSQL 和 28 项单元回归；`pixishelf-intake-fixtures-clean-migrate.log` 为新空库迁移输出。
- `pixishelf-intake-fixtures-lint.log`、`pixishelf-intake-fixtures-typecheck-final.log`、`pixishelf-intake-fixtures-build.log`、`pixishelf-intake-fixtures-app-test.log`：追加修复后的主应用检查。
- 浏览器 `tasks-requests.json`、`inbox-requests.json`、`disconnect.json`、`mutation.json`、`pause-result.json`、`expiry-result.json`、`failure-result.json`、`worker-long-result.json`、`progress-result.json`：请求及状态观测。
