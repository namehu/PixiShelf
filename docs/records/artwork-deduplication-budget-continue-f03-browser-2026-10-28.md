---
status: historical
scope: F03 第七批比较预算暂停、刷新、Worker 重启与显式继续的隔离桌面浏览器验收
last-verified: 2026-10-28
sources:
  - docs/features/artwork-deduplication.md
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-workspace.tsx
---

# F03 第七批比较预算继续：桌面浏览器验收

2026-10-28 在分支 `codex/dedup-scale-validation-f03`、基点 `e26b43fa` 加当时未提交实现上验收。结论：本次隔离样本通过 20 万预算暂停、刷新保持、隔离 Worker 重启保持及同一 run 显式继续到 24 万完成。不是生产部署或完整规模性能验收。

## 环境与样本

- App `127.0.0.1:5492`；Worker 健康端口 `55832`，均由主线程启动和收尾。
- 唯一数据库 `dedup_f03_budget_browser_20261028`，位于 `127.0.0.1:55432`。
- 合成媒体根 `/private/tmp/pixishelf-f03-budget-browser-20261028/media`；4 部作品、1,600 个独立 PNG，预制视觉特征。
- 独立 oracle 枚举预期 240,000 次候选比较，第一轮生产预算 200,000；结构上限未放宽。多义边对照预期视觉关系为 0。
- 使用 Codex 内置桌面浏览器，初始入口带 `entry=direct`。浏览器只通过实际表单和按钮操作；未通过页面脚本、API 或写库制造检测状态。
- 初始合成账户邮箱不符合正式用户名表单校验，未能登录；夹具代理将本批账户改为合法短用户名并轮换临时密码后，经真实登录继续。功能代码未因此修改。

## 实际操作与结果

runId：`b71eb04f-9bdc-43e8-bcda-1028f8298357`。页面“检查选项”中确认“快速检查”选中、“逐一重查”未选中，显式选中“检查疑似版本”，仅点击一次“开始检查”。数据库核对模式为 `INCREMENTAL`，任务契约版本为 6。

| 时点（上海时间） | 实际界面与操作 | 只读持久状态 |
| --- | --- | --- |
| 15:04:15 开始 | 点击一次开始；后续显示检查疑似版本，时间片期间出现等待重新尝试 | 同一 run 持续推进；无重发 |
| 15:23:08 暂停快照 | “检查已暂停”；“本轮疑似版本比较已达上限，继续后会接着检查。”；提供“继续检查” | `PAUSED/PENDING`，round 1、start 0、waiting true，compared 200000、reused 0 |
| 15:23:42 刷新快照 | 刷新并等待 15 秒，界面仍为相同预算暂停；当前没有可确认删除的结果 | 同一 run、同一轮及 200000，未自动加额 |
| 15:25:25 Worker 重启后快照 | 主线程停止旧隔离 Worker 并以同一构建重启；浏览器再刷新并等待 15 秒，仍为预算暂停 | 同一 run、`PAUSED/PENDING`、round 1、start 0、waiting true、200000 |
| 随后继续 | 仅点击一次现有“继续检查”，先显示等待开始，随后继续后台检查 | 中途核对 round 2、start 200000、compared 236550，累计未清零 |
| 15:37:43 完成快照 | “没有找到重复作品”；“疑似版本检查已完成，仍可能有遗漏，请逐张核对。” | `COMPLETED/COMPLETE`、stage DONE，round 2、start 200000、waiting false、compared 240000、reused 0、visualPairs 0、groupCount 0 |

最终数据库命令计数只有一次 `resume`；删除 operations 为 0。比较达到 240000 后末尾反向候选仍需遍历，浏览器代理继续等待实际 COMPLETE，未将计数达到预期提前当作完成。

从页面开始时间到最终只读快照约 33 分 29 秒，包含预算等待、刷新、人工协调及 Worker 重启，且完成时点受低频观察影响；不能当作吞吐或性能基准。

## 证据与边界

证据根目录：`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-budget-20261028`。

| 证据 | 相对证据根路径 |
| --- | --- |
| 选项截图 | `browser/01-incremental-options.png` |
| 实际 20 万暂停 | `browser/02-paused-200000.png`、`browser/paused-database.json` |
| 刷新后保持 | `browser/03-refreshed-paused.png`、`browser/refreshed-database.json` |
| Worker 重启后保持 | `browser/04-after-worker-restart-paused.png`、`browser/after-worker-restart-database.json`、`browser/worker-restart.json` |
| 续行与完成 | `browser/resumed-progress-database.json`、`browser/05-completed-240000.png`、`browser/completed-database.json` |
| 样本与独立预期 | `browser-fixture/oracle.json`、`browser-fixture/verification.json`、`browser-fixture/account-auth-audit.json` |

本次只验证预制特征与当前缓存兼容的 App → Worker 控制流、预算持久性及结果收口。没有覆盖真实图片特征提取、识别准确率、NAS、真实解码吞吐、50 万规模、结构性硬上限、删除流程、重复继续的并发竞争、进程运行中中断或旧 v5 兼容；这些不能由本次浏览器通过推断。本次未运行全量 App 测试或构建，代码检查由主线程汇总。

记录交付检查：`pnpm docs:check` 通过（307 篇）；默认图示检查因缺少 Playwright headless shell 无法启动，改用已安装 Chrome 并提升权限后 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（34 个图源、23 个内嵌 Mermaid）。主应用路径大写检查无输出，`git diff --check` 通过。
