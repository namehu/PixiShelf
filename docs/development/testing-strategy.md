---
status: current
scope: PixiShelf 的测试分层、变更验证矩阵、CI 实际覆盖和已知质量缺口
last-verified: 2026-08-18
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
3. 中央队列、租约、重试、取消和终态转换保持正确；
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

### 浏览器扩展

```bash
pnpm --filter @pixishelf/extension compile
pnpm --filter @pixishelf/extension build
```

扩展当前没有自动化测试脚本，compile/build 不能替代实际 Pixiv 页面上的人工回归。

### Compose 与 Worker 运行门禁

```bash
docker compose --env-file build/.env.example -f build/docker-compose.dev.yml config --services
docker compose --env-file build/.env.example -f build/docker-compose.deploy.yml config --services
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/healthcheck.cjs --mode=ready
docker compose --env-file build/.env -f build/docker-compose.dev.yml exec -T worker node dist/capability-audit.cjs
```

健康检查证明进程和预检状态，capability audit 证明生产所需 Executor 已注册；二者都不能代替领域功能测试。

## 变更验证矩阵

| 变更类型                  | 最小验证                                                            | 需要追加的验证                                                    |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 纯文档                    | 链接、代码围栏、Prettier、`git diff --check`                        | 命令和路径涉及部署时解析 Compose/脚本                             |
| 局部 UI/组件              | 主应用 lint、typecheck、聚焦组件测试                                | 涉及共享 shell、播放器或导航时运行相关组件组和视口人工检查        |
| Service、tRPC、HTTP Route | lint、typecheck、聚焦服务/route 测试                                | 修改鉴权、幂等或事务时加入失败路径和 PostgreSQL 测试              |
| Prisma Schema/migration   | db validate/generate、DB 测试、从空库 `db:deploy`、migration status | 生产数据副本演练、回滚/前向修复方案和 Worker 依赖链测试           |
| Job contract/payload      | Worker 依赖链 typecheck/test/build                                  | 版本兼容、旧 payload fixture、无效 payload 和重试测试             |
| Queue/runtime/lease       | Worker 依赖链测试                                                   | PostgreSQL 并发、进程重启、过期租约、终态竞争和取消测试           |
| Executor/文件操作         | 聚焦 Executor 测试、Worker 依赖链                                   | 临时目录 fixture、失败注入、hash/checkpoint、恢复和不越界路径测试 |
| 扫描/导入/迁移            | 主应用或 Executor 单测                                              | `test:integration`、真实 fixture、审计记录和重复执行测试          |
| 媒体播放/派生媒体         | 组件/服务测试                                                       | 图片、视频、封面缺失、动画、FFmpeg 失败和实际浏览器抽样           |
| Compose/Dockerfile/env    | Compose config、相关 package build                                  | 镜像构建、非 root 权限、挂载、migration、READY/capability 冒烟    |
| 浏览器扩展                | compile + build                                                     | Chrome/Firefox 目标页面人工验证和权限检查                         |
| scanner/zip-convert       | 启动或工具级聚焦验证                                                | 当前缺少可靠自动化测试，必须记录 fixture 和人工结果               |

“最小验证”是进入评审前的底线。跨多个类型的变更需要合并各行要求，而不是只选择最轻的一行。

## 数据库与文件测试原则

- 使用隔离数据库或 CI PostgreSQL，不在生产数据库运行测试；
- PostgreSQL 测试必须自行创建和清理唯一 fixture，不能依赖运行顺序；
- 文件测试使用临时目录，不使用真实收藏目录；
- 破坏性路径同时断言目标路径、边界校验、失败恢复和审计状态；
- migration 测试至少覆盖从空数据库部署完整链，不只验证最新 Schema；
- 涉及数据库和文件的领域发布，需要测试“数据库成功/文件失败”和“文件成功/数据库失败”的恢复语义；
- 时间、重试和租约测试使用可控 clock，避免依赖真实 sleep。

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

CI 当前没有明确执行：

- 主应用 `test:integration`；
- `.e2e.test.*`；
- 主应用生产 build；
- 浏览器扩展 compile/build；
- 独立 scanner 和 zip-convert 验证；
- Docker Compose/镜像运行冒烟；
- 真实浏览器登录、反向代理和媒体播放。

这些是已知缺口，不应在发布说明中声称已由 CI 覆盖。后续提高 CI 门禁时，应评估主应用集成测试和生产 build，再逐步补扩展构建与真实浏览器 E2E。

## 完成标准

变更完成时应记录：

- 实际运行的命令及结果；
- 未运行的相关检查及原因；
- 新增或修改了哪些不变量测试；
- 是否需要数据库、文件系统、Docker 或人工浏览器环境；
- 已知缺口是否会影响发布决策。

测试失败不能通过删除断言、扩大 mock 或跳过高风险路径来“修复”。如果失败是既有问题，需要提供可复现证据，并证明本次变更没有扩大影响。

涉及 migration、媒体写入、部署和破坏性工作流的恢复证据以[备份与恢复基线](../operations/backup-and-recovery.md)为准。
