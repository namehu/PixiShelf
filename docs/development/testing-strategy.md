---
status: current
scope: 测试层级、变更验证矩阵、标准命令和 CI 缺口
last-verified: 2026-10-22
sources:
  - packages/pixishelf/package.json
  - packages/pixishelf/vitest.config.ts
  - packages/pixishelf-webp-player/package.json
  - .github/workflows/ci.yml
  - .github/workflows/webp-native.yml
---

# 测试策略

按变更风险验证不变量，先运行最小相关测试；大范围调整完成或最终交付前再运行相应全量任务。测试数量不是质量保证，跳过、未配置环境和手动重跑必须分别记录。具体脚本和测试位置以包内 `package.json` 与测试文件为准。

## 层级与能证明的范围

| 层级               | 工具/位置                                            | 证明什么；不证明什么                                                   |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| 静态               | lint、`next typegen && tsc --noEmit`、各包 typecheck | 类型和规范；Vitest 与 Next build 不能替代测试文件类型检查              |
| 单元/组件          | 邻近 `__tests__`、已有包级 `tests`；Vitest/jsdom     | 规则、组件状态、输入与错误边界；不证明真实浏览器或生产服务             |
| Workspace 边界     | db/job/worker 测试                                   | 依赖方向、构建边界、版本契约                                           |
| PostgreSQL/fixture | 显式隔离数据库、临时媒体目录                         | migration、约束、事务、lease、并发、文件发布与恢复；不等于生产副本演练 |
| 主应用 integration | `tests/integration`、扫描 fixture                    | 跨服务链路、真实框架错误传输；需按测试配置服务/端口                    |
| `.e2e.test.tsx`    | 当前仍为 Vitest/jsdom                                | 较长组件流程，不是浏览器 E2E                                           |
| WebP browser       | Playwright、真实 Worker/WASM/分块 HTTP               | 播放与解码；CI Chromium、本地 Windows Edge，不覆盖业务登录/反向代理    |
| build/部署冒烟     | Next、Worker、镜像、Compose、READY/capability        | 产物与运行门禁；不替代领域数据/媒体验证                                |

新单元/组件测试放邻近 `__tests__`，已有顶层 `tests` 约定的包沿用；不新增与实现同级测试。数据库测试清楚标注 `.postgres.test.ts` 等后缀。

## 标准命令

主应用聚焦迭代：

```bash
pnpm --filter @pixishelf/next exec vitest run <test-path>
pnpm --filter @pixishelf/next typecheck
```

主应用大范围调整或最终代码交付，在 `packages/pixishelf` 中运行 `pnpm lint`、`pnpm test`、`pnpm build`，同时完成变更所需 typecheck/integration。主应用 build 在受限环境应提升权限，避免 Next.js/Turbopack 挂起。`test` 当前等同 `test:unit`，排除 integration、`.e2e.test.*` 和扫描 fixture；不能把它当成全部验证。

```bash
pnpm --filter @pixishelf/next test:integration
pnpm --filter @pixishelf/next exec vitest run tests/integration/security-next.test.ts
```

安全生产框架测试需本地端口和子进程权限，使用合成会话/业务 I/O，不继承应用环境文件。修改 proxy、HTTP 会话门禁、tRPC INTERNAL_SERVER_ERROR 或 logger 时单独执行；范围限制见[安全回归](../security/access-control.md#错误传输与生产-nextjs-回归)。

数据库/Worker 依赖链：

```bash
pnpm --filter @pixishelf/db db:validate
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/worker... typecheck
node packages/pixishelf-worker/scripts/build-dedup-native.mjs
pnpm --filter @pixishelf/worker... test
pnpm --filter @pixishelf/worker... build
```

`worker...` 包含 DB、contracts、runtime、executors 的相应脚本。涉及原生文件操作的测试需要先生成 Worker 的 `artwork-dedup-native.node`；上方脚本只构建该模块，不生成 job 包 dist，CI Worker 和发布 validate 均执行此准备。PostgreSQL 测试必须显式连接隔离库；migration 从空库用完整 `db:deploy` 验证，不使用 `db:push`。Pixiv 代理 fixture 需要 openssl、临时证书及回环监听，但不访问真实原站、不关闭 TLS 校验。

纯文档与图示：

```bash
pnpm docs:check
pnpm docs:diagrams:check
rg --files packages/pixishelf | rg '[A-Z]'
git diff --check
```

图源修改后运行 `pnpm docs:diagrams` 生成 SVG，再执行 check；不要只改生成图。文档重构无需全量 App build，但文档路径若被测试/脚本读取，须更新并运行对应聚焦回归。

Compose 配置验证使用模板，不输出真实环境内容：

```bash
docker compose --env-file build/.env.example -f build/docker-compose.dev.yml config --services
docker compose --env-file build/.env.example -f build/docker-compose.deploy.yml config --services
```

实际部署运行 READY 与 `node dist/capability-audit.cjs`，比对目标 `production-capabilities.ts` 全量 inventory；健康、能力与领域验收是三个不同门禁。命令见[部署基线](../operations/deployment.md)。

## 变更验证矩阵

| 变更                  | 最小检查                                   | 追加场景                                                                  |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 文档/图               | 链接/锚点/大小写/围栏、图渲染与 diff       | 被引用路径的聚焦测试；部署命令涉及的配置解析                              |
| 局部 UI               | lint/typecheck、相关组件                   | 共享 shell/导航/播放器的组件组、真实视口抽样                              |
| 服务/tRPC/HTTP/Action | 聚焦业务/输入/错误测试                     | 鉴权零写入、幂等、账户/资源归属、事务失败                                 |
| 认证/可信边界         | 无/错/有效凭证、缺配置、跨资源             | 公共前缀、信任头、限流、脱敏、生产框架与真实 HTTPS 登录                   |
| Schema/migration      | validate/generate、空库全链、状态、DB 测试 | 非空旧 schema fixture、生产副本审计、失败无副作用、恢复/前向修复          |
| Job contract/payload  | Worker 链 typecheck/test/build             | 旧 payload、版本/lane 隔离、无效输入、重试；inventory 一致                |
| 队列/lease/runtime    | Worker 链与 PostgreSQL                     | 同 lane 竞争、解析/写入并行、fence 丢失零写入、过期/重启/终态/取消竞争    |
| Executor/文件发布     | 临时目录 fixture、聚焦 Executor            | 根路径/符号链接、hash/checkpoint、数据库成功文件失败及反向故障、恢复      |
| 扫描/导入/来源同步    | 单测 + integration + PostgreSQL/临时媒体   | 身份 CAS、人工所有权、游标/根变化、重复执行、全量分页、部分成功/取消/重放 |
| 阅读/偏好/筛选        | 账户与版本隔离、服务与 UI                  | 切账户、过期请求、媒体变化、并发更新、真实浏览器状态恢复                  |
| 媒体/派生/播放器      | 组件/服务、WebP browser（适用时）          | 首帧/回退/结束/释放、图片/视频/缺封面、FFmpeg 失败、真机与慢存储          |
| Docker/Compose/env    | 配置解析、相关包 build                     | 镜像、非 root、挂载、migration、READY/capability 和实际代理               |

跨类型变更合并要求，不能只选最轻的一行。各领域的验收条件以功能规格为主，不在本页复制全部测试分支。

## 高风险验证原则

- 数据库和媒体仅用隔离 fixture，唯一标识并自行清理，不能依赖套件顺序或真实收藏目录。
- 文件操作验证目标边界、失败恢复和审计；发布事务与文件 I/O 的两种部分失败均须覆盖。
- migration 用旧 schema fixture，不在业务库加回旧列。破坏性退役验证拒绝无副作用、历史/确认保留、普通启动阻断及恢复；至少 7 天生产观察不能用开发测试替代。
- 全量处理验证不截断、重试幂等、人工修改 CAS；只读扫描必须证明不写领域，空根/截断/取消不得误报 MISSING。
- 共享 lane/advisory lock 的非竞争 PostgreSQL 套件串行或分库，专门竞争用例仍运行真实并发；时间/lease 使用可控 clock。
- SSE 验证认证、脱敏、持久游标追赶/reset、断线清理、轮询降级；事件保留先 dry-run，并覆盖分批清理和重连。
- 阅读/隐私真实浏览器使用 `entry=direct` 或 `entry=privacy`，核对登录保留参数、消费后清理、双标签/账户切换、关闭重开和过期；jsdom 不记作浏览器验收。
- WebP 延迟注入须在首帧且 playing 后，以实际播放状态为依据；性能门槛单独运行，不能与其他重负载任务争用资源。历史根因见[CI 270 记录](../records/operations/webp-ci-regression-2026-10-17.md)。

## CI 当前覆盖与缺口

[ci.yml](../../.github/workflows/ci.yml) 用三个独立 runner 并行：Web（独立 PostgreSQL 全链迁移、无 job dist、lint/typecheck/unit/build）、Worker（独立 PostgreSQL 全链、DB/依赖链测试和独立构建）、WebP（预编译校验/负向测试、类型/单元、构建和 Chromium）。汇总 `test` 仅在三路全部 success 时通过，取消/跳过也不放行。

原生相关变更另由 [webp-native.yml](../../.github/workflows/webp-native.yml) 复现原生构建、sanitizer/产物及浏览器校验。发布镜像流程独立验证并构建，不意味着同提交 CI 已通过；交付须核对同提交三路和汇总最终结果。具体发布 artifact、重试与并行边界见[工作流说明](../../.github/README.md)。

Android Flutter 包使用独立工具链，未加入上述 pnpm CI lane；本地 analyze、单元／组件、Android 原生媒体与 APK 构建命令见[包说明](../../packages/pixishelf-app/README.md)。模拟器通过不代替真实 HTTPS、实体手机和生产后端联调。

CI 尚未明确执行主应用 `test:integration`、jsdom e2e 命名套件、Compose/镜像运行冒烟或真实业务登录/代理/媒体链路。WebP 浏览器测试不填补这些缺口，空库 migration 不替代非空升级与生产恢复演练。

完成报告写清实际命令/结果、环境、跳过及原因、未覆盖项对发布的影响；历史数字放带日期的 records。不能通过删断言、扩大 mock 或跳过高风险路径掩盖失败；既有失败也要可复现并说明影响。涉及数据/部署恢复依据见[备份基线](../operations/backup-and-recovery.md)。
