---
status: current
scope: 首次跨越历史 Schema、payload 和 Worker capability 边界时的附加门禁
last-verified: 2026-10-22
sources:
  - build/entrypoint.sh
  - packages/pixishelf-db/prisma/migrations
  - packages/pixishelf-worker/src/production-capabilities.ts
  - packages/pixishelf/scripts/archive-lane-cutover-audit.ts
---

# Schema 与任务能力升级门禁

本页只补充[标准发布](../deployment.md)之外的条件。按实际 `_prisma_migrations` 和源/目标版本选择涉及的行；不重复执行已经完成的历史步骤，也不将这里列出的 migration 当成生产完成记录。每项仍需停写、同点备份、配套 App/Worker、READY 与目标 capability inventory 校验。

## 必须专用审计的升级

| 边界                         | 先决条件与执行入口                                                                                                                                              | 回退限制                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 艺术家/系列旧字段删除        | 旧版本先收口文件迁移，退出依赖旧列的消费者和导出工具；按[旧字段清理](../../features/legacy-identity-retirement.md)完成 audit/prepare/upgrade 和两份身份验证 SQL | 两份删列迁移分别提交，部分成功也不能启动旧代码；优先继续修复或完整同点恢复     |
| 双 lane 切换                 | 下节容器与数据库审计，等待任务 type/version 须被新 Worker 支持                                                                                                  | migration 改写执行索引/租约边界；旧 `archive-worker` 和单 lane Worker 不再兼容 |
| 后台任务兼容层二阶段删除     | [退役手册](./background-task-retirement.md)，显式 phase2-before/deploy/phase2-after                                                                             | 删列后不能仅换一阶段或 v0.50.8 镜像                                            |
| 删除 FULL_RECONCILE executor | 所有非终态 FULL payload 必须为零，见下节查询                                                                                                                    | 保留终态历史；不得篡改 payload、伪造状态或删历史以通过审计                     |

### 双 lane 与 FULL 审计

停写后核对同一 Compose project 的全部容器，移除已明确退役的 orphan 服务，再确认旧 `archive-worker` 容器为零。数据库审计无法发现空闲但活着的旧消费者。`--remove-orphans` 前先确认项目归属及自定义服务，不能跨项目盲删。

```bash
pnpm --filter @pixishelf/next archive:lane-cutover-audit
```

必须连接目标实例的旧数据库，使用目标版本源码或一次性镜像运行。退出 0 才继续；2 表示业务/消费者阻断，1 表示审计自身失败。它阻断执行态任务、活动旧全局 lease、新鲜旧 Worker、执行中归档和不支持的等待任务。普通兼容的 PENDING/PAUSED/RETRY_WAIT 可保留；FULL 是额外 payload 级门禁。

用只读数据库连接执行：

```sql
SELECT id, status, "definitionVersion", "createdAt", "availableAt", "workerId", error
FROM system_jobs
WHERE type = 'SCAN'
  AND payload->>'mode' = 'FULL_RECONCILE'
  AND status IN ('PENDING', 'RETRY_WAIT', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING')
ORDER BY "createdAt", id;
```

结果必须为零；有记录时保持兼容旧 Worker，通过业务入口完成或取消收口，然后立即进入停写升级。migration 会拒绝执行态任务和未过期旧全局租约，并清理过期旧 lease；它不替代实际停止消费者。

切换记录需保留 audit 退出码/脱敏报告、migration 前后状态、等待任务清单、新旧 digest、旧消费者为零、双 lane READY/capability 及 FIFO/并行/不重叠冒烟。历史合成演练见[收件箱记录](../../records/operations/archive-intake-cutover-deployment.md)。

## 领域升级的附加要求

| 领域/迁移                                    | 发布时增加的检查                                                                                                                                                                   | 恢复边界与详情                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Pixiv 作品同步 `20260826143000`              | 数据库与 Pixiv data 的 `artworks/.../metadata`、`sync-reports` 同点；先确认 `PIXIV_ARTWORK_ENRICHMENT@v1` 能力，小样本默认补全/显式刷新并核对 JSON、文本保护和 SOURCE 标签后再放量 | 文件成功与数据库失败分别核对；[在线同步](../../features/pixiv-artwork-online-sync.md)                                         |
| 实时进度 `20260904200000`                    | 首次事件清理先 dry-run，验证 SSE 重连；动画识别先并发 1 取样，再与 4 比较同样分类和吞吐，提升不足 20% 保持 1                                                                       | 回退兼容代码保留 nullable 列/事件索引；[实时进度](../../features/background-job-live-progress.md)                             |
| 创作者关系 `20260908120000`                  | Schema 门禁包含关系/维护表与有效关系视图；确认 CREATOR_MAINTENANCE；历史补全从逐项预览启动                                                                                         | 迁移不移动媒体；[创作者关系](../../features/creator-relations.md)                                                             |
| Pixiv 根身份 `20260911120000`                | 停旧 Worker，保存标记及数据库；设备变化/缺失的旧库先人工绑定，再消费新导入                                                                                                         | UUID 与 inventory 配对；[根身份](../../features/pixiv-root-identity.md)                                                       |
| 发现创作者 `20260916120000`                  | 协调更新写入者；回填首次匹配时间与人工排除，但不自动绑定历史结果                                                                                                                   | 不删除待生效、抑制或永久回执；[发现与创作者](../../features/creator-relations.md)                                             |
| 诊断 `20260916160000`                        | dump 包含完整报告/明细，旧任务没有完整过去报告；清理首次 dry-run，关闭后证据保留 90 天                                                                                             | 回退保留新增列/表；保全新诊断后才能整体恢复；[诊断](../../features/background-job-diagnostics.md)                             |
| 批量扫描 `20260920120000`                    | 扩展 lane 约束与活动批次唯一索引；新旧 Worker 的父子任务保护不同，须配套升级                                                                                                       | 回退先取消批次、等待子任务终止，不删目录/清游标；[领域恢复](./domain-recovery.md)                                             |
| WebP 时长 `20260924120000`                   | 新表不回填旧 Image；默认关闭计划，先在真实 NAS 至少 100 个代表性 WebP 验证再批量                                                                                                   | 保留 `.bak_session` manifest；无 manifest/COMMITTING 不可猜测回滚；[时长方案](../../architecture/animation-duration-probe.md) |
| 阅读记录 `20260924130000`                    | 增加 mediaRevision 和两张账户阅读表，不回填历史阅读；Worker 要求 Schema 就绪                                                                                                       | 旧代码重建媒体会破坏版本语义；[阅读恢复](./domain-recovery.md#阅读与派生摘要)                                                 |
| 手动阅读 `20261009090000`                    | 保留既有记录，允许无实际访问时间，增加状态版本                                                                                                                                     | 旧代码不能读取新 nullable 时间；不伪造时间，使用兼容版本或完整恢复                                                            |
| 标题规则 `20261022000000` / `20261022001000` | 添加修订/评估/人工决定/目录版本触发器；仅等价回填旧规则，管理员显式预览后应用；核对新扫描版本能力                                                                                  | 不兼容旧 JSON/人工决定/v4 扫描时不能仅退镜像；[标题规则](../../features/archive-title-rules.md)                               |

标题名称与多上传者条件属于 JSON/payload 兼容边界，即使无 DDL，也要先部署能读新 JSON、执行对应版本的 Worker/App 再开放入口。存在新条件后，不可用旧严格校验器直接读取或原地删除条件来降级。

WebP 浏览器播放器本身由版本化预编译产物交付，普通 App build 不编译 C，也不需要新增播放开关；仅原生源码/工具链更新时重建并提交产物。纯播放器版本回退可使用配套旧 App 镜像，但不能据此忽略同时发布的领域 migration。平台/真机与性能限制见[播放器方案](../../architecture/webp-player.md)。

## 静音音轨校准

`hasAudio` 语义为“检测到可听内容”。首次升级该语义与 nullable 章节实测字段时：

1. 建立一致性检查点，部署迁移、配套 App/Worker 和 v3 合并脚本，保持调度停止。
2. 在“视频媒体探测与封面生成”中执行“校准现有有音频”，只选择创建任务时 `hasAudio=true` 的记录。
3. 确认剩余数、视频探测失败和章节音频失败均为零；环境故障修复后可重试，检查点会跳过同任务中已成功项。
4. 抽样纯静音、真实有声和逐章混合视频后开放调度；静音合并视频可以有 AAC 流，但音频显示应为无。

不批改旧 `chapters.json`、不重新编码、不重建健康封面/章节截图。回退代码保留 nullable 字段；撤销校准结果使用发布前检查点，不把全部记录手改为 true。

## 发布证据

本页规定操作，不宣称生产发布完成。日期、版本、环境、报告、快照、测试数量和未覆盖项放入[运维记录](../../records/operations/)，功能正文只链接证据。已有明确记录：[后台任务退役](../../records/operations/background-task-retirement-2026-10.md)、[阅读初始迁移](../../records/operations/reading-migration-2026-09-24.md)。
