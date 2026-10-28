---
status: historical
scope: F03 第七批比较工作量分轮继续的实现、独立验收与交付边界
last-verified: 2026-10-28
sources:
  - docs/design/artwork-deduplication/visual-batches-f03-contract.md
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
---

# F03 第七批：比较工作量分轮继续

## 范围与基线

用户在文档收口后授权“提交并进入下一阶段”。文档先提交为 `e26b43fa`；本批在独立 worktree `codex/dedup-scale-validation-f03` 继续，主目录、用户开发库、真实媒体及其服务未参与。当前语义统一见[功能规格](../features/artwork-deduplication.md)，本批约束见[第七批契约](../design/artwork-deduplication/visual-batches-f03-contract.md#第七批比较工作量分轮继续实施契约)。

只补候选比较工作量的显式分轮继续。新检测 v6 每轮最多 200,000 次实际比较加关系复用，达到上限且仍有待处理内容时保存检查点并暂停，用户点击“继续检查”才开启下一轮。累计计数不清零，普通暂停、让行、Worker 重启和任务重领都不会额外授权。原 v5 行为不变。当前未完成检测不能进入审核或删除；既有删除流程未修改。

10,000 个登记原件、单作品、单查询、索引与单对匹配边等结构性限制保持。50 万、原图真实解码、NAS 和并发业务不在本批范围；本次不做全量应用 lint/test/build，不重复既有规模长测。

实施：GPT-6 Astra / high；界面与隔离 fixture：GPT-6.1 Sol / xhigh；独立审查：GPT-6.1 Sol / xhigh；桌面：GPT-6.1 Sol / medium。

## 实施与安全边界

- 正式加法迁移 `20261028000100_artwork_dedup_visual_rounds` 增加轮次、起点和等待标记，旧行保持 `0/0/false`，不扫描媒体。
- 比较只提交合法候选前缀，边、计数、游标和等待标记同事务落库；旧源、目录变化、取消、失租约或失败提交都不能推进。
- 继续沿用原控制资源／任务／run 锁、版本 CAS 和幂等收据，并发或重复请求只授予一轮。
- 单对边上限独立为 `VISUAL_EDGE_BUDGET`，不能靠下一轮绕开。Worker 同时注册 v5/v6；维护版本仍为 v5。
- UI 只增加服务器返回的暂停原因和一行说明；操作仍来自 `allowedControls`，真实故障优先显示。

## 专项验证

后台共 77 个不同用例通过，UI 30 个用例通过。专项由对应实施 agent 执行；主线程核对交接摘要，独立审查者核对代码、升级原始日志与脚本，未另跑一套相同测试。

| 范围 | 结果与覆盖 |
| --- | --- |
| 任务契约 | 3 通过；可空暂停原因及版本 |
| 数据库迁移静态 | 3 通过 |
| 数据库分轮约束 | 5 通过；等待时拒绝 COMPLETED／发布并回滚，失败取消清标记，旧上限保留 |
| v6 视觉内核 | 11 通过；20 轮与连续 oracle 相等、混合 1,800 实际与 900 复用、137 次真实比较恰好尾边界、重建上下文无点击零推进、失租约／源／目录／取消／回滚 |
| 真实 executor | 3 通过；实际暂停、等待落库后收口前崩溃重领、取消优先；该文件其他 64 例未选中 |
| v5 分段回归 | 29 通过，4 个显式规模 profile 跳过；未重跑规模长测 |
| 控制服务 | 10 通过；普通暂停不加额、继续幂等与并发、旧请求重放 |
| Worker 注册 | 13 通过；旧版本兼容与新 v6 |
| 检查页组件 | 30 通过；等待说明、真实故障优先、结构上限及控制状态；两文件定向 lint 无告警 |
| 类型与构建 | DB、executors、Worker 及 App typecheck 通过；主线程执行一次 `pnpm worker:build` 通过 |

主应用控制服务与其专项测试的定向 lint 也通过。额外将 App lint 配置用于跨包实现时，提示 executor 原有 6 处 `curly` 风格问题，已对照 `HEAD` 确认均非本批新增；未改写无关格式。

后台摘要：`/private/tmp/f03-budget-backend-evidence.json`（工具结果摘要，非原始 stdout）。构建与 App 类型日志分别为 `/private/tmp/pixishelf-f03-budget-worker-build.log`、`/private/tmp/pixishelf-f03-budget-app-typecheck.log`。

空库正式部署 127 条迁移通过。独立升级库先部署 126 条并预置合法旧 v5 行（两项计数各 200,000），再部署第 127 条；原整行证据不变，新字段为 `0/0/false`，旧计数 200,001 仍被拒绝。日志和核验脚本保留于 `/private/tmp/f03-budget-upgrade-cjyas5g_`。测试库仅为 `127.0.0.1:55432` 上的 `f03_budget_continue_20261028` 和 `f03_budget_upgrade_20261028`。

[独立审查](./artwork-deduplication-budget-continue-f03-review-2026-10-28.md)通过，无未解决阻断。首轮 P2：终态同步可能先清等待再接受 COMPLETED；已改成仅失败／取消清等待，并补数据库拒绝和回滚用例。

## 桌面隔离验收

[独立桌面验收](./artwork-deduplication-budget-continue-f03-browser-2026-10-28.md)通过。实际 UI 只开始一次快速检查，同一 run `b71eb04f-9bdc-43e8-bcda-1028f8298357` 在 200,000 次暂停；刷新等待及真实 Worker 重启后仍为 PAUSED/PENDING、第一轮、等待继续。仅点击一次继续，最终为 COMPLETED/COMPLETE、第二轮、起点 200,000、累计 240,000 次、0 视觉关系。命令记录只有一次 resume，无删除操作。

4 部作品与 1,600 个媒体保持；暂停、刷新、重启后和完成时原文件读取计数均为 45,417,993 字节，续行没有清零累计数据。原 Worker PID 25671 正常退出后以同一构建启动 PID 44871；完成后仅停止自建 Worker 和 App（PID 25950），两个执行会话均 exit 0，5492／55832 无监听。未停止用户服务。样本与数据库保留，恢复测试可使用上述隔离目录内的 `start-app.sh`／`start-worker.sh`；脚本会校验库、根、端口和 Worker ID。

本次从开始到最后快照约 33 分 29 秒，包含人工等待与重启，不作吞吐基准。高密度候选在累计 24 万后仍需走完末尾反向查询；只在最终状态 COMPLETE 后验收，不把累计数达到预期当成完成。截图与快照见浏览器记录。

独立 App `127.0.0.1:5492`、Worker 健康端口 `55832`，库 `dedup_f03_budget_browser_20261028`；启动与媒体目录为 `/private/tmp/pixishelf-f03-budget-browser-20261028`。4 部作品共 1,600 个合法 PNG，SHA／inode 各自唯一，45,417,993 字节；按真实文件身份预置视觉特征，未预置检测任务、字节缓存或完成结果。

独立 oracle：4 个特征家族、每家族跨 4 部作品各 100 张，比较数为 `4 × C(4,2) × 100² = 240,000`。每次查询 16,000 posting／400 候选，总索引 64,000，每作品对最多 40,000 边；生产限制和数据库 CHECK 均未改。家族内多义边预期不发布视觉关系，最终应为 COMPLETE／0 组。这是预制特征下的真实控制流程验证，不是识别效果或解码吞吐证明。

登录准备阶段发现合成账户未遵循正式用户名邮箱规则，已只在隔离库修正并轮换临时密码；原 userId、全部媒体与视觉缓存保持不变，未改 App 登录代码。

fixture 证据保留在 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-budget-20261028/browser-fixture/`。

## 文档与图示

`pnpm docs:check` 通过（最终含浏览器记录共 307 篇 Markdown）；`pnpm docs:diagrams` 生成更新图，`pnpm docs:diagrams:check` 通过（34 个源、23 个嵌入块）。只保留处理上限图的本批更新，其他图源未变的渲染差异已撤回；PNG 已实际查看，文字和箭头可读。`git diff --check` 通过，主应用路径大写检查无匹配。

## 交付状态

实现、专项、独立审查、桌面及文档图示门槛已通过，与本记录一同提交后暂停。本批不合回主目录、不部署开发或生产实例、不开放下一批。
