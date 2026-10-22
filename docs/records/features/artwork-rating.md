---
status: historical
scope: 评分与喜欢合并的本地实施、隔离迁移验证及发布限制
date: 2026-10-22
baseline: 87a6dbde
sources:
  - docs/features/artwork-rating.md
  - packages/pixishelf-db/prisma/migrations/20261022140000_artwork_rating_levels/migration.sql
  - packages/pixishelf/tests/integration/artwork-rating.postgres.test.ts
  - packages/pixishelf/tests/integration/artwork-favorites.postgres.test.ts
---

# 作品评分与喜欢合并验证记录

本记录对应 `87a6dbde` 后的本地工作区，日期为 2026-10-22；当前业务规则见[作品评分与喜欢](../../features/artwork-rating.md)。本记录不声明生产部署完成。

## 环境与恢复单位

实施环境为 Windows 本地工作区、Node.js 22.18.0、Vitest 4.0.18。启动 Docker Desktop 后新建 `pixishelf-rating-verification-20261022`，使用 `postgres:15`，绑定 `127.0.0.1:55434`，测试数据库为 `favorites_verification`；容器带任务标签 `codex.task=artwork-rating-20261022`。凭证仅为本次合成测试用途，不在记录中保留连接串。

验证没有读取、迁移或重建业务数据库。Docker Desktop 恢复后可见既有 Worker、数据库和 ImgProxy 容器，未对它们执行 Compose、迁移、重配置或清理；隔离验证不连接这些服务。没有启动连接测试数据库的 Worker 或 scheduler。

最终迁移从空库正式 deploy 全部 98 个 migration。评分 PostgreSQL 套件还逐次创建独立 `rating_fixture_<随机标识>` 数据库，先 deploy 前 97 个真实历史 migration，插入有固定 ID、账户、时间戳的旧喜欢及故意偏移的派生计数，再 deploy 第 98 个评分 migration。每次测试结束按精确名称清理该临时数据库和临时 migration 目录；未使用 `db:push`。

浏览器准备了两个合成作品（单图、单视频）与不存在的本地媒体路径，标识为 `rating-ui-fixture`；仅写入隔离库的媒体元数据，不读取或写入真实收藏媒体。测试容器与合成数据是可丢弃恢复单位，保留供本轮浏览器验证；清理前须核对容器名与任务标签，不对既有容器或卷执行清理。

迁移保留原 `ArtworkLike` 行，新增有默认值与合法范围约束的评分档位，同时将计数触发器改为喜欢阈值语义。生产升级仍需独立的一致性检查点；本地测试不替代生产备份与恢复演练。

## 检查结果

| 检查                                             | 结果与边界                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| 隔离空库 `pnpm --filter @pixishelf/db db:deploy` | 最终 98 个 migration 全部通过                                                    |
| `artwork-rating.postgres.test.ts`                | 6 / 6 通过；真实旧库升级、25 档位转换、幂等、约束、归属和级联、生命周期          |
| `artwork-favorites.postgres.test.ts`             | 6 / 6 通过；一般档排除、2–4 档包含、账户与组合筛选、普通／随机分页、降档后的续页 |
| 后端聚焦单元／路由／feed                         | 56 / 56 通过；评分服务、会话与账户边界、feed 补全与筛选                          |
| 数据库 migration 静态回归                        | 2 / 2 通过；不能代替上面的真实 PostgreSQL 验证                                   |
| 前端评分面板与控制入口                           | 9 / 9 通过；精简评分面板 6 项、详情控制入口 3 项                                |
| 既有媒体详情回归                                 | 图片组件 29 项、媒体区 10 项、图片虚拟化 1 项通过；含续读锚点恢复回归             |
| 共享队列、缓存与 Hook                            | 15 / 15 通过；含保存中重挂载的迟到读取，以及取消在途普通列表后恢复请求            |
| 主应用 `pnpm lint`                               | 1236 个文件，0 错误、0 警告                                                     |
| 主应用 `pnpm typecheck`                          | `next typegen && tsc --noEmit` 通过                                              |
| 主应用全量单元／组件                             | `pnpm run test:unit --maxWorkers=4`：414 文件、2923 项通过；30 文件、221 项跳过     |
| 主应用 `pnpm build`                              | 提升权限完成生产构建，编译、TypeScript 和 38 个静态页面生成通过；数据库指向隔离库 |
| DB 包 `pnpm --filter @pixishelf/db typecheck`      | 通过                                                                            |
| `pnpm docs:check`                                | 171 个 Markdown 的本地链接、锚点、路径大小写与代码围栏通过                       |
| `pnpm docs:diagrams:check`                       | 28 个独立图源与 23 处内嵌 Mermaid 检查通过；本次未修改图源                       |
| 路径与 diff                                      | 主应用大写路径扫描无匹配，`git diff --check` 通过                                |

PostgreSQL 两套件的最终共同命令为 `pnpm --filter @pixishelf/next exec vitest run tests/integration/artwork-favorites.postgres.test.ts tests/integration/artwork-rating.postgres.test.ts`，显式设置各自的 `FAVORITES_DATABASE_URL`、`RATING_DATABASE_URL`，不回退到应用环境文件。最终共 12 项通过；评分套件覆盖历史喜欢的 ID／账户／时间戳不变、默认档位 2、错误计数校准、无记录保持未评分、全部 25 种转换与同值提交，另核验 0／5／负数、重复账户、归属移动、父作品 ID 级联不重复计数、账户删除、媒体元数据修改、回收拒写、恢复和永久删除。

全量检查首次发现新页面控制器缺少布局测试上下文，已在布局测试中隔离与布局无关的控制器并修复；随后同时进行浏览器开发编译的一轮出现 14 文件、26 项超时及连带失败。停开发服务并限制为 4 个测试 worker 后完整套件通过，没有放宽断言或修改测试超时。`test:unit` 与 `pnpm test` 使用同一套件；跳过项为未设置各自专用数据库环境的既有 PostgreSQL 套件，评分和喜欢的数据库测试另行显式运行。主应用 integration、jsdom e2e 和完整 Worker 测试不在本轮全量单元命令中。

文档检查首次在沙箱中因 `spawnSync git EPERM` 无法启动，提升权限后通过；Docker API 及 Prisma／Vitest 子进程也使用提升权限，但数据库 URL 始终指向明确新建的隔离实例。

浏览器在 `localhost:5435` 使用隔离库和合成账户，详情入口带 `entry=direct`，参数被应用消费后清理。验证了 1280×900 桌面、375×812 窄屏和 812×375 横屏；面板高度约 140.5px，桌面／横屏宽 360px、窄屏宽 343px，底距均为 24px。已实际操作单图／单视频的评分入口、方向键和 End、拖动松手保存、空白关闭、Escape 和主按钮焦点恢复。沉浸浏览中，一般点击爱心变为喜欢；喜欢筛选取消后移到相邻作品，夯爆了点击亮心清为空后集合显示空状态。刷新详情能读取保存后的值。

按最新界面要求，浮层只显示档位、滑杆与刻度；移除可见标题、提示、常驻保存文案和关闭图标，保存完成在滑块内短暂勾选。无障碍标题和状态仍保留，失败才显示重试。浏览器验证使用合成缺失媒体，证明入口与评分交互，不声明真实视频播放、媒体预览及自动浏览的端到端验收；这些协作目前由组件回归覆盖。未进行实际深色主题切换、非零安全区域或真机触摸验证，深色变量和减少动态效果已在实现／组件检查中覆盖。

## 发布与回退限制

前后端与 migration 一起发布。写入一般档后不能仅回退到旧应用，因为旧逻辑把所有 `ArtworkLike` 行都当成喜欢。保留评分表、档位与时间戳，采用理解阈值的兼容版本或前向修复；不兼容程序恢复必须匹配完整检查点并遵循[备份与恢复](../../operations/backup-and-recovery.md)。

尚未进行生产部署、生产副本恢复演练或真实移动设备验证；不能由本地结果推断这些范围通过。
