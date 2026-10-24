---
status: historical
scope: 额度恢复后剩余80%触发的去重开发停工交接；不代表最终验收或上线
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-checkpoint-2026-10-24.md
  - docs/records/artwork-deduplication-source-snapshot-review-2026-10-24.md
  - docs/records/artwork-deduplication-prepare-scale-2026-10-24.md
  - docs/design/artwork-deduplication/claims-contracts.md
---

# 去重开发停工交接

2026-10-24 05:25:07.582（Asia/Shanghai）确认 codex primary 周窗口已用20%、剩余80%，触发用户授权的停工条件。01:41:34曾实测恢复至100%，恢复后峰值100%；此次不是把恢复前14%误判为阈值。secondary始终未返回，仍为未知。停止新实施、审查和验证，等待用户主动唤起，不自动恢复开发。

## 文件与提交

- 独立工作区：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`。
- 分支：`codex/artwork-deduplication`；HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f`。阶段二功能基线为`c2d6be73`，该HEAD包含阶段二性能证据。
- 触发后、写本交接前：61个已跟踪文件修改、108个未跟踪文件、暂存路径0；已跟踪差异为1112行新增/296行删除，不包含未跟踪文件内容。本交接另新增1个记录文件。没有为了收尾提交半成品。
- 完整Git路径清单、diff统计、进程及端口证据：`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-stop-inventory-2026-10-24.json`。
- 主目录、其暂存区、用户服务、真实媒体和数据库未作停工修改。所有未提交文件保留，禁止reset/clean/checkout丢弃。

## 完成范围与缺口

| 范围 | 已落盘并核验 | 未完成 |
| --- | --- | --- |
| 阶段一、二 | 指纹/缓存/失效与后台检测实现、独立审查；合成50万登记冷/热/稀疏候选及下载/浏览/发布争用证据 | 最终统一浏览器与交付检查 |
| 阶段三 | 审核和跨页范围、ID封面、清理预览、reader恢复、Worker串联；定向测试与独立审查通过；共享门禁3 | D3-05完整规模验收、最终桌面/手机浏览器 |
| 第三至第五阶段界面 | 分页组/成员、保留选择、影响详情、预览、操作详情和后续动作UI；两项界面P2已修复复审 | 完整后端接线后的实际交互验收 |
| 阶段四基础 | DB全局声明与两个写原语；App阅读、评分、图片标记、元数据/排序守卫；来源证明五个持久槽及格式；均独立审查 | 全写入口、生产来源capture/assert与快照消费、双向代次释放、URL hold/drain、隔离/恢复执行器和故障恢复 |
| 文件动作基础 | 已有实现者测试和原审查两项修复证据 | 修复独立复审被平台风险检查阻断，仍待完成；不绕行、不冒称通过 |
| 阶段五 | 设计契约和部分数据/UI结构 | 保留者重验、实际永久清理、稳定重试、URL授权、非URL删除标记/显式重导、历史GC、升级恢复手册及验收 |

阶段三开放的是审核与只读PREPARE；ISOLATE、RESTORE、PREPARE_PURGE、PURGE及重导等高级入口仍拒绝，未开放原媒体移动或删除。

## 各线最终交接

- 数据Astra：来源槽及最后P2窄修已冻结，无运行进程。新增正式111迁移，只升级dedup_data_next；五旧行保留、新列null，契约24/24、五槽PG1/1、DB/contracts类型通过。最低迁移门槛及五列校验补齐，单测32/32、专库只读catalog1/1通过。见[来源槽实现](./artwork-deduplication-source-snapshot-2026-10-24.md)。
- 独立Sol审查：来源槽P2已窄复核关闭，其余本批无阻断发现；未重跑PG。见[来源槽独立审查](./artwork-deduplication-source-snapshot-review-2026-10-24.md)。此前[声明](./artwork-deduplication-claims-review-2026-10-24.md)、[个人整理](./artwork-deduplication-app-personal-guards-review-2026-10-24.md)、[元数据/排序](./artwork-deduplication-app-structure-guards-review-2026-10-24.md)均已独立审查。
- 执行器Astra：生产PREPARE和Worker串联已完成并审查；最后仅做[来源与写入口盘点](./artwork-deduplication-write-entry-map-2026-10-24.md)，固定五槽、旧输入拒绝、staging先登记及drain允许列表，没有实施这些生产接线。
- UI线已在前批结束，见[实现](./artwork-deduplication-ui-2026-10-24.md)和[审查](./artwork-deduplication-ui-review-2026-10-24.md)。
- 触发时实时名单中两条实施线和Sol审查者均为completed，因此没有重新唤起它们收尾，也没有强制中断或丢弃修改。

其他已有证据见[阶段三串联](./artwork-deduplication-stage-3-integration-2026-10-24.md)、[数据审查](./artwork-deduplication-stage-3-data-review-2026-10-24.md)、[编排审查](./artwork-deduplication-orchestration-review-2026-10-24.md)和[PREPARE审查](./artwork-deduplication-prepare-review-2026-10-24.md)。最近文档237项通过。停工没有另开全量build/test。

## 性能证据的实际边界

[阶段二](./artwork-deduplication-phase-2-performance-2026-10-23.md)使用生成的1000作品×500媒体登记，不是真实图库抽出的50万张独立文件。热缓存0内容读取已测；冷缓存、稀疏候选和争用数据按记录解释，含计量间隙限制。

[阶段三规模记录](./artwork-deduplication-prepare-scale-2026-10-24.md)包含真实HTTP、3350次属性检查、50万清单分页和SQL-only冲突终结。最后5.135秒在30秒事务上限内提交STALE/OWNERSHIP_CHANGED、100条诊断；共享路径样本不具备READY条件，logicalBytes为null，未走有效50万READY容量汇总。D3-05为部分覆盖，不重复跑已完成测量或把它改写为完整通过。

## 留存环境与恢复顺序

停工只读进程核对没有发现以去重worktree或dedup临时目录为cwd的Node/pnpm/tsx/vitest/bun/native运行进程；5440/5441没有监听。先前自建App均已停止；用户5430未操作。唯一明确留存的自建服务是Docker容器`pixishelf-dedup-postgres`，仍运行，绑定`127.0.0.1:55432->5432`，保留数据库和证据。

| 专库 | 记录的正式迁移版本 | 后续限制 |
| --- | --- | --- |
| dedup_data_next | 111 | 当前生成客户端可用于该专库的定向验证 |
| dedup_executor_next | 110 | 新客户端使用前按正式迁移流程升级该指定专库 |
| dedup_prepare_scale | 110 | 保留规模证据；新客户端不可盲跑全字段查询 |
| dedup_scale | 106 | 冻结阶段二证据，禁止直接迁移；冻结代码自有客户端 |

上述数据库版本来自已落盘迁移记录，停工未再次连接查询。worktree生成客户端与主目录文件已验证独立；主目录客户端不含新五字段。原样本、日志和只读测量文件保留；不套用通用cleanup删除共享现场。

用户明确继续后：

1. 先读本交接与[最新检查点](./artwork-deduplication-checkpoint-2026-10-24.md)，核对实际Git变化和其他线程的新工作；不重做前三阶段已完成小批。
2. 按[声明契约](../design/artwork-deduplication/claims-contracts.md)和[写入口盘点](./artwork-deduplication-write-entry-map-2026-10-24.md)实现有界多身份capture/assert及生产冻结/发布守卫。历史null拒绝，禁止给旧任务补当前generation；取消/失败/drain保留原fence允许路径。
3. 后续完成release双向失效、staging登记先于文件操作、URL持久hold和停止证明，再衔接隔离/恢复/清理；文件基础独立复审的阻断单独处理，当前不得绕过。
4. 实施仍用Astra/xhigh，独立审查Sol6.1/xhigh，最终浏览器Sol6.1/high；仅跑受影响定向验证。全部集成后的主应用完整检查、受影响Worker、空库/非空升级及图示/浏览器统一验收仍欠缺。

在用户确认继续、选定隔离库并配置对应环境后，续接命令为：

```bash
cd /Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf
git status --short
pnpm --filter @pixishelf/db db:status
# 仅当选定的非冻结专库需要升级时：
pnpm --filter @pixishelf/db db:deploy
pnpm --filter @pixishelf/db db:generate
# QUEUE_KERNEL_TEST_DATABASE_URL 必须明确指向所选专库：
pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-claims.postgres.test.ts
```

运行db命令前必须显式设置指向隔离库的DATABASE_URL，不能沿用真实环境；不会使用db:push。上面是恢复依据，不是停工期间已执行命令。更多定向命令与原始日志由各批记录提供。数据库容器若被另行停止，确认其名称和用途后可用`docker start pixishelf-dedup-postgres`恢复；无需重建或清库。

额度检查历史位于`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-quota-monitor.json`。自动化80在本次收尾后暂停；再次开发必须由用户主动发起。
