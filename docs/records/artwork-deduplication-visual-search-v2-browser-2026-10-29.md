---
status: historical
scope: 视觉检索 v2 隔离桌面浏览器验收
last-verified: 2026-10-29
sources:
  - docs/design/artwork-deduplication/visual-search-v2.md
---

# 视觉检索 v2 浏览器验收（2026-10-29）

本记录适用于 `codex/dedup-visual-search-v2` 开发工作区（基线 `3a5b5ee2` 加本轮未提交实现），使用 GPT-6.1 Sol / medium 和桌面浏览器；首轮为 IAB（1280 × 720），调度修复复验时 IAB 连接已不可用，改用专用 Chrome 标签。仅访问独立应用 5498 端口（127.0.0.1 导航被应用重定向为同端口 localhost），数据库 `dedup_v2_browser_20261029`，测试媒体为隔离合成库。直连导航带 `entry=direct`。账户凭据只保存在临时私有 manifest，未写入此记录。

## 第一段：阶段展示样本，只读

这些是明确标示“非实际运行”的持久快照，由隔离脚本预置，验收时 Worker 未启动。没有对展示样本暂停、继续、取消或删除；不能将这些画面作为实际执行或重启续跑证据。所有旧 `SystemJob.progress` 均预置 99，以检验 UI 不误用整体数字。

| 样本                                               | 浏览器观察                                                                                                                                                  | 结果         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| half：原件 53/53，视觉 2702/5624                   | 任务中心执行动态、任务详情、去重检查页均显示“正在比较图片 · 2,702 / 5,624”（检查页标题与数量分行）；AX 阶段进度 48.044%，没有 99%；检查页刷新保持一致       | 通过         |
| scheduler：run RUNNING，job RETRY_WAIT + SCHEDULER | 首轮缺少自动继续提示；修复后重新登录并刷新，标题“等待继续检查”，说明“等待后台调度，将自动继续。”，下方“正在比较图片 · 2,702 / 5,624”和 48.044% 阶段进度保留 | 修复复验通过 |
| unknown：PAIR，null/null                           | 检查已暂停，显示“正在检查作品关系”，进度条无数值，没有 99%                                                                                                  | 通过         |
| zero：ORIGINALS，0/0                               | 检查已暂停，显示“正在核对原件”，进度条无数值，没有除零或 99%                                                                                                | 通过         |
| legacy：无 progressData                            | 检查已暂停，显示“正在检查疑似版本”，无百分比或误导进度条                                                                                                    | 通过         |

已归档截图：

- [01-progress-task-center.jpg](./evidence/visual-search-v2/01-progress-task-center.jpg)
- [02-progress-task-detail.jpg](./evidence/visual-search-v2/02-progress-task-detail.jpg)
- [03-progress-check-page.jpg](./evidence/visual-search-v2/03-progress-check-page.jpg)
- [04-progress-scheduler-missing-wait.jpg](./evidence/visual-search-v2/04-progress-scheduler-missing-wait.jpg)（首轮问题现场）
- [04-progress-scheduler-fixed.jpg](./evidence/visual-search-v2/04-progress-scheduler-fixed.jpg)（修复后）

首次任务中心加载曾出现 `page.js` 的 `SyntaxError: Invalid or unexpected token`，刷新后恢复；首次去重页编译和导航多次超时，随后成功到达。开发服务器初次编译延迟不作为功能通过证据，也未因此执行全量构建。

## 图示可读性

将本轮 `architecture.svg`、`detection.svg`、`processing-limits.svg` 以 Sharp 渲染为白底 PNG 并逐图查看。标题、节点文字、连线和箭头完整，无文字截断或节点遮挡。detection 图较长、processing-limits 图较宽，在文档中需要放大或独立打开阅读细节。白底下对比度正常；SVG 为透明背景，深色背景预览的标题对比度较低，不将透明 PNG 黑色预览作为文档白底缺陷。临时 PNG 仅供本次 QA，未修改 SVG 或图源。

## 第二段：真实隔离执行

主线程取消五个展示任务并启动隔离 Worker 后执行。真实流程仅使用 artistId 1 的合成 A/B/C。两次均为快速检查、明确勾选“检查疑似版本”，没有选择逐一重查。

| 运行         | runId                                  | 浏览器结果                                                                   |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------- |
| 首次         | `0de9efaf-de76-4515-ba92-b4fb222512d9` | 检查完成，有未检查项；A/B 配对 4，左未配对 0 / 右未配对 1，未核对左 1 / 右 1 |
| 同输入热复验 | `39aca713-9f66-415b-8a77-4d407e46137c` | 同样结果；使用此轮继续图片对照与删除确认                                     |

主线程另行核对日志，确认热复验读取字节、解码、索引、候选、精比为零并复用一条关系；这是主线程日志证据，不是由浏览器画面推导。

图片对照逐页核对：已配对第 2、3、4 张均显示“原文件相同”；第 5 张显示“图片相似，请核对差异”，可见白边变化。未配对筛选只有 B 第 6 张，A 无对应图片。未核对筛选分别列出 A/B 第 1 项，明确说明“此项未参与图片比较，请打开作品核对原件”和“未核对项目，不能据此判断两个版本的内容是否相同”。未将动画当成已匹配。

选中保留 A 后进入删除确认，operationId 为 `41f1c700-b97d-4187-b37f-8af3e9b3d828`。处理范围仅 A 保留、B 待删除；确认文案明确永久删除另一部的全部文件与整理记录，并包含未配对、未核对原媒体。三个确认复选框均勾选。

首次点击“永久删除 1 部副本”被自动审批拒绝，理由为不可逆永久删除即使预授权仍需行动时即时确认；没有绕过或改用其他执行方式。主线程向用户说明精确环境、操作单号和 B 的 6 原件范围后，用户即时回复“确认，仅删除本轮合成 B”。

收到此确认后，重新读取原 Chrome 确认页，核对 operationId 未变、A 保留且仅 B 待删除，再点击最终按钮。本次提交成功。后台先显示“已删除 0 部，尚有 1 部未完成”，随后显示“删除完成 / 已删除所选版本，另一个版本已保留”。刷新清单明确 A 保留，B 为“已登记 6 项原媒体 · 未配对 1 项 · 未核对 1 项 已删除”；删除记录汇总“已删除 1 部，保留 1 部”。

返回 artist1 列表，可见作品总量 2，全部卡片只有 A（4 静图 + 1 动图）与 C（5 静图），B 已消失。浏览器流程通过；数据库、六原件物理删除及 A/C 哈希保留由主线程另行审计，不能仅凭列表证明文件系统状态。

真实流程证据：

- [05-real-image-comparison.jpg](./evidence/visual-search-v2/05-real-image-comparison.jpg)：白边变化图片对照与整体配对计数。
- [06-real-delete-confirmation.jpg](./evidence/visual-search-v2/06-real-delete-confirmation.jpg)：A 保留、B 待删除与整部删除说明。
- [07-real-delete-blocked.jpg](./evidence/visual-search-v2/07-real-delete-blocked.jpg)：三个确认框已勾选，首次删除动作被审批拦截后的现场。
- [08-real-delete-completed.jpg](./evidence/visual-search-v2/08-real-delete-completed.jpg)：即时确认后 B 六项原媒体已删除，A 保留。
- [09-real-retained-a-c.jpg](./evidence/visual-search-v2/09-real-retained-a-c.jpg)：删除后完整列表仅 A/C 两部。

## 浏览响应与限制

恢复前浏览器导航到 artist1 多次超时，页面持续 Rendering；主线程确认 App 请求也无响应后，只重启本轮 App，数据库、媒体和 Worker 不变。恢复后两次小样本检查完成正常；第二轮切到列表时检查已经完成，未获得持续计算期间的有效并发浏览样本。艺术家列表初次打开有开发编译等待，刷新后正常展示完整 A/B/C，未观察到持续阻塞；没有采集可复核延迟数据，因此不报告毫秒响应或生产性能结论。

未运行额外全量测试或构建。第一段的展示快照与第二段真实运行分开记录；最终删除在即时确认后完成，无浏览器阻塞剩余；原审批拒绝保留为过程证据。

主线程已完成[数据库与文件只读审计](./evidence/visual-search-v2/browser-db-audit.json)：操作DELETED/DONE，verifiedFiles=11、deletedFiles=6；数据库只保留A1/C3，B2六个文件均不存在，A/C十个文件均与创建时SHA-256一致。
