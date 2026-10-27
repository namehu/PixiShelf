---
status: historical
scope: F03 第三批 SQL 归因、有界批处理及运行中恢复验收记录
last-verified: 2026-10-27
sources:
  - ../design/artwork-deduplication/visual-batches-f03-contract.md
  - ../../packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
---

# F03 第三批：SQL 归因与有界批处理

## 基线与范围

工作区为独立 `codex/dedup-visual-batches-f03`，起点 `b4943c80`，开工时干净。主目录 `main` 为 `261993af` 且干净，本批不合并、升级开发库或重启用户服务。用户授权先归因、再优化，保留必要安全检查，使用同样本 A/B，补运行中暂停及 Worker 重启续跑，验收提交后暂停。

设计边界见[第三批契约](../design/artwork-deduplication/visual-batches-f03-contract.md#query-batching-f03)。代码实施 Astra / high；独立审查 Sol 6.1 / xhigh；浏览器 Sol 6.1 / medium。测试仅用合成数据与独立 PostgreSQL；本批无真实图库写入或实际删除。

## 测量与实现

前置探针为 120 条预制特征、两个作品：共 4,792 条 SQL，QUERY 为 4,572 条（95.4%）；262 笔事务中 242 笔属于 QUERY。QUERY 事务 wall 合计 2,873 ms，内核总耗时 3,235 ms。QUERY 中目录状态 SELECT／INSERT 各 720 条，run 锁／读取 724 条，事务控制 484 条；主要优化对象是逐查询重复的提交校验和结果写入。

SQL 耗时来自 Prisma query event，QUERY 合计 131 ms，其中 posting 121 ms。大量单语句值被计为整数零毫秒，不能据此推断真实成本为零，也不能把相加结果当作端到端耗时。阶段按事务首次读取的 run 检查点归属，首次准备与 INDEX 共用标签；少量延迟到达的事务控制事件可能归到下一阶段，因此阶段分布用于归因，不能视为严格追踪。全局 SQL／事务总数与 profile 合计相符。

固定方案为每批最多 8 个查询、50 个候选槽和 51 部作品，组装在查询之间遵守 100 ms 软预算；比较在事务外，提交一次完整校验并原子保存前缀。详细异常、预算、旧检查点和锁序约束只维护在契约中，不改共享数据库 helper、其他阶段或公开上限。

10,001 条完整基线已完成，生产源码 SHA-256 在载入前固定为 `d422096c91ad292fd4ad96b2fd7516b603efdaf2f42dbf94212243b768567a06`，对应 `b4943c80`。内核 419,456 ms、381,105 条 SQL、20,042 笔事务、70,530 条写语句；QUERY 为 380,076 条 SQL（99.73%）、20,004 笔事务，事务 wall 合计约 403.1 秒。

| 基线 QUERY 操作                | SQL 次数 |
| ------------------------------ | -------: |
| 目录状态 SELECT／INSERT        |  120,012 |
| run 锁／读取                   |   60,010 |
| BEGIN／COMMIT                  |   40,008 |
| 媒体与 item 联合范围查询       |   40,005 |
| item 读取                      |   30,003 |
| posting 查询                   |   10,001 |
| 候选对查询（含总数及单对读取） |   10,002 |
| run 更新（包括游标与计数）     |   10,002 |

以上为归一化主表归类，未列全部语句；写语句包含目录锁 helper 的 `INSERT … ON CONFLICT DO NOTHING`，不等于实际插入行数。完整基线 QUERY 的 Prisma event duration 合计 80,395 ms，其中范围内目录 DISTINCT 查询约 45,865 ms、根 DISTINCT 查询约 23,646 ms，两者约占 86.5%；posting 查询仅约 1,969 ms。因此选择跨查询共享完整 guard，同时减少往返和重复范围扫描，而非修改匹配算法或共享目录 helper。

两轮使用同一 run、媒体 ID、原 SHA、预制特征和目录／来源快照。基线完成后保留 fixture，优化版先核对摘要，只重置该 run 工作数据；测量完成才清理自己的合成 fixture。会改动根身份的故障用例使用另一隔离库，避免污染 A/B。原输入摘要扩展包含 live Image／Artwork／contentSource，前后均为 `1002f25e673cefffbc1456b104b3c5705ebf15ef42eeb92ae0f2b39dca24f083`；完整结果摘要均为 `68d295a3e7117e80d83327170db2ff977ff76325fdbd7d4b1b58ccda55d6a189`。

| 指标                       |   基线 `b4943c80` |          本批优化 |                       变化 |
| -------------------------- | ----------------: | ----------------: | -------------------------: |
| SQL 次数                   |           381,105 |            63,285 |                    −83.39% |
| 事务次数                   |            20,042 |             2,942 |                    −85.32% |
| 写语句次数                 |            70,530 |            10,680 |                    −84.86% |
| 内核耗时                   |        419,456 ms |        111,205 ms |               单次 −73.49% |
| 实际候选比较               |            27,536 |            27,536 |                       不变 |
| posting 条目               |           400,040 |           400,040 |                       不变 |
| 候选／发布作品对           |              1／1 |              1／1 |                       不变 |
| 单次媒体 findMany 最大行数 |             1,000 |             1,000 | 包含 INDEX，不能当批总内存 |
| 采样 heap 峰值             | 117,130,080 bytes | 113,754,136 bytes |           不作内存改善结论 |
| 进程 max RSS               | 312,344,576 bytes | 325,959,680 bytes |           不作内存改善结论 |

优化后 QUERY 的目录状态 SELECT／INSERT 分别从 60,006 降至 8,706，候选对查询从 10,002 降至 2；posting 查询仍为 10,001 次，原每查询预算没有省略。QUERY 事务 wall 合计约 403.1 → 98.0 秒，最大约 229.5 → 233.8 ms；100 ms 是组装时在查询之间检查的软边界，不是单 SQL 或完整提交事务硬超时。

生产文件 SHA-256 为 `779d1f831509f96b50e482931eaa5bfe132d4f0711f0349ec4f460e0660edcbf`，测量与独立审查一致。优化版动态观测查询特征最多 8 条、候选特征最多 50 条、两者总计最多 58 条；本样本 guard 最多 11 部作品，51 部边界另由定向用例覆盖。优化版比基线额外增加纯内存上界计量，无额外 SQL，其开销仍计入本次耗时。

这是一次先基线后优化的顺序测量，未控制 PostgreSQL／OS 缓存与 GC；SQL 减量和完整结果等价是主要证据，耗时不作稳定 SLA。两轮为分进程执行，max RSS 包含 Prisma、测试与准备开销，不证明产品内存下降。内核计时排除 fixture 准备、摘要查询、工作态重置与最终清理；原媒体读取／解码均为零，不代表 NAS 或真实图片性能。公开视觉上限保持 10,000，本批不运行 10 万／50 万。

## 验收与证据

定向验证完成：15 个不同 core 用例，覆盖旧检查点、分组回滚、立即让行、51 部作品截断、posting／candidate／comparison／pair 预算的合法前缀、取消及来源／目录／声明变化；4 个真实执行器用例覆盖冷／热／改单图／FULL、QUERY 读后实际租约 token 变化、PUBLISH 租约到期及目录变化。QUERY 租约 token 失效时游标、边和计数均未提交，不把它称为 QUERY 自然到期测试。executor typecheck 通过。

早期专项有测试夹具的复合唯一键错误、posting multiplicity 约束错误，修正夹具后仅重跑相关失败用例，保留原失败日志；生产文件未因此改动。最终 15 项按三个日志去重统计，不把含早期失败的日志整体写成通过。独立审查无确证 P1/P2，记录见[本批审查](./artwork-deduplication-query-batching-f03-review-2026-10-27.md)。

`pnpm worker:build` 仅执行一次并通过，只有既有三条 CJS／`import.meta` 警告，产物用于随后浏览器验收；没有运行全量 App lint／test／build。未改迁移，无重复迁移专项；既有 App 路由类型问题未在本批混改。

桌面验收使用新库 `dedup_f03_query_browser@127.0.0.1:55432`（正式部署已有迁移）、App 5490、Worker 55829，以及独立媒体目录。样本为 18 部作品、3,030 张真实合成 PNG，19,634,176 bytes，3,030 个唯一 SHA；未预制视觉特征。浏览器显式入口带 `entry=direct`，未实际删除。

- ACTIVE 暂停：实际页面显示正在保存进度，再由正常控制进入 run/job PAUSED。已保存 QUERY `queryAfter=894/queryImageId=895/candidateAfter=2713`、56,459 次比较；刷新仍暂停，随后通过 UI 继续同一 run/job，未修改数据库状态。
- 干净重启：旧 Worker PID 96716 在 QUERY `queryAfter=1078/candidateAfter=2932`、64,959 次比较时收到 SIGTERM；drain 后提交到 `queryAfter=1144/candidateAfter=1507`、67,820 次比较，run/job 自然进入 RETRY_WAIT、租约清空。新 PID 99142 接手同一个 run `9772c646-2b71-4c32-89f1-d3002d1dcc8a` 和 job `7f6f5fa8-52d8-4b6a-b468-428430ddc111`，继续到 QUERY 1392、77,969 次比较。未强杀，也未等待租约超时回收；不能将该证据称为崩溃／断电恢复。
- 早期测试协调中出现两次 409 状态冲突、一次 SIGSTOP 持锁导致的请求失败，未作为通过证据。最终正常运行下的 UI 暂停成功；信号协调、早期冲突和最终成功路径分别保留，不宣称全程无错误。

中断恢复轮与同输入 FULL 复查均完成到 COMPLETED／DONE，均为 107,896 次比较、0 次关系复用，14 行候选工作记录的全部匹配边及证据、12 页发布明细逐项一致，完整图片配对证据摘要同为 `526db816461000f445066841d949e544dd8e9cef52815d7bbf784a7f55fc7600`；均只有 A/B 一组、8 张 SIMILAR、双方各 2 张未配对。两轮实际各读取 39,268,352 bytes、哈希 3,030 个原件，FULL 确实重新读取计算；该恢复验收不是性能 A/B。3,030 张媒体均存在且 SHA 未变，18 部作品保留，无删除操作记录。主 agent 查看了刷新后暂停和恢复完成的实际截图。

浏览器证据另存于同级 `dedup-f03-query-browser-20261027/`，含前后进度、暂停、新旧 PID、完整结果和媒体审计、截图及 HTTP 控制结果。本次只覆盖正常 SIGTERM drain 后重启，不覆盖强杀、断电、真实 NAS、并发下载或手机；不重复验删除流程。

## 持久证据与复现

非凭据测量证据位于 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-query-batching-20261027/`：包含基线源码、`baseline.json`／`optimized.json` 归一化 SQL、完整结果摘要、原始通过和失败日志、`metrics.json`、实施验证说明及无凭据 `run-profile.mjs`。没有复制私有连接配置。

本机复现脚本 `/private/tmp/f03-query-groups/run-profile.mjs` 提供 `probe / baseline / optimized`，固定生产源码 SHA、沿用专用隔离连接；不能将连接目标换成开发或生产库。基线模式保留合成 fixture，优化模式核对同一输入、仅重置其工作状态，成功完成后清理该 fixture。临时 wrapper 不是长期依赖；可由提交的测试、Git 基线与正式迁移后的独立测试库重建环境。阶段统计的实现位于测试目录，生产不记录逐 SQL 日志。

## 收口

代码、定向测试、独立审查、同样本性能对比及桌面恢复验收已完成。文档检查通过 292 个 Markdown；默认图示检查因缺少 Playwright headless shell 未运行，随后用已安装 Chrome 检查通过 33 个图源／23 个内嵌 Mermaid，未下载浏览器、未改图源或重生成 SVG。App 路径大小写和 Git whitespace 检查通过。

自建 App PID 96323 与新 Worker PID 99142 已停止，5490／55829 无监听；旧 Worker PID 96716 已在重启验收中退出。专项测试与压测进程已退出，A/B 合成 fixture 已清理。主目录仍为 `261993af` 且干净，真实开发库和用户服务未动。提交后暂停，不自动合并主目录或升级开发环境；本批无新增迁移，F03 前批迁移仍随将来的整体合入处理。
