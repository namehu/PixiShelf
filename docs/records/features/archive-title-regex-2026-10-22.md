---
status: historical
scope: 标题条件大小写选项、正则、直接命中证据的本地验证记录
last-verified: 2026-10-22
sources:
  - packages/pixishelf-job-contracts/src/__tests__/archive-title-rules.test.ts
  - packages/pixishelf/app/admin/archive/inbox/_components/__tests__/archive-title-rules.test.tsx
  - packages/pixishelf/services/archive-uploader/__tests__/title-rule-service.postgres.test.ts
---

# 标题规则扩展验证（2026-10-22）

本次增量基于 `538577e8`，在 `codex/archive-title-rules-review` 交付。当前行为见[标题来源规则](../../features/archive-title-rules.md)。本记录不表示生产已部署或已验证。

## 范围与环境

Windows 本地工作区；数据库验证仅连接专用 Docker PostgreSQL 的 `127.0.0.1:55439/title_rules_test`，使用测试生成的独立来源和候选并自动清理。不连接生产，不请求真实远端画廊。没有 Schema 变更或新增迁移；回归只操作合成候选，不执行实际来源重算或绑定清理。

新增逐条默认勾选的 `ignoreCase`、RE2 正则和直接展示的命中标题高亮；规则 JSON v2 兼容 v1，扫描任务 v5 兼容 v1–v4，预览任务 v2 兼容 v1。高亮复用机器判断证据，保留人工决定和隐私遮蔽。

## 实际验证

| 检查                             | 结果                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| contracts：标题规则与查询两文件  | 69 项通过；含大小写、双语、Unicode/HTML 偏移、正则源保留、病态回溯输入、零宽匹配和旧身份         |
| 主应用：规则与过滤列表组件两文件 | 13 项通过；含逐条勾选、语法错误、未展开时标题和高亮、旧证据、手动接纳与排除证据分离              |
| 隔离 PostgreSQL：标题规则服务    | 13 项通过；含 1,105 候选、原子应用、失败恢复、人工决定、v4/v5 扫描和旧 Worker 不能领取新版本任务 |
| 执行器：远端标题扫描 fixture     | 23 项通过；候选上限、零匹配及旧游标                                                              |
| Worker：注册与能力审计两文件     | 15 项通过；35 种任务、43 个版本                                                                  |
| 主应用                           | `pnpm lint`、`pnpm typecheck` 通过                                                               |
| Worker 依赖链                    | `pnpm --filter @pixishelf/worker... typecheck` 与 `build` 通过                                   |
| 浏览器构建兼容                   | esbuild 以 `platform=browser` 成功打包共享匹配器                                                 |
| 文档与路径                       | 文档链接、图示一致性、路径小写及 `git diff --check` 通过                                         |

部分工具首次在沙箱中因子进程 `EPERM` 无法启动；提升权限后完成对应检查，未把失败启动记作通过。

按用户最新要求，没有运行全量主应用测试、主应用生产构建或真实浏览器视觉回归。PC/手机视觉由用户人工验收；组件断言与浏览器模块打包不等同于视觉验收。

## 独立审查

独立子 Agent 使用 `gpt-6.1-sol / xhigh` 审查，并独立执行 69 项 contracts 回归。发现一处 P2：`\Q[\E(?i)rag` 的字面引用可绕过大小写设置，同时部分合法字符类被误拒绝。主 Agent 修正引用、字符类首位 `]` 与 POSIX 类识别并补测试；子 Agent 复验绕过已关闭、合法字面引用正常，最终无遗留已发现问题。子 Agent 未执行数据库、浏览器或全量检查。

新规则产生后应保持兼容的 App/Worker 配套版本。旧镜像不理解规则 v2，不能只换回旧 Worker 并继续使用新规则；优先前向修复。升级与恢复边界以[功能规格](../../features/archive-title-rules.md#接口与升级边界)和[备份基线](../../operations/backup-and-recovery.md)为准。

## 本地 Worker

仅重建并重启 `build/docker-compose.dev.yml` 的 Worker，使用 `up -d --no-deps worker`，没有部署生产或运行数据库迁移。新镜像为 `sha256:bae12ae29cc56475d2ac16193751d0cb61ecdef2bc7996364c29b357f3e83517`；旧镜像保留为 `build-worker:before-title-regex-20261022`。刚启动时健康检查返回 503，启动完成后健康检查与能力审计均成功：1 个 READY Worker、35 种任务／43 个版本。镜像保留不代表生成新规则后可以只降级镜像，恢复边界见上文。
