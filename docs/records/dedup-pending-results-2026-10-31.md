---
status: historical
scope: 删除完成后去重待处理结果的剩余成员、分页和刷新验收
last-verified: 2026-10-31
sources:
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf/services/artwork-dedup-delete-adapter.ts
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-review.tsx
---

# 去重待处理结果收口

基线 `8f2046a2`，独立分支 `codex/dedup-hide-processed-results`，独立 worktree；不修改主目录，不操作生产或既有开发数据库/媒体，不改删除算法或安全复核。本记录不代表生产已部署。

实施范围：保留检查结果及删除报告的审计数据，统一服务端当前剩余成员读投影。仅作品记录已不存在或归档已为 TRASHED 时退出待处理成员；回收已排队/移动中、失败及真实内容变化仍保留。少于两个剩余成员的组不返回，仍有关系的长组更新成员数与推荐；已移除的保留方不再从旧审核中推荐。分页、总数、成员预览与选择解析使用同一投影，不能分页后再过滤。界面在处理结果及归档物理完成变化时失效列表/选择缓存，必要时回到第一页；检查横幅的原发现总数明确标为本次检查历史数量，删除历史继续在记录页。

验证限定受影响数据库/服务与 UI 专项、类型与文档检查。复用上一轮显式隔离 PostgreSQL/合成媒体；本轮未再通过产品执行文件删除。新增专项仅对本轮生成的合成记录模拟数据库发布后的删除/TRASHED 状态，媒体文件保留；删除算法与文件安全复核未修改，也未重复完整删除验收。

## 迁移及恢复依据

迁移 `20261031000100_artwork_dedup_pending_results` 增加派生视图 `ArtworkDedupPendingMember`，替换既有 `artwork_dedup_group_choices` 函数的读侧来源与剩余计数，不修改/清理冻结 Result、ResultMember、审核记录或删除报告，不增加业务表。原 eligibility 的版本、指纹、写入占用、归属等条件完整保留；只有已不存在的作品和明确 TRASHED 的归档退出成员。TRASHING、RESTORING、真实变化仍在待处理范围内。旧 keeper 退出时不再采用其值，但保留 reviewVersion，使新保留选择仍能按正常版本校验保存。

App 的组、成员分页、预览、总数、跨页推荐、显式目标与保存成员共用该投影。少于两部的组在 SQL 分页之前不再返回；历史发现数量仍不改写。新 App 依赖新视图，部署时先按既有 `db:deploy` 流程应用 migration，再更新 App；本轮未修改 Worker。

本轮恢复单位是原有隔离容器与可再生成的 fixture；没有生产备份/恢复操作。生产仍按[备份与恢复](../operations/backup-and-recovery.md)保存兼容的数据库/媒体/配置检查点。此次 DDL 不清用户数据；旧函数定义可从基线中的 `20261027000300_artwork_dedup_legacy_review/migration.sql` 取得。若需撤回查询语义，停止 App，使用前向迁移恢复该定义、在没有新 App 依赖后移除新增视图，并恢复匹配代码；只换旧镜像不会自动恢复旧 SQL 语义。不得手改 `_prisma_migrations` 或为界面清理删除审计。

## 专项结果

| 范围                       | 最终结果                 | 说明                                                                                         |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 新 PostgreSQL 剩余结果专项 | 4 项通过                 | 初轮 3 项通过，长组 fixture 修正后仅重跑该 1 项通过                                          |
| Review 组件                | 8 项通过                 | 含第二页选择、打开对照、完成回调后回第一页并清旧选择/keeper；原本无重复与处理完空态区分      |
| Batch progress 组件        | 3 项通过                 | 同一 TRASH_SUBMITTED 项从 RUNNING 到 COMPLETED 再刷新；成功仅在记录页；失败/取消残余仍可追溯 |
| Workspace/状态横幅         | 各 1 项通过              | 记录页存在；原发现数明确写本次检查找到，状态测试只运行相关 1 项，其他 42 项为主动过滤        |
| 原组 DTO 投影              | 2 项通过                 | 人工关系的保留推荐规则不变                                                                   |
| App 类型检查               | 通过，退出 0             | `next typegen && tsc --noEmit`                                                               |
| DB 类型检查                | 通过，退出 0             | `tsc --noEmit`                                                                               |
| 改动 App/测试定向 lint     | 11 文件，0 警告/0 错误   | 不运行全量 lint                                                                              |
| DB 旧文件 lint             | 12 个既有 curly 错误保留 | HEAD 基线同文件也为 12 项；本轮只替换两处视图名称，不扩做历史格式整理                        |
| Impeccable                 | `[]`                     | 4 个变更 UI 组件一次 detector                                                                |

数据库四项覆盖：直接删除与归档真正 TRASHED 后退出，TRASHING 保留；刷新查询不复活已处理成员；同组四部处理两部后，剩余两部仍有关系，旧 saved keeper 不再推荐且可正常另选保存；成员分页/预览/目标一致；24 组跨页过滤、总数与全页推荐正确，显式旧组拒绝；真实 mediaRevision 变化及 writeToken 占用保留 STALE。冻结审计四组/八成员与 run.groupCount 在读侧收口后仍保持原值。进行中/失败原因在进度组件继续显示。

如实记录修正：长组首轮 fixture 用 createMany 把已属于另一精确组的合成作品重复加入，触发现有 `(runId,artworkId)` 唯一约束；改为在 fixture 中将该组的两成员移入长组，不改产品约束，定向重跑通过。UI 草稿中一次可选链换行语法错误和一次对折叠摘要的精确文本断言，修正后相关组件通过。App 首次类型检查发现 DB barrel 未导出所用 enum，改用已有 Prisma 字段类型后重跑通过。一次将基线文件置于仓库外运行 oxlint 触发工具的 root 路径断言，改在工作区临时副本核对并删除副本，确认上述 12 项确属既有问题。

实际命令（工作区根目录；测试路径相对 App 包）：

```bash
pnpm install --frozen-lockfile
pnpm --filter @pixishelf/db db:generate
# 仅本轮已核对的隔离合成库，两个变量必须相同：
task_validation_db='postgresql://pixishelf_batch:batch_fixture@127.0.0.1:56432/pixishelf_batch'
DATABASE_URL="$task_validation_db" pnpm --filter @pixishelf/db db:deploy
DATABASE_URL="$task_validation_db" QUEUE_KERNEL_TEST_DATABASE_URL="$task_validation_db" pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-pending-results.postgres.test.ts
DATABASE_URL="$task_validation_db" QUEUE_KERNEL_TEST_DATABASE_URL="$task_validation_db" pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-pending-results.postgres.test.ts -t 'keeps the remaining'
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-review.test.tsx app/admin/duplicates/_components/__tests__/duplicate-batch-delete.test.tsx services/__tests__/artwork-dedup-review-groups.test.ts
pnpm --filter @pixishelf/next exec vitest run app/admin/duplicates/_components/__tests__/duplicate-batch-delete.test.tsx app/admin/duplicates/_components/__tests__/duplicate-workspace.test.tsx app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx -t 'compact deletion progress|workspace|labels the relation stage'
pnpm --filter @pixishelf/next typecheck
pnpm --filter @pixishelf/db typecheck
pnpm docs:check
WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check
rg --files packages/pixishelf | rg '[A-Z]'
git diff --check
```

离线安装首次缺本地 tarball，在线按 frozen lockfile 安装成功，锁文件没有改动。没有运行全量 App lint/test/build、Worker 构建或原完整删除专项。

## 桌面与清理证据

本轮仅一轮现有桌面布局核对，无视觉重设计或反复打磨。Chrome 使用 `entry=direct` 与合成账户 `batch-review`；独立 App 端口 56430，旧隔离数据库端口 56432，媒体仍为 `/private/tmp/pixishelf-batch-delete-env/media`，本轮没有启动 Worker。

- [剩余结果](assets/dedup-pending-results-2026-10-31/remaining-results.jpg)：上一轮确实完成的四源混批样本仍保留原发现 24 组，当前只剩 20 组，四个已处理组及成功批次不再堆在结果页；推荐也是当前 20 组。该轮实际文件删除/七天回收证据见[原验收](./dedup-shared-deletion-2026-10-31.md)。刷新后仍为当前剩余结果。
- [全部处理完](assets/dedup-pending-results-2026-10-31/processed-empty.jpg)：新专项终态合成样本，原发现 24 组、当前 0 组；不再提示作品被修改，也不称最初没有找到重复。
- [删除记录](assets/dedup-pending-results-2026-10-31/deletion-records.jpg)：原四部成功批次及报告仍在单独记录页可追溯。

根线程已独立审查 SQL、服务端分页/范围、缓存失效与组件专项，并查看上述三张实际截图，最终审查通过，无新增阻塞；最终文档检查 365 篇通过，图检查 34 源与 23 内嵌 Mermaid 通过；主应用路径大写检查无命中，git diff whitespace 检查通过。

2026-10-31 17:26:12+08 已停止本轮自建 App（Ctrl-C，退出 130）和 `pixishelf-batch-delete-postgres` 容器，loopback 端口 56430/56432 均已释放；未停止或修改用户服务。容器、原合成媒体和证据保留，见 [cleanup.json](assets/dedup-pending-results-2026-10-31/cleanup.json)。恢复查看可按[原环境恢复命令](./dedup-shared-deletion-2026-10-31.md#环境停止与复现)启动同一隔离容器/App，先 deploy 本次 migration；原样本为 artist 49/run `86d69d03-f8e7-4412-b770-dd8a6cdc207b`，空态为 artist 69/run `b0f6ab3e-d187-4497-a2cc-57459ab817ac`。不连接生产或既有开发库。

未验证生产部署、真实 NAS 或新增文件删除流程；这些不是本轮读侧修复范围。除已核对的 DB 历史 lint 外，无未解决实现/专项失败。
