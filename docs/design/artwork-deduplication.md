---
status: historical
scope: 2026-10-24 精确去重与直接删除三批实施基线；当前边界以功能规格为准
last-verified: 2026-10-24
sources:
  - docs/product/product-baseline.md
  - docs/security/access-control.md
  - docs/operations/backup-and-recovery.md
  - docs/records/artwork-deduplication-direct-delete-batch3-2026-10-24.md
  - packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts
---

# 同艺术家作品去重：总计划

本文保留 **2026-10-24 的精确去重与直接删除实施基线**。当前四类关系、缓存、处理上限及六张图统一见[功能规格](../features/artwork-deduplication.md)；包含、部分重复、疑似版本和缓存优化已经实施，F03 已到第六批，剩余工作见[后续计划](./artwork-deduplication/matching-extension.md)。下文的功能范围、开关、模型分工和推进安排只代表当时，不作为当前能力或新批次的续接指令。

本文是用户于 2026-10-24 批准并按三批实施完成的开发分支方案；当前行为见[功能规格](../features/artwork-deduplication.md)，隔离验收不等于真实实例部署。新流程为：**检查 → 选择保留者 → 服务端冻结删除预览 → 一次不可恢复删除确认（含外部停写声明）→ Worker 原地逐文件永久删除 → 删除记录**。取消原隔离、移动、恢复和到期清理方案。普通 URL 归档删除继续使用现有回收行为；只有去重专用删除绕过回收。

第一批必要写保护和第二批四来源直接删除后端已完成独立审查；证据见[第一批](../records/artwork-deduplication-direct-delete-batch1-2026-10-24.md)、[第二批](../records/artwork-deduplication-direct-delete-batch2-2026-10-24.md)及其审查记录。第三批页面、独立审查、最终构建与核心浏览器已完成，现已暂停；结果和未覆盖项见[第三批交付记录](../records/artwork-deduplication-direct-delete-batch3-2026-10-24.md)。旧 `PREPARE/ISOLATION` 预览绝不能授权 `DIRECT_DELETE`；新删除由独立能力门禁控制，隔离发布候选的验证边界见下文，不能推定生产已开放。早期 WIP 和旧隔离方案的暂停记录不再作为续接安排。

## 业务定义与不变量

1. 范围为冻结时同一艺术家的有效 ArtworkArtist 关系、活动且未删除作品；运行中新增作品留待下次。归属或成员变化使旧证据过期。目标规模沿用约 1,000 部、平均每部 500 个原媒体；不扩大为全库或跨艺术家检测。
2. 精确重复指全部登记原媒体 `(大小, SHA-256)` 的排序多重集合相同，忽略文件名和顺序，保留重复次数；APNG/视频组合比较全部登记物理原件，不使用代表项、缩略图或感知哈希。缺失、不可读、零字节、变化中或零媒体作品不能形成完整证据。
3. 四种 ArtworkSource：`LOCAL_CREATED`、`PIXIV_IMPORTED`、`LOCAL_IMPORT`、`URL_ARCHIVE`，以及任意混合来源重复组均在目标范围内。来源不决定内容是否一致，也不构成整目录删除权限。来源身份和文件范围必须分别证明；本地手工作品不伪造外部来源。
4. 检测只读原件，继续复用持久哈希、完整成员快照、源代次和有围栏发布；普通检查可复用缓存，完整检查绕过内容缓存。检测结果、READY 预览和旧 ISOLATION 确认都不是永久删除授权。
5. 删除前同时认领保留者与副本、阻止新写入并终止相关执行，取得实际退出/drain 证明；只对所选组绕过缓存完整重读，**全部组的保留者和副本均校验成功后才允许首删**。取消、失租约、发出 kill 和任务终态均不等于执行退出。
6. 仅删除冻结清单中的精确文件；不移动文件，不删除整个艺术家目录，不递归清空目录，也不顺带删除空目录。共享路径、硬链接、符号链接、越界、未知附件及未参与一致性验证的归档历史原件在预览阻断该作品，不静默删除、不自动缩小已确认范围。
7. 文件先持久化删除意图，再 unlink，再持久化回执。部分失败保留冻结范围、不可见副本、声明及日志；重试重新验证保留者，只续原范围，不能恢复已删文件。取消在删除开始前有效；开始后仅在安全边界停止，不能撤销。
8. 整理数据不合并。预览明确作品、媒体、来源、章节、标题/标签/系列及评分/书签/喜欢/阅读记录的删除影响。其他账户仅投影必要保护资格，不暴露其 ID、分数、标记、数量、时间或私有阅读排序。
9. 可再发现的来源保留独立墓碑，防止重扫或迟到发布复活；墓碑不随作品删除。`allowReimport` 只显式解除选定来源并推进重叠来源代次，不恢复文件、不使旧执行有效。`LOCAL_CREATED` 只保留操作审计与必要文件证据，不制造来源身份。

相似度、部分重叠、自动导入去重、个人数据合并不在范围内。实际不可恢复操作的恢复依据是[一致备份集合](../operations/backup-and-recovery.md)，删除日志不是媒体备份。外部同步和编辑必须在确认时声明停写，并持续至该操作终结；无法满足时仅可检查和审核。

## 唯一详细规格与替代关系

| 范围               | 详细规格                                                                                                                                                                             | 本轮处理                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 指纹与缓存         | [第一阶段](./artwork-deduplication/01-fingerprints.md)、[原契约](./artwork-deduplication/phase-1-contracts.md)                                                                       | 沿用已验证设计，不重复实现                                                      |
| 后台检测与资源     | [第二阶段](./artwork-deduplication/02-detection.md)、[原契约](./artwork-deduplication/phase-2-contracts.md)                                                                          | 沿用检测、分页、reader、让行与恢复；已有 50 万检测性能不重跑                    |
| 审核与冻结预览     | [审核计划](./artwork-deduplication/03-review.md)                                                                                                                                     | 保留分页、建议、审核版本、账户隔离及 PREPARE；新目的与授权见下项                |
| 直接删除与故障续行 | [直接删除契约](./artwork-deduplication/direct-delete.md)、[文件执行契约](./artwork-deduplication/file-execution-contracts.md)                                                        | 第二批后端已验收；第三批决定候选开放                                            |
| 全写入口保护       | [声明与来源证明](./artwork-deduplication/claims-contracts.md)、[App 接线](./artwork-deduplication/app-write-guards.md)、[归档接线](./artwork-deduplication/archive-source-proofs.md) | 第一批已收口并独立审查，沿用既有证据                                            |
| 页面               | [页面设计](./artwork-deduplication/ui-design.md)、[交互原型](./artwork-deduplication/prototype.html)                                                                                 | 目标为检查结果 / 删除记录，一次删除确认；第三批接正式 UI                        |
| 旧维护方案         | [旧隔离计划](./artwork-deduplication/04-isolation.md)、[旧清理计划](./artwork-deduplication/05-purge.md)、[旧共享契约](./artwork-deduplication/phase-3-contracts.md)                 | 隔离/恢复/PURGE 授权已被替代；旧代码、测试和 records 保留为历史，不能授权新模式 |

契约包维护严格 Zod/DTO/payload；DB 包维护声明、来源、事务围栏及最终删除；Worker/Executor 执行长任务；App 只校验 Session、审核、版本和幂等并入队。执行器不引用 App 服务。沿用既有分页表、声明、逐文件日志和 reader，不新增通用锁、通用工作流或第四条 lane。

## 三批实施与暂停点

每批完成定向验证、独立审查及结果报告后暂停，等待用户明确继续。只允许一个子 agent 同时活动，不恢复自动化 80。复杂锁、删除与崩溃逻辑由 Astra / high；普通代码、文档、测试及独立审查由 GPT-6.1 Sol / xhigh；最终浏览器由 GPT-6.1 Sol / medium。历史 records 保留当时模型与结果。

| 批次                  | 必须完成的范围                                                                                                                                                                                     | 本批完成门槛                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1：设计与必要写保护   | 更新本计划、页面稿和图；修扫描隐含 creator catalog 锁倒序；收口 App 媒体/章节 WIP、归档原证明 WIP；补来源释放双向代次失效、必要写入口、URL hold 与真实 drain。只处理删除安全需要的入口，沿现有模式 | 明确入口矩阵、原事务内零写拒绝与真实 PG 并发证据；必要类型/lint；独立差异审查；文档/图检查；删除门禁保持关闭，报告后暂停      |
| 2：四来源直接删除后端 | 新 DIRECT_DELETE 目的与独立门禁；冻结预览、认领/drain/全组 fresh 校验、原地逐文件删除、业务记录删除、墓碑和 allowReimport；覆盖四来源及混合组                                                      | 逐文件/故障/崩溃/迟到发布/来源周期测试及独立审查；旧 ISOLATION 计划直接调用也拒绝；报告后暂停                                 |
| 3：UI 与最终验证      | 正式页面改为检查结果/删除记录；一次确认、停止边界、部分失败与原范围重试、明确影响及隐私；统一最终检查与浏览器回归                                                                                  | 按测试策略最终一次全量 lint/test/build 及受影响包检查、正式迁移、docs/diagrams/路径检查、独立审查与最终浏览器；交付报告后暂停 |

第一批不以“全部旧功能无问题”为条件扩展通用体系，但必须完成能越过声明或改变冻结证据的必要入口。暂停记录中的扫描锁序、App 媒体与归档 WIP 未通过证据不能当作完成。评分触发器可能 UPDATE Artwork，Artwork/Artist 写触发器可能隐含取得 creator catalog；写者必须把此隐含锁纳入同一锁序，不能仅按显式 helper 判定无倒序。

第三批的真实浏览器验收使用独立数据库、媒体根和端口上的发布候选：仅候选代码可将独立删除门禁开启，用于核对实际 App/Worker 流程，不提供客户端或运行时绕过参数，也不部署到真实图库。候选门禁变更与正式 UI 一并独立审查；最终验证未通过时回到关闭状态并记录阻断，通过后才形成可交付的开放决定。验收候选不等同生产开放。

阶段内只运行受影响的最小测试和必要类型/lint。已通过且代码未变不重复运行；已有 50 万检测性能记录沿用，PREPARE 的已有部分规模证据按限制引用，不补造完整验收。最后一批再按[测试策略](../development/testing-strategy.md)统一全量。主应用 build 使用提升权限。

## 业务流程与架构图

当前图已经迁到[功能规格](../features/artwork-deduplication.md)，由当前行为维护，不继续作为本历史计划的插图：

- [完整业务流程](../features/artwork-deduplication.md#用户完整流程)：四类关系、人工选择、预览、一次确认和删除记录。
- [系统职责与边界](../features/artwork-deduplication.md#系统职责与持久边界)：App 短请求、数据库任务、三条 Worker 通道和受控子进程。
- [检测与三层缓存](../features/artwork-deduplication.md#三层持久缓存)、[处理上限](../features/artwork-deduplication.md#处理上限与继续执行)。
- [删除状态与故障续行](../features/artwork-deduplication.md#删除停止失败与原范围续行)。

下表的 B／A／D／L／R 节点对应 **2026-10-24 历史图**，与今日重组的图不再一一对应。复核历史证据时使用 Git 提交 `5dec7b58` 中的 `docs/diagrams/features/artwork-deduplication/*.mmd`（例如 `git show 5dec7b58:docs/diagrams/features/artwork-deduplication/business-flow.mmd`），不要拿当前节点编号解释旧测试。

## 需求 → 节点 → 批次 → 测试 → 证据

| 需求                                    | 图中节点                       | 批次与验收 ID                     | 测试重点                                                           | 证据                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精确多重集合、缓存和有界检测            | detection D01–D07；A05/A09–A13 | 已有阶段 1/2，沿用 D1/D2          | 算法、缓存、源代次、reader 退出和资源预算                          | [阶段 1](../records/artwork-deduplication-phase-1-2026-10-23.md)、[阶段 2](../records/artwork-deduplication-phase-2-2026-10-23.md)及其审查；不重跑已有性能                                                                                                                         |
| 分页审核、冻结范围与隐私                | B06–B09/B22                    | 批 2/3，保留 D3-01–07，更新 D3-08 | 未加载页范围、整理差异、旧预览不能执行新删除                       | [阶段 3 串联](../records/artwork-deduplication-stage-3-integration-2026-10-24.md)、[PREPARE 证据及限制](../records/artwork-deduplication-prepare-scale-2026-10-24.md)；[新目的证据](../records/artwork-deduplication-direct-delete-batch2-2026-10-24.md)                           |
| 锁序、必要写入口和实际 drain            | A03/A04/A07/A11；B11；R01–R03  | 批 1，DD-01/02                    | 隐含 catalog 锁、双向 generation、认领/发布交错、退出回执          | [第一批完成及差异审查证据](../records/artwork-deduplication-direct-delete-batch1-2026-10-24.md)                                                                                                                                                                                    |
| 四来源及混合组、精确范围和首删前全校验  | B10–B12；R03–R06               | 批 2，DD-03–06                    | fresh 全组、附件/历史原件阻断、路径独占、门禁                      | [第二批实现及专项](../records/artwork-deduplication-direct-delete-batch2-2026-10-24.md)，不以旧移动测试替代                                                                                                                                                                        |
| 意图/unlink/回执、部分失败、取消边界    | R07–R12；L03–L08               | 批 2，DD-07–09                    | unlink 前后崩溃、DB 回执失败、新占用、原范围重试、零扩围           | [第二批故障及DD07证据](../records/artwork-deduplication-direct-delete-batch2-2026-10-24.md)                                                                                                                                                                                        |
| 业务删除、墓碑及显式重新导入            | B13/B15；R13/R14               | 批 2，DD-10/11                    | 整理数据不合并、迟到发布拒绝、重叠来源代次、LOCAL_CREATED 无假来源 | [第二批生命周期证据](../records/artwork-deduplication-direct-delete-batch2-2026-10-24.md)                                                                                                                                                                                          |
| 一次确认、删除记录、桌面/手机与最终门禁 | B07/B10/B14；A01               | 批 3，DD-B01–03                   | 会话切换、重复提交、停止/部分失败、隐私、全链路                    | [第三批最终检查](../records/artwork-deduplication-direct-delete-batch3-2026-10-24.md)、[独立审查](../records/artwork-deduplication-direct-delete-batch3-review-2026-10-24.md)、[核心浏览器与未覆盖项](../records/artwork-deduplication-direct-delete-batch3-browser-2026-10-24.md) |

具体 DD 测试标准由[直接删除契约](./artwork-deduplication/direct-delete.md#验收标准)维护。没有实现的测试路径不作现有证据。

## 交付与恢复边界

开发继续在独立 worktree、`codex/artwork-deduplication` 完成，不改主工作区或暂存区，不回滚已有未提交改动。测试只使用独立 PostgreSQL、临时合成媒体及独立 App/Worker/端口；浏览器 URL 带 `entry=direct`。迁移使用正式 generate/deploy，禁止 db:push。

部署按正式迁移 → 兼容 Worker → App 入口，隔离候选开关不代表生产开放，发布前按[备份基线](../operations/backup-and-recovery.md)记录一致检查点。存在未终结删除时保留兼容执行器、声明和日志；不能仅换旧镜像、清 token 或清行来“回滚”。已 unlink 的媒体只能通过独立、经验证的备份恢复流程处理，页面不提供撤销。检测历史与可重建缓存可按原规则维护；删除意图、回执、必要审计和来源墓碑不得随 Artwork/Image 或普通检测历史级联消失。
