---
status: record
scope: B2 DIRECT_DELETE 后端独立有界审查及 P2-01 修复差异复审
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-direct-delete-batch2-2026-10-24.md
  - docs/design/artwork-deduplication/direct-delete.md
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - packages/pixishelf-db/src/artwork-dedup-direct-delete.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/direct-delete.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
  - packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-direct-delete.postgres.test.ts
  - packages/pixishelf-db/prisma/migrations/20261024001800_artwork_dedup_maintenance_v2/migration.sql
---

# 第二批独立审查

**B2 通过：P2-01 已修复并经本记录末尾的限定差异复审关闭，没有剩余 B2 阻断项。**初审未发现已确认的 P1、扩大删除范围或越过独立能力门禁的缺陷。第三批 UI、最终全量检查与浏览器验收仍未实施；独立删除 gate 继续为 false，本结论不授权开放能力或自动继续第三批。

## 版本、环境与范围

审查日期 2026-10-24，模型 GPT-6.1 Sol / xhigh。工作树为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c` 加冻结时既存 WIP。已阅读 AGENTS、文档权威/维护/测试规则、产品与权限/恢复边界、直接删除及文件契约，以及完整 [B2 实施冻结记录](./artwork-deduplication-direct-delete-batch2-2026-10-24.md)的核心、DD07 和 Sol 接线三节。

以静态审查为主，复用冻结记录逐项登记的测试与类型检查；未重跑领域测试、全量 lint/test/build、B1 或 50 万样本。未连接业务库、真实媒体或用户 5430，未启动 App/Worker，未提交/修改生产代码。本次唯一仓库写入为此审查记录。未执行旧移动/rename 探针，亦不声称此前受平台阻断的旧移动基础检查已经通过。

## P2-01：PREPARE 控制收据未先于 Worker 检查和当前模式分派重放

**初审代码缺陷，现已关闭；下述位置与行为保留初审时语境，修复依据见末尾差异复审。**初审位置：`packages/pixishelf/services/artwork-dedup-review-service.ts:691–725`，以及同文件 `773–782`；DB 的严格动作对比位于 `packages/pixishelf-db/src/artwork-dedup-direct-delete.ts:53–66`。

触发条件均为新 `preparePurpose=DIRECT_DELETE` 的 PREPARE 已失败、满足 retry 条件，调用 `retryOperation` 已成功并持久化 `action=RETRY_OPERATION` 的命令收据：

1. 随后 v2 Worker 离线或心跳过期，客户端以原幂等键和原规范输入重放。服务在 713 行无 replay 参数调用 `assertDirectDeleteWorker`，早于 715–725 行的既有命令检查，返回 PRECONDITION_FAILED，无法返回已经创建的同一意图。此时不需要新任务。
2. 重试后的 PREPARE 完成 READY，接着同一 operation 经确认进入 DIRECT_DELETE。再重放原 `retryOperation` 输入时，691 行先按当前 mode 分派至 `retryArtworkDedupDirectDelete`；后者期待 `RETRY_DIRECT_DELETE`，而既有收据是 `RETRY_OPERATION`，于是同键同输入返回 IDEMPOTENCY_CONFLICT。旧 expectedVersion 本应由已存在的收据处理。

影响：响应丢失或客户端重试时，已成功的控制被报告为失败；当前实现不满足既有规范命令可重放、Worker 后续离线也不应妨碍已有意图重放的 B2 契约。本问题未造成第二个任务或文件扩围，故定为 P2。

最小修复：在当前 Session/expectedUserId 和适用的独立 gate 校验后，以原收据的动作、operationId 和规范输入验证控制重放，再按当前 operation mode 执行新命令；只有确实要新入队的命令才核对 Worker 能力。不能仅把 713 行改成可跳过 Worker 检查而遗漏跨模式重放，也不能把同键异输入一并当成成功。

本次结论来自可确定的分支/收据对照，未冒称已运行复现测试。现有 App 用例只在 311–313 行覆盖新 PREPARE 请求及 directDelete 确认的离线重放；没有上述 PREPARE retry 收据的两种重放条件。

## 已核对的 B2 边界

| 边界 | 审查结果与证据范围 |
| --- | --- |
| 新授权、冻结范围 | DB `artwork-dedup-direct-delete.ts:29–149` 核对新目的/协议、Session 操作者、版本、scopeDigest、确认与幂等；摘要覆盖所有冻结组、成员/整理/来源签名、精确文件身份和来源代次。`artwork-dedup-review.ts:234–267` 与 016 impact 函数覆盖标题、标签、系列、海报和章节预览指针，阅读活动不进入整理签名。旧 ISOLATION/PURGE 和 NULL 授权不能直接升级；新 API 与 dispatcher 使用真实 false gate。 |
| 全组 fresh、分页、重试 | `direct-delete-verification.ts:126–242` 逐文件绕缓存读取并提交游标；正常 yield 保留执行版本与 FRESH 游标，故障 retry 重开 FRESH。`artwork-dedup-direct-delete.ts:215–240` 检查全部组 fresh、完整成员、ownership、来源/整理快照后才隐藏 COPY；`artwork-dedup-operation.ts:420–466` 在首 intent 再验当前执行与屏障。冻结后的附件、keeper/内容/身份变化不能接纳为新授权。 |
| 四来源、物理原件 | 冻结记录的四同种来源、全部六对混合来源与追加 7 项矩阵，对应 core 测试的真实原媒体集合；动画测试逐项登记 APNG/MP4/WebP，额外重复次数使新检测不成组。`artwork-dedup-operation.ts:248–339` 阻断多个/非当前归档 revision；PREPARE/ownership 不把未知附件、共享路径或未验证历史原件加入删除。LOCAL_CREATED 不生成伪造 PROVIDER。 |
| Claim、drain 与 reader | 双角色 Claim/HOLD、旧执行退出原语沿 B1 已通过边界；B2 executor `direct-delete.ts:57–94,190–229` 请求持久停止、未 drain 则让出 writer，不用任务 FAILED、失租约或 kill 请求充当退出。reader 接管继续先证明旧 reader 退出；未确认 close 保留 token 和保护。B2 queued-stop 用例只证明其登记范围，不外推成重做孤儿活进程矩阵。 |
| 精确 unlink 与持久回执 | `maintenance-files.ts:183–217,383–405` 从核验根逐段固定父 fd；native `artwork-dedup-rename.c:137–172` 再验普通文件/dev/inode/大小/纳秒时间/nlink 后精确 unlink、fsync，无 rename/rmdir 回退。DD07 的独立临时编译 syscall 夹具实际包装生产主体，断言真实 unlink 后 fsync EIO、缺失重放仍须再次同步、父替换保留新占用和根外，证据为 7/7，非旧 UNLINKED 回调的替代说法。POSIX 同父 fd 内 fstatat/unlinkat 无 inode CAS，仍依赖持续外部停写前提。 |
| intent 续行与停止 | `direct-delete.ts:154–181` 是先 intent 事务、再当前 fence、再 IPC、再回执；未决 intent 的缺失重放保留同 file/version 身份，不能扩大范围或吞新占用。首 intent 前取消核实 reader/零意图并恢复可见性、release；之后 STOPPED 保留隐藏、Claim/HOLD，retry 只续原范围并 fresh 验 keeper。首 intent 回滚、失 lease 零 unlink、最终 DB 提交失败保持业务行/HOLD 的分批专项与实现相符。 |
| 业务删除、墓碑与隐私 | `artwork-dedup-direct-delete.ts:339–415` 全部文件回执后才同事务删除业务行、建立 TOMBSTONE、释放 Claim；COPY 使用 deletedAt 且保持 ACTIVE。冻结行/来源/receipt 没有业务 Artwork/Image 级联 FK，receipt/source 对操作使用 RESTRICT；四来源执行及最终提交回滚专项证明实际业务删除路径。评分/阅读按 Artwork 级联，MediaMark 显式删除，未写入 keeper 合并。App 只查询当前账户个人行，其他账户只给资格布尔；普通 archive trash 排除 ACTIVE+deletedAt。 |
| 墓碑与新意图 | allowReimport 核对 DELETED COPY、选定 sourceId/generation、原 owner；复用根协调锁下双向 overlap generation 原语。App 的实际 local rescan/publisher 证据先被墓碑拒绝，释放后旧 proof 仍拒绝，新文件加新持久输入/新 proof 才能发布；未冒称恢复媒体或完整重跑目录发现。 |
| API、迁移与 Worker | 实际 `authProcedure` 从 `ctx.user.id` 重建 userId，路由不接权威操作者；匿名/账户切换与 literal false 负例对到实际 procedure/schema。v1/v2 严格 parser、共享 supervisor 与 queue capability 版本过滤一致；v1 PREPARE 指向新目的在 DB 读取后拒绝。015–018 是正式增量；017 拒绝新协议 SQL NULL，018 的严格 v2 JSON 分支以 coalesce(false) 拒绝 UNKNOWN/JSON null，保留 SCAN/v1 调度约束。冻结记录登记两库各 26 项及 115 迁移状态，非空旧 READY 保持 NULL 语义。 |

冻结记录的分批 core 23、native 7、普通矩阵 7、App 流程、contracts/Worker/约束检查分别只支撑其具体断言；本审查没有把数量合并成安全证明，也没有把跳过或早期失败记为通过。

## 初审要求的 B2 补证与第三批责任

初审要求针对 P2-01 补以下两项最小 App/PG 控制回归并差异复审，现均已完成：新目的 PREPARE retry 成功后 Worker 离线的原键重放；同一次 retry 成功后操作进入 DIRECT_DELETE 的原键重放。两项均应断言返回同一 operation/当前 job，不新增 job/command，且同键异输入仍冲突。所改控制分支完成必要类型与定向 lint 即可，无需重跑已冻结的 native、B1、四来源或规模套件。

第三批负责正式检查结果/删除记录 UI、一次确认和停写声明、停止/部分失败/原范围重试交互、真实账户/Cookie/浏览器与桌面手机/键盘状态，以及计划要求的最终一次全量检查和开放决定。尚未接新按钮不属于本次 B2 缺陷；B2 修复后也不能直接开启 gate。

恢复依据沿用冻结记录里的专库 dump/正式增量/限定恢复证据，包含 `SET transaction_timeout=0` 的已登记兼容警告。本审查没有另做恢复，不把合成专库证据当作生产完整备份或媒体同点恢复演练。

## P2-01 修复差异复审与关闭

2026-10-24，由原独立 reviewer、GPT-6.1 Sol / xhigh 复审。仅核对本项修改的 service、DB helper、新增聚焦测试，以及实施记录最新「P2-01 控制收据差异修复」节与必要调用点；未重开 B1、native、四来源、迁移或全仓审查。没有修改生产代码或重新运行测试；静态核验与登记的专项结果足以关闭本项。

- `packages/pixishelf/services/artwork-dedup-review-service.ts:692–730` 先校验 Session/expectedUserId、独立 gate、新目的严格输入及归属，再按 actor→command 锁序读原收据。重放匹配原 action、operationId、expectedVersion 和规范摘要；原 PREPARE 控制不会因当前 mode 变化被重新解释。DIRECT_DELETE 自身控制仍按原 DB 输入（含 Session userId）计算摘要。成功重放仅查询当前操作/job 与投影；Worker 能力及新模式分派在 732–748 行后才发生。故离线和跨 PREPARE→DIRECT_DELETE 两个原触发条件均被修正，同键异输入/异动作仍拒绝。
- `packages/pixishelf-db/src/artwork-dedup-operation-reader-recovery.ts:25–49` 补齐新目的 PREPARE 的首次 retry 可达性：只有 operation 协议1、维护 job 定义2、payload 目的 DIRECT_DELETE/协议1才匹配；ISOLATION 继续明确要求 v1。共用的 mode/originalAction、reader IDLE/token 空、job 归属/执行版本、租约及 FAILED/PAUSED 条件保持，不把终态当成 reader 退出证明，也没有改离线恢复主体。此遗漏由真实 API 补测暴露，属于本控制修复的相关边界，现已收口。
- `packages/pixishelf/services/__tests__/artwork-dedup-direct-delete.postgres.test.ts:92–167` 通过真实 API 创建新目的 PREPARE、真实 queue fail 与 API retry 产生收据，未伪造命令。离线时原键返回同一操作/job/执行版本；实际 PREPARE 完成并经 API 授权 DIRECT_DELETE 后，原键返回当前 job/版本。两处都有 job/command 数量不变及同键异输入拒绝断言，另验异动作、新键离线能力限制、恢复 Worker 后旧版本限制，以及 helper 新协议负例和旧 v1 保留；未执行删除文件。

实施记录登记该聚焦命令 **1 通过、3 跳过**，DB/App 类型通过、三文件定向 lint 0 warning/0 error。此处沿用实施者已执行的结果，未将跳过计为通过、未声称 reviewer 另跑一轮。合成专库 Image 保持570、操作/命令/Claim/job/lease/worker 清理及进程无残留同样只引用实施记录的只读核对。

**P2-01 关闭，B2 达到本批门槛。**没有新增需修复的 P1/P2 或必须补的 B2 专项证据。原审查已登记的 POSIX 持续外部停写前提、旧移动检查未通过状态和生产恢复证据边界继续有效。独立 gate=false、stage3 保持；后续由主任务统一做最终一次文档检查并按批次暂停。

## 本记录检查

初审记录写入时，`pnpm docs:check` 通过，检查 254 份 Markdown；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 使用已有 Chrome，通过 33 份图源及 23 段嵌入 Mermaid。`git diff --check` 通过；主应用大写路径检查为 0 匹配。本轮未改图源、未安装浏览器；上述检查不构成第三批产品浏览器验收。

本次修复差异复审未重复 docs/diagrams 检查；最终文档检查由主任务统一执行。
