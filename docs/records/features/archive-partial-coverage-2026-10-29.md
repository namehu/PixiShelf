---
status: historical
scope: 2026-10-29 部分归档实施的隔离环境、初始化步骤与验证边界
last-verified: 2026-10-29
sources:
  - packages/pixishelf-db/prisma/migrations/20261029110000_archive_partial_coverage/migration.sql
  - packages/pixishelf/app/(public)/login/page.tsx
  - packages/pixishelf/services/init-admin-service.ts
  - packages/pixishelf/actions/init-action.ts
  - packages/pixishelf/lib/auth/better-auth.ts
---

# 部分归档隔离验证记录

适用版本：2026-10-29 `archive-partial` 独立 worktree 的本次修改，尚未登记发布提交或镜像 digest。当前规则见[部分归档与补全](../../features/archive-partial-coverage.md)，正式升级和恢复见[专项手册](../../operations/runbooks/archive-partial-coverage.md)。本记录区分已完成的准备、代码核对和仍待运行的验证。

## 环境与恢复依据

使用独立 worktree `/Users/namehu/.codex/worktrees/archive-partial/PixiShelf`，隔离数据库名为 `pixishelf_partial_dev`，媒体位于该 worktree 的 `packages/pixishelf/.local-data/media`，派生媒体位于同级 `derived-media`。未使用原开发收藏库或其媒体目录；环境配置、账户密码及其他秘密不入库、不附在记录中。

| 服务          | 本地端口 | 本次准备状态               |
| ------------- | -------- | -------------------------- |
| Web           | 5460     | 已启动并经 HTTP 就绪检查   |
| ImgProxy      | 5461     | 已启动                     |
| PostgreSQL    | 5462     | 已启动，独立数据库         |
| Worker health | 5463     | 已启动，就绪与能力检查通过 |

已完成 Prisma Client generate，并从隔离空库 deploy 完整 130 项 migration（含本次覆盖 migration）。这是空库迁移验证，不是现有生产数据库升级或备份恢复演练。环境创建与迁移结果由本轮统筹执行记录确认；运行日志仅保存在 worktree 的 `packages/pixishelf/.local-data/runtime` 中。

该隔离环境没有继承家庭收藏数据；后续运行只允许使用此数据库和 worktree 内媒体。正式实例仍必须建立数据库与全部媒体同点恢复集合，不能用本空库验证替代正式备份或退回旧程序的兼容性判断。

## 空库首次账户初始化

以下步骤按当前代码核对；本记录编写时尚未执行浏览器验收，不声称管理员或会话已创建。

1. 启动指向该隔离库的 Web 后打开 `http://127.0.0.1:5460/login?entry=direct`。`UserBA` 无记录时，`/login` 显示“初始化系统／创建第一个管理员账户”；不需要预置数据库用户。
2. 使用仅用于该环境的用户名、密码及确认密码。表单要求用户名 3–20 字符，后续登录仅接受字母、数字、下划线和连字符；初始化表单虽显示密码至少 6 字符，Better Auth 实际最小长度为 8，因此应选择至少 8 字符的密码。两处最大长度均为 128。
3. 提交会通过 `initializeAdmin` 在表锁事务内再次确认空库，以 `username@pixishelf.local` 创建账户、凭据和 Session，事务提交后设置 Cookie。成功后的页面导航回 `/login`；如显示登录表单，使用刚创建的用户名和密码登录。
4. 账户已存在时，`/login` 显示普通登录表单，初始化入口不会再创建第二个首账户。`INIT_ADMIN_USERNAME`／`INIT_ADMIN_PASSWORD` 不会自动创建账户；不存在可复用的默认管理员密码。
5. 登录后访问 `http://127.0.0.1:5460/artworks?entry=direct` 或后台收件箱，后续浏览器验证继续使用 `entry=direct`。该参数只选择显示模式，不绕过登录。

所有已登录账户在当前单一信任域内具备管理能力；初始化不是新的角色体系，详见[权限边界](../../security/access-control.md)。不把本地临时密码、Cookie 或环境文件正文写入验证记录。

## 已核对与待验证

已按本次代码核对范围默认值、完整解析后截取、修订覆盖事实、显式补全快照、保留媒体身份的发布及专用退休任务；这些是代码核对，不等于端到端执行通过。

已执行的检查：

| 检查                                   | 结果与边界                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 归档下载／发布／恢复真实 PostgreSQL 组 | 46 项通过；增加活动任务旧路径引用和中断后剩余文件证据保护后，6 项部分归档保护／恢复用例复验通过，总套件现 48 项 |
| 执行器定向回归                         | 77 项通过                                                                                                       |
| 补全服务、任务调度、收件与组件         | 合并运行 98 项通过、URL helper 提取遗漏导致 3 项失败；恢复函数后收件组 13 项复验通过（合计覆盖 101 项）         |
| Worker 能力注册                        | 13 项通过                                                                                                       |
| 类型检查                               | 主应用、job-contracts、job-runtime、job-executors、Worker 通过                                                  |
| 主应用 lint                            | 0 警告、0 错误                                                                                                  |
| Worker 构建与运行                      | 构建通过，PID 89518；ready healthcheck 通过；能力审计 1 READY Worker、39 类型／62 版本                          |
| Web 开发服务                           | PID 87153，`/login?entry=direct` HTTP 200，响应包含首次管理员初始化文案                                         |

通过的新增数据库用例覆盖前 20 张数量边界、重复提交范围不扩不缩、来源变化拒绝、本地媒体变更拒绝发布、保留旧 Image ID／阅读／标记／评分、新图未读、未登记文件与活动旧路径任务保护、删除后中断的原任务离线授权恢复，以及旧副本退休后的回收和恢复。没有进行浏览器或真实原站验证；永久清理退休修订的执行路径已适配，但本轮新增数据库用例未单独执行 purge。

主应用全量 test/build 留到 A→B→C 集成后统一执行。本记录不代表独立审查或最终集成验收已完成。没有生产部署、既有收藏库迁移、真实用户媒体清理或生产备份恢复演练。

运行命令（从本 worktree 根目录分别启动，`.env.local` 已隔离配置）：

```bash
cd packages/pixishelf
pnpm prepare:webp
pnpm exec next dev --hostname 127.0.0.1 --port 5460
```

```bash
cd packages/pixishelf-worker
node --env-file=../pixishelf/.env.local dist/main.cjs
node --env-file=../pixishelf/.env.local dist/healthcheck.cjs --mode=ready
node --env-file=../pixishelf/.env.local dist/capability-audit.cjs
```

文档检查：`pnpm docs:check` 通过，检查 328 个 Markdown；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过，检查 34 个图源与 23 个内嵌 Mermaid 块。`git diff --check -- docs` 通过，主应用路径大写扫描无匹配。本次不改 Mermaid 图源、不重生成图，也未运行应用 build。完整验收项目见[功能规格](../../features/archive-partial-coverage.md#验收入口)。

## 独立审查修复

独立审查确认唯一 P2：MANUAL 解析后改变下载范围，创建的 Import 已使用新范围，但 Intake 仍显示旧范围。修复将创建、已入队重放、活动 Import 复用及两条并发恢复路径统一写回实际 Import 范围。新增 6 项数据库回归，并连同原有“不扩大部分／不缩小全量”2 项定向复验，共 8 项通过；执行器类型检查通过。

审查阶段原 48 项真实 PostgreSQL 套件已由独立 reviewer 全部通过。补丁提交后仍需独立复审，不以作者验证替代审查。补丁只重建受影响 Worker 运行包以更新独立环境，未执行主应用全量构建。
