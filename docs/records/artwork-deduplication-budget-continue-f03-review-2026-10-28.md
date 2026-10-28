---
status: historical
scope: F03 第七批比较工作量分轮继续的独立代码审查与转交验证证据核对；不替代整体验收或部署记录
last-verified: 2026-10-28
sources:
  - docs/design/artwork-deduplication/visual-batches-f03-contract.md
  - packages/pixishelf-db/prisma/migrations/20261028000100_artwork_dedup_visual_rounds/migration.sql
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-visual-rounds.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-rounds.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor.postgres.test.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-service.postgres.test.ts
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-run-status.tsx
  - packages/pixishelf/app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx
---

# F03 第七批独立审查

日期为 2026-10-28，比较基线为 `e26b43fa`。审查对象为独立 worktree 中本批代码、迁移、UI 和相关测试的最终工作差异。审查者未参与实现，没有运行测试、启动服务或接触主目录、真实数据库及媒体；执行结果由实施者与主线程转交，升级部署日志另作只读核对。

**代码审查结论：通过，无未解决的阻断发现。** 首轮提出的 P2 已修正并有数据库拒绝与回滚用例覆盖。本结论限定于本批代码和已列证据；整体交付中的 Worker 构建、桌面冒烟、文档检查与提交由主线程另行收口。

## 控制边界检查

按第七批实施契约，核对了新增 run 字段与迁移、候选前缀提交、执行器收口、原 control 事务、DTO、Worker 版本注册以及 UI 差异。以下结论来自代码阅读，并与转交的专项用例断言逐项对应。

- 每轮计费使用累计实际比较加累计兼容复用减本轮起点；生产比较常量仍为 200,000，候选块内保留下一待比较候选，边、计数、游标及等待标记在原提交事务中写入。准确用满后如仅剩无需计费的候选或发布工作，可正常完成。
- RESUME 仍受原资源、job、run 锁顺序、expectedVersion 和幂等收据约束；轮次和起点更新留在同一控制事务中，客户端没有额度或检查点输入。
- 持久等待会让重建执行上下文停回暂停路径；取消、读取退出故障和失败收口优先。受控读取子进程关闭及 reader token 释放先于预算暂停确认。普通暂停、自动让行和崩溃重领本身没有递增轮次的代码路径。
- 旧行默认轮次与起点为 0、等待为 false；0 轮保留旧累计计数约束。正轮约束在运算前转为 bigint。SCAN v6 能力新增时显式保留 v5；维护任务版本范围保持至 v5。
- DTO 只新增公开的暂停原因，旧响应缺失字段默认 null；轮次、累计数及检查点没有成为客户端控制输入。UI 只按服务端 allowedControls 显示继续入口，等待确认期间重复点击受既有请求互斥保护，真实读取故障文案优先。
- 结果查询、审核保存及清理准备入口仍要求 run 为 COMPLETED，未完成本轮没有新增结果授权入口。原有历史结果只读展示未改动；RESUME 不复制历史选择、审核记录或删除授权。
- 单作品、原件总数、单图、索引、posting、候选、作品对等限制未提高；单作品对边容量从比较次数常量中单独命名但仍为 200,000，v6 使用 VISUAL_EDGE_BUDGET 明确作结构性未完成收口，v5 保留原错误语义。

## 已提出的发现

### P2：完成同步不能静默抹掉预算等待

首版迁移的 `sync_artwork_dedup_job_state()` 在 job 转为 `COMPLETED` 时也清除 `visualBudgetWaiting`。这会让仍处于 `VISUAL / PENDING` 且等待下一轮授权的 run 在任务完成同步时失去等待证据，随后通过新 CHECK 并成为 COMPLETED；现有结果查询与审核入口主要以 COMPLETED 作为放行条件。

取消、失败及跳过需要清理许可，正常完成应要求预算等待已经通过合法流程解除。此发现已在实现期间通知主线程。后续差异已将清理限定为 FAILED、SKIPPED、CANCELLED；COMPLETED 同步保留等待标记，而等待分支允许的 run 状态不含 COMPLETED，因此 CHECK 会拒绝提前完成。旧 v5 行的默认等待仍为 false。

**状态：已关闭。** 已核对静态修正及数据库用例：等待中的 job→COMPLETED、run→COMPLETED 和 stage→DONE 均拒绝，失败语句后 job 状态与等待标记保持原值；失败、跳过和取消的队列同步则清理等待且保留累计数。该专项由实施者执行，转交结果为 5/5 通过。

## 验证证据核对

以下为本批实施者与主线程转交的工具执行结果摘要。审查者阅读对应测试代码及断言，没有重跑测试；除升级部署日志外，原始 stdout 保留在执行者的子任务工具记录中，没有另存成仓库日志文件。

| 范围 | 转交结果 | 已核对的边界 |
| --- | --- | --- |
| v6 比较轮内核 | 11/11 通过 | 2,700 次实际比较分 20 轮、每轮合法边前缀和 oracle 一致；1,800 实际加 900 复用仍合计计费；新上下文及重复调用不授权；取消、源、目录、执行版本、失租约与事务回滚不提交迟到边界；v5 兼容与边硬限保留 |
| 精化尾边界 | 1 通过，10 未选中 | 实际生成恰好 137 次比较，首轮正常完成且不要求空轮；替代先前预填累计数的测试方式 |
| App control | 10/10 通过 | 同幂等键并发返回同收据；不同键同版本只有一个请求成功；旧收据在后续等待中重放不续额；普通暂停不增轮；取消清等待、retry 清空轮工作 |
| 数据库约束 | 5/5 通过 | 提前完成拒绝与回滚；失败、跳过、取消清等待；正轮合计上限与起点约束；0 轮保留旧单计数上限 |
| 真实隔离 executor | 3 通过，64 未选中 | reader 退出后预算暂停；在 reader 退出、队列暂停前崩溃后重领仍不增轮；取消优先。未选中项不记为本次已执行 |
| 旧 v5 视觉批次回归 | 29 通过，4 显式跳过 | 原有界批次与查询路径；跳过项为 profile 或规模验证，本批没有据此声明规模能力 |
| Worker 注册与契约 | 13/13、3/3 通过 | v5 与 v6 注册共存；旧 Worker 不解析 v6；DTO 旧字段缺失默认 null |
| UI | 30 例及定向 lint 通过 | 显式继续才发送原 control；预算文案、真实故障优先、服务端权限控制、不可续行 INCOMPLETE 无继续按钮 |
| 类型检查 | DB、executors、Worker 三包 exit 0 | 受影响后端包类型闭合 |

升级证据使用独立 `127.0.0.1:55432/f03_budget_upgrade_20261028`，未使用真实图库。只读核对的 `/private/tmp/f03-budget-upgrade-cjyas5g_/before-deploy.log` 显示正式旧链 126 个迁移成功；`after-deploy.log` 显示新链 127 个迁移，仅应用 `20261028000100_artwork_dedup_visual_rounds`。保留的 `/private/tmp/pixishelf-f03-budget-upgrade.py` 对合成旧行升级前后完整 JSON 作相等断言，除新增字段 0／0／false 外证据不变，并断言旧计数 200,001 仍被原命名约束拒绝。旧行两个计数各为 200,000 的合法旧约束情形得到保留。执行者另转交正式空库 127 迁移通过；审查者没有另查数据库或执行该脚本。

## 限制与后续门禁

本次没有执行删除，没有验证真实图库、NAS、50 万全流程或提高结构性范围。测试内降低轮工作量仅用于隔离 fixture，生产常量与公开范围保持原值。数据库约束用例覆盖提前完成拒绝；暂停期间审核与清理的拒绝则由既有 COMPLETED 状态门禁及本轮不变的授权路径静态核对，未额外执行删除路径。

本记录完成独立代码审查。桌面可见行为、一次必要 Worker 构建、文档与图示检查及最终提交状态以主线程验收记录为准，不由本记录推断通过。
