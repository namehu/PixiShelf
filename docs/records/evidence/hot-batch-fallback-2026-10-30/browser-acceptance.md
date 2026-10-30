---
status: historical
scope: 2026-10-30 v9 热批回退修复最小隔离桌面验收
last-verified: 2026-10-30
sources:
  - docs/records/evidence/hot-batch-fallback-2026-10-30/browser-run-audit.json
  - docs/records/evidence/hot-batch-fallback-2026-10-30/browser-process-cleanup.json
---

# 最小桌面验收

唯一 after A/B 计时完成、获得统筹明确 GO 后执行；没有占用性能测量窗口。真实桌面 Chrome 由 CUA 点击、刷新和操作，未用 API 代替用户动作。仅访问新隔离 App 5504（入口 `/admin/duplicates?artistId=1&entry=direct`，应用随后规范化 URL），Worker 健康端口 55844；没有操作生产或用户服务。

从已静默的 `dedup_hot_fallback_after_20261030` 模板克隆新库 `dedup_hot_fallback_browser_20261030`，未改 A/B 库、未断开他人连接。复用相同 2,000 张合成原件的只读根，使用独立派生/临时/日志目录。Worker 从本轮 `after-final-source` 构建，核心文件与已测实现一致；App 使用本轮 worktree。账号和运行环境只存仓库外私有文件，未复制凭据。首次 App 环境缺少包级依赖，按同锁既有依赖补齐后可正常操作；没有改功能代码或锁文件。

为使快检暂停可观察，仅在新 browser 库添加临时 `browser_acceptance_delay` trigger：RUNNING 原件计数递增的 UPDATE 等待 4 秒。暂停与继续仍由 UI 完成；人工等待、暂停以及本轮运行耗时均不作性能数据。继续后已移除 trigger/function，末次只读查询确认剩余 trigger 为 0。未改原件或功能实现。

| 检查 | 实际可见结果 | 结论 |
| --- | --- | --- |
| 快速检查与刷新 | 点击“重新检查”，新 run `eb3018d3-9370-4c31-ad25-bb7e218f704b`；刷新保留同一 run，显示“正在核对原件”与进度 | 通过 |
| 暂停与刷新 | 点击“暂停”，先见“正在暂停检查”；刷新后同一 run 显示“检查已暂停”“已处理 1,000 项原件” | 通过 |
| 继续与完成 | 点击“继续检查”，见“等待后台调度，将自动继续”；同一 run 最终显示“找到 25 组待处理作品” | 通过 |
| 详情与结果可打开 | 检查详情显示“本次检查 50 部作品 · 快速检查”；点击第一组“比较作品”打开结果弹窗，列出合成 A/B 两部作品，关闭正常 | 通过 |

[有界只读审计](browser-run-audit.json)补充确认：任务 definitionVersion 9、attempt 2，COMPLETED/DONE；50/50 部作品、2,000 项 stat/cache、哈希 0、读取 0、4 个成功热批、25 组。未请求视觉，因此未观测视觉计数保留 null，不宣称为 0。这个暂停续跑的 UI 运行不代替串行 A/B，也不声称完成整轮关系复制；UI 默认快速检查选项与模板的疑似版本运行不同。

没有勾选删除、没有改变保留项或执行媒体删除。本轮源码无 UI 改动，未重复图片对照/删除流程、生产、NAS、移动端或全量测试。

完成后 active jobs 为 0。只停止本轮自建 App PID/PGID 2959 和 Worker PID/PGID 2960；两进程及进程组均退出，5504/55844 无监听，见[退出证据](browser-process-cleanup.json)。启动失败的早期自有进程组也已正常退出，私有日志保留仓库外。未停止或修改用户服务。

## 截图

- [暂停中的原件进度](browser/01-pausing-progress.png)
- [刷新后已暂停，1,000 项原件](browser/02-paused-after-refresh.png)
- [同一 run 完成，25 组](browser/03-completed-25-groups.png)
- [检查详情：50 部作品、快速检查](browser/04-completed-details.png)
- [结果弹窗可打开](browser/05-result-open.png)

原始截图和自有进程日志位于仓库外 `/private/tmp/pixishelf-hot-fallback-20261030/browser/evidence/`；仓库内仅保存合成截图和脱敏审计。未提交或发布。
