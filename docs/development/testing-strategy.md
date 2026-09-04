---
status: current
scope: PixiShelf 的测试分层、变更验证矩阵、CI 实际覆盖和已知质量缺口
last-verified: 2026-09-03
sources:
  - package.json
  - packages/*/package.json
  - packages/pixishelf/vitest.config.ts
  - packages/*/vitest.config.ts
  - .github/workflows/ci.yml
---

# PixiShelf 测试策略

本文回答“某类改动必须运行什么、现有测试证明了什么、CI 没有证明什么”。测试文件和精确脚本以代码及 `package.json` 为准。

## 目标

测试体系优先保护：

1. 数据库 migration 可以从空 PostgreSQL 按完整历史部署；
2. 作品、来源、媒体顺序和用户整理语义不被破坏；
3. 中央队列、双 lane 租约、重试、取消和终态转换保持正确；
4. 扫描、归档、替换和迁移不会静默损坏文件；
5. 核心浏览与管理交互在重构后仍可使用；
6. 构建产物和 Docker 运行边界与源码依赖一致。

测试不是覆盖率数字竞赛。高风险路径需要针对不变量、失败注入、迁移和恢复编写断言；简单展示代码可以使用较轻的组件测试。

## 当前测试层级

| 层级               | 主要位置                                                    | 运行环境                    | 负责证明                                    |
| ------------------ | ----------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| 静态检查           | 各 package 的 lint/typecheck                                | Node.js                     | 语法、类型和部分代码规范                    |
| 单元测试           | `__tests__/` 与现有 `*.test.*`                              | Vitest；主应用默认 jsdom    | 纯函数、服务规则、组件状态、输入校验        |
| Workspace 边界测试 | job/db/worker package                                       | Vitest                      | 禁止反向依赖、构建边界和契约兼容            |
| PostgreSQL 测试    | DB、job-runtime、job-executors、主应用 background-task      | Vitest + `DATABASE_URL`     | migration、队列原子性、租约、并发与真实约束 |
| 主应用集成测试     | `packages/pixishelf/tests/integration` 和 scan fixture 测试 | Vitest + PostgreSQL/fixture | 跨服务扫描、计数和持久化行为                |
| UI/组件测试        | `app/`、`components/`、`tests/components`                   | Testing Library + jsdom     | 页面状态、交互语义和回归                    |
| E2E 命名测试       | `tests/e2e/*.e2e.test.tsx`                                  | 当前仍是 Vitest/jsdom       | 较长的组件流程，不等同于真实浏览器 E2E      |
| 构建验证           | Next.js、Worker、Extension build                            | 编译器/打包器               | 生产依赖、模块边界和产物可构建              |
| 部署验证           | Compose config、Worker health/capability、migration status  | Docker/PostgreSQL           | 实际运行拓扑与启动门禁                      |

当前没有 Playwright/Cypress 配置，也没有由 CI 驱动的真实浏览器端到端测试。不能把 `.e2e.test.tsx` 的存在解释为已经覆盖浏览器、反向代理、登录 Cookie 和真实媒体播放链路。

## 标准命令

### 主应用

```bash
pnpm --filter @pixishelf/next lint
pnpm --filter @pixishelf/next typecheck
pnpm --filter @pixishelf/next test:unit
pnpm --filter @pixishelf/next test:integration
pnpm --filter @pixishelf/next build
```

`test:unit` 明确排除：

- `tests/integration/**`；
- `**/*.e2e.test.*`；
- scan fixture 集成测试。

运行单个主应用测试时，优先直接调用 Vitest，避免误跑全部测试：

```bash
pnpm --filter @pixishelf/next exec vitest run <test-path>
```

### 数据库与 Worker 依赖链

```bash
pnpm --filter @pixishelf/db db:validate
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db test
pnpm --filter @pixishelf/worker... typecheck
pnpm --filter @pixishelf/worker... test
pnpm --filter @pixishelf/worker... build
```

`@pixishelf/worker...` 包含 Worker 及其 workspace 依赖，覆盖 DB、job-contracts、job-runtime 和 job-executors 的相应脚本。
CI 在任何 job 包 `dist` 生成前完成 Web lint、typecheck、unit test 和 production build，证明主应用只消费
workspace 源码；随后独立构建 job-contracts、job-runtime、job-executors 的 `dist`，再打包 Worker，验证
独立编译输出、类型声明和依赖顺序没有漂移。

### Compose 与 Worker 运行门禁

```bash
docker compose --env-file build/.env.example -f build/docker-compose.dev.yml config --services
docker compose --env-file build/.env.example -f build/docker-compose.deploy.yml config --services
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
```

健康检查证明进程和两个 lane 的预检状态，capability audit 精确证明 28 个 job type、31 个 type/version 组合
（`SCAN` v1/v2/v3、`ARCHIVE_IMPORT` v1/v2、其余 v1）的 type/version/lane 已注册；二者都不能代替领域功能测试。

## 变更验证矩阵

| 变更类型                  | 最小验证                                                                           | 需要追加的验证                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 纯文档                    | 链接、代码围栏、Prettier、`git diff --check`                                       | 命令和路径涉及部署时解析 Compose/脚本                                                                        |
| 局部 UI/组件              | 主应用 lint、typecheck、聚焦组件测试                                               | 涉及共享 shell、播放器或导航时运行相关组件组和视口人工检查                                                   |
| Service、tRPC、HTTP Route | lint、typecheck、聚焦服务/route 测试                                               | 修改鉴权、幂等或事务时加入失败路径和 PostgreSQL 测试                                                         |
| 认证与接口边界            | lint、typecheck、无凭证/错误凭证/有效凭证聚焦测试                                  | 公共路径、Token、信任头、越界资源、限流和未授权零写入测试                                                    |
| Prisma Schema/migration   | db validate/generate、DB 测试、从空库 `db:deploy`、migration status                | 生产数据副本演练、回滚/前向修复方案和 Worker 依赖链测试                                                      |
| Job contract/payload      | Worker 依赖链 typecheck/test/build                                                 | 版本兼容、旧 payload fixture、无效 payload 和重试测试                                                        |
| Queue/runtime/lease       | Worker 依赖链测试                                                                  | PostgreSQL 同 lane 竞争、resolver+writer 并行、重启、过期租约、终态竞争和取消测试                            |
| Executor/文件操作         | 聚焦 Executor 测试、Worker 依赖链                                                  | 临时目录 fixture、失败注入、hash/checkpoint、恢复和不越界路径测试                                            |
| 扫描/导入/迁移            | 主应用或 Executor 单测                                                             | `test:integration`、真实 fixture、审计记录和重复执行测试                                                     |
| Pixiv metadata inventory  | 指纹分类、DTO/UI nullable 单测                                                     | PostgreSQL + 临时目录：基线中断、跨 Run 重试、root/source CAS、10k unchanged 零 hash                         |
| Pixiv 来源一致性核对      | v1/v2 payload 隔离、分类/checkpoint、producer/DTO/UI/鉴权回归                      | PostgreSQL + 临时目录：共享 SCAN 锁、空根/截断/取消/root 变化不生成 MISSING、重放幂等、只读领域边界          |
| Pixiv 核对选定同步        | v2/v3 隔离、证据 canonicalization、选择/UI/DTO/鉴权/幂等回归                       | PostgreSQL + 临时目录：stale/身份 CAS 零写入、部分成功、崩溃重放、取消终态、publisher 拥有权和成组保留       |
| Pixiv 标签补全            | payload、只填空字段、全量分页、状态、远端响应和封面安全校验                        | PostgreSQL + 临时目录：5000+ 子任务、claim/整批取消竞态、限流重试、重启恢复、鉴权图片路由                    |
| Pixiv 艺术家补全          | 身份迁移、payload、全量分页、默认只填空与显式刷新图片、来源姓名和远端响应安全校验  | PostgreSQL + 临时目录：5000+ 子任务、claim/整批取消竞态、取消/重试、并发人工修改、身份变化与作者图片鉴权读取 |
| Pixiv 作品在线同步        | migration、payload、全量分页、远端响应、磁盘快照、来源字段、文本保护和精确标签同步 | PostgreSQL + 临时目录：5000+ 子任务、claim/整批取消竞态、身份/人工编辑 CAS、文件成功而数据库失败后的恢复     |
| 媒体播放/派生媒体         | 组件/服务测试                                                                      | 图片、视频、封面缺失、动画、FFmpeg 失败和实际浏览器抽样                                                      |
| Compose/Dockerfile/env    | Compose config、相关 package build                                                 | 镜像构建、非 root 权限、挂载、migration、READY/capability 冒烟                                               |
| zip-convert               | 启动或工具级聚焦验证                                                               | 当前缺少可靠自动化测试，必须记录 fixture 和人工结果                                                          |

“最小验证”是进入评审前的底线。跨多个类型的变更需要合并各行要求，而不是只选择最轻的一行。

Pixiv 作品在线同步的发布证据必须分别记录 migration 链、Client/文件安全、领域写回、201/5001 全量发现、
批量取消、App 状态筛选和任务恢复，以及 Worker/Next production build；聚焦单测不能替代隔离 PostgreSQL、
生产数据副本、真实浏览器或 Compose READY/capability 冒烟。

## 数据库与文件测试原则

- 使用隔离数据库或 CI PostgreSQL，不在生产数据库运行测试；
- PostgreSQL 测试必须自行创建和清理唯一 fixture，不能依赖运行顺序；
- 文件测试使用临时目录，不使用真实收藏目录；
- 破坏性路径同时断言目标路径、边界校验、失败恢复和审计状态；
- migration 测试至少覆盖从空数据库部署完整链，不只验证最新 Schema；
- 涉及数据库和文件的领域发布，需要测试“数据库成功/文件失败”和“文件成功/数据库失败”的恢复语义；
- 时间、重试和租约测试使用可控 clock，避免依赖真实 sleep。

归档收件与执行 lane 变更还必须覆盖：

- 空 PostgreSQL 完整 migration 链，以及含旧 `SystemJob`、等待任务和旧全局 lease 的非空库直切演练；
- migration 在执行态任务或活跃旧全局 lease 存在时无副作用失败；
- 旧任务全部回填到 `BACKGROUND_WRITER`，新 `ARCHIVE_RESOLVE_ITEM` 只能进入 `ARCHIVE_RESOLVE`；
- 两个 Worker 进程竞争时每 lane 最多一个 RUNNING，同时允许一个 resolver 和一个 writer；
- 收件 create/enqueue/bulk 幂等、FIFO、暂停/重试/取消、Worker 崩溃恢复和未授权零写入；
- `RECONCILE` 只物化子任务，回收/恢复/永久清理在 writer lane 中根目录受限、可重入并最终 fenced；
- 30 天保留任务只删除收件、终态上传者扫描、已完成批量记录和过期预览，不删除上传者来源/游标、领域实体、任务与媒体。
- 归档媒体设置默认值和 1/8 边界，执行态保存冲突，以及 advisory lock 下“先保存/先启动”的两个顺序；恢复与重试读取新值，运行中执行保持冻结值；
- Executor 活动 worker、活动传输流与 Provider permit 不超过同一冻结上限，失败流从有效字节扣除且重试不重复累计；逐文件实时遥测覆盖解析图片页、等待响应、下载和校验写入，不得携带远端 URL 或凭据；实时事件两秒限频不吞普通阶段、警告和终态；
- 通用 SSE 的 Session、脱敏、响应头、心跳、游标追赶/reset、断连清理与数据库异常，以及 admin 单连接、500 条上限、过滤和归档断线轮询回退。

## 测试文件组织

- 新单元和组件测试放在靠近实现的 `__tests__/`；
- 包级或跨模块测试使用该 package 已建立的 `tests/`；
- 不新增与实现文件同级的测试；现有同级测试逐步迁移时同步修正相对 import 和 mock；
- PostgreSQL 测试使用清晰后缀，如 `.postgres.test.ts`；
- 真正浏览器 E2E 建立前，不继续扩大“e2e”命名与实际执行环境的歧义。

## CI 当前事实

`.github/workflows/ci.yml` 当前执行：

1. 安装 Node.js 20 和 pnpm 8.15.1；
2. 启动 PostgreSQL 15；
3. 生成 Prisma Client 并验证 Schema；
4. 对 Worker 依赖链执行 typecheck；
5. 从空数据库部署完整 migration 并检查 status；
6. 对数据库和 Worker 依赖链执行测试；
7. 构建通用 Worker；
8. 运行主应用 lint 和 typecheck；
9. 运行主应用 `test:unit`。

Worker 测试和 capability 门禁包含双 lane contract，以及 28 个 job type、31 个 type/version 组合（`SCAN`
v1/v2/v3、`ARCHIVE_IMPORT` v1/v2、其余 v1）的精确 inventory；CI 的空库 migration 仍不能替代生产数据副本或非空历史 fixture 的直切
演练。v3 的独立领取测试同时证明只声明 SCAN v2 的旧 Worker 不会领取 `AUDIT_APPLY`。

CI 当前没有明确执行：

- 主应用 `test:integration`；
- `.e2e.test.*`；
- 主应用生产 build；
- zip-convert 验证；
- Docker Compose/镜像运行冒烟；
- 真实浏览器登录、反向代理和媒体播放。

这些是已知缺口，不应在发布说明中声称已由 CI 覆盖。后续提高 CI 门禁时，应评估主应用集成测试和 production build，再逐步补真实浏览器 E2E。

## 完成标准

变更完成时应记录：

- 实际运行的命令及结果；
- 未运行的相关检查及原因；
- 新增或修改了哪些不变量测试；
- 是否需要数据库、文件系统、Docker 或人工浏览器环境；
- 已知缺口是否会影响发布决策。

测试失败不能通过删除断言、扩大 mock 或跳过高风险路径来“修复”。如果失败是既有问题，需要提供可复现证据，并证明本次变更没有扩大影响。

涉及 migration、媒体写入、部署和破坏性工作流的恢复证据以[备份与恢复基线](../operations/backup-and-recovery.md)为准。
