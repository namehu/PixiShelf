---
status: draft
scope: 四种作品来源及混合组的去重专用直接删除、事务边界与故障续行目标契约
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - docs/operations/backup-and-recovery.md
---

# 直接删除契约

本文保留直接删除的演进契约；下方快速确认节已实现并完成隔离验收，其余章节中的批次与版本为历史设计。当前已实现行为见功能说明。直接删除替代旧 ISOLATE/RESTORE/PURGE 维护流程。检测、分页、审核、PREPARE、逐文件日志和已有写守卫继续沿用。旧模式的代码、迁移或测试仅是可复用基础；本契约不据此宣称新删除可用。实施批次与唯一总体计划见[总计划](../artwork-deduplication.md)。

## 快速确认与单轮核验

本节替代下文旧版“先异步 PREPARE，等待清单完成后确认”的交互与执行次序；旧流程保留作历史兼容说明。验收状态与当前能力只在[功能说明](../../features/artwork-deduplication.md)维护，[本批证据](../../records/artwork-deduplication-delete-confirm-2026-10-29.md)记录实际测量与限制。本轮不改扫描规则、生产处理上限和四种关系的确认含义。

1. `prepareCleanup` 在数据库中冻结检测、审核、保留者／副本、成员、来源和整理签名，以及已登记原件、章节与可确认来源文件的精确范围。不读取文件、不排队 PREPARE，返回稳定操作 ID 和 READY。界面展示整部作品去留、登记数量、未核对媒体及个人整理影响；READY 表示可确认，不表示现场文件已验证。
2. `preparationVersion=2` 与既有关系 `protocolVersion=1/2/3/4` 分离。原操作默认为 preparationVersion=1，维持旧语义；新维护任务为版本 6，旧任务版本不改写。每个文件保存不可变的 `verificationSpec`，冻结检测 SHA、属性、源版本或附属文件的归属及封存／映射依据。授权摘要绑定这些证据；随后取得的现场属性和哈希单独记录，不能改变已确认范围。
3. 用户仍只确认一次，绑定账户、操作版本、摘要和幂等键；外部持续停写与不同版本内容损失声明不省略。后台认领全部保留者与副本、排空相关写执行后，按有界分页读取文件、批量保存核验进度。主核验对所选全部原件各完整读取一次，每个独占作品目录枚举一次；正常让槽后仍可做必要的目录范围与属性复查，不重新全组读取内容。目录新发现文件绝不自动加入清单。未知附件、共享路径、硬链接、越界、成员／来源／内容变化或旧归档映射不全，都在首删前阻断。
4. `verificationResume` 绑定进程会话、队列 attempt、jobId 和业务执行版本，仅在读取进程已退出、正常让槽的围栏事务中写入，并在续行第一事务消费；同一执行版本正常让槽续行复用持久核验进度，不因处理下一个文件重复全组哈希；失租约、故障重试和新执行仍按现有恢复规则重新取得安全证据。完成整范围核验屏障后，继续逐文件身份检查、持久删除意图、unlink 和回执。批量化不取消提交时的执行围栏、源代次、声明和取消检查。
5. `verifiedFiles` 只计后台实际核验，登记数量不得叫“已核验”；尚未知的字节数不填零。确认前不隐藏作品；错误不静默缩小范围或转换成新授权。旧记录保持原展示，新记录不要求用户看工程文件清单才能确认。

同一批固定样本比较旧／新确认等待、确认至完成、总耗时、SQL 与内容读取量；功能验收覆盖混合媒体、一次确认、真正删除及保留件字节不变。生产“两分半”案例的耗时成因没有完整分段测量，合成结果不能直接当作 NAS 提速承诺。

## 范围、预览与唯一确认

支持 `LOCAL_CREATED`、`PIXIV_IMPORTED`、`LOCAL_IMPORT`、`URL_ARCHIVE` 及混合来源组，按完整登记原媒体字节一致认定重复。来源不影响分组，也不能自动替用户决定删除。保留者和副本来自同一冻结重复组；整理数据不合并。

`prepareCleanup` 继续异步入队 PREPARE，冻结 run/审核版本、选中组、keeper/copy、根映射、成员、来源、精确文件与整理影响，返回 BUILDING 及稳定 operationId。新计划必须显式具有 `preparePurpose=DIRECT_DELETE`，且绑定新协议版本/范围摘要；缺目的或目的为 ISOLATION/PURGE 的旧 READY，不能转换、补签或授权新删除，须重新准备。

预览逐作品说明保留者、待删副本、登记原件、已知章节/来源文件、整理影响、阻断和排除原因。共享路径、硬链接、符号链接、越界、未知附件，以及未参加内容一致性验证的旧归档 revision 原件必须阻断该作品。不能因用户勾选组就批准附件；不把哈希未验证的历史原件当作当前展示媒体的重复。若因此使组内无法安全保留/删除完整范围，整组不可执行。用户明确排除的组不在冻结范围；冻结后的新阻断使原预览失效，不能静默缩小确认范围。

不扩大 PREPARE 已有有界目录检查来扫描 Pixiv 平铺邻居；不把父目录或整艺术家目录当待删范围。保留者不计入删除字节；逻辑字节不承诺等于实际磁盘释放。

只有一个不可恢复删除确认面板：展示服务器冻结范围、保留者、具体副本、文件/整理数据影响，并由用户确认已暂停所涉目录的外部同步和编辑。确认绑定 Session 操作者、expectedUserId、operationId、expectedVersion、DIRECT_DELETE 目的、范围摘要及幂等键；服务端记录后果确认和停写声明。新预览版本必须重新展示并确认。无需隔离确认、第二次清理确认、确认口令或恢复准备步骤。备份依据遵循运维基线，不把填写备份引用当作自动验证，也不添加新的产品确认流程。

## 共享接口与能力边界

| 入口                              | 目标语义                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `prepareCleanup` / `getOperation` | 保留现有异步分页/稳定 ID；新增严格 DIRECT_DELETE 目的与版本绑定。PREPARE 不删除、不隐藏作品、不长期认领，也不是删除授权          |
| `directDelete`                    | 绑定上述一次确认；不接客户端路径、哈希或任意作品集合；相同幂等键及规范输入重放同一操作，同键异输入拒绝                           |
| `listOperations` / `getOperation` | 删除记录及分页详情，包含冻结范围、影响、已完成/未完成/阻断计数、原动作、可用操作和脱敏诊断；不返回绝对根、原始哈希或他人私有整理 |
| `cancelOperation`                 | 首个删除意图前取消并经核实释放；一旦进入删除不可逆边界只请求在安全文件边界停止，保留状态/范围，不伪装未发生                      |
| `retryOperation`                  | 只继续同 operation 的 DIRECT_DELETE 原授权范围及未完成文件；先实际退出、围栏和保留者 fresh 复核，不接受新路径、新组或新动作      |
| `allowReimport`                   | 仅已完成条目的独立来源墓碑，按所选 sourceId/expectedGeneration 和操作版本解除，推进所有受影响重叠来源代次；不恢复文件            |

App API 与 Worker/Executor 都校验一个独立的 DIRECT_DELETE 能力门禁，初值关闭。不得以 release stage ≥4/5、旧 ISOLATION READY、类型注册、仅隐藏按钮或环境开关代替验收。旧维护入口不能成为通道；普通 URL 删除、回收站和恢复沿既有协议，只额外遵守未终结去重 hold。

沿用 ARTWORK_DEDUP_MAINTENANCE 与 BACKGROUND_WRITER，不新建通用任务框架；目标模式为 PREPARE / DIRECT_DELETE，严格类型和正式迁移需第二批同步。现有 release stage 3 保持原只读开放范围，新增 DIRECT_DELETE 目的本身也须受新门禁约束。现有字段及历史枚举可先兼容保留，但不得被解释为新授权；不为本轮顺便删除旧表或迁移历史。

## 认领、锁序与执行排空

1. 重新核对 READY 目的/协议、审核、Session、根/来源/成员与整理签名。在同一短事务中按稳定顺序认领全部 keeper/copy 及精确来源；与其他维护或活动写声明冲突时整体拒绝。声明不靠时间自动过期。
2. 总体锁序继续为 resource/job fence → run/operation/审核状态 → 必要 creator catalog → 受信根协调 → 来源 identityKey 排序 → Artwork ID 升序 → 内容/个人行。并非所有写者都要取得全部锁；但会触发 catalog 的 Artwork/Artist 写入（含评分触发器）必须在根/来源/Artwork 之前取得既有 catalog，避免隐含锁倒序。只按显式 SQL 观察锁序不够。
3. Claim 与来源 HOLD 阻止上传、替换、媒体/章节注册、结构/归属/标签级联、删除、迁移、扫描/来源/归档最终发布及新建同来源。所有最终写事务重验原来源证明；排队时检查不能代替发布检查。KEEPER 可正常阅读，COPY 的新阅读及双方整理/结构/原内容变更被拒绝；阅读时间不进入删除内容签名。
4. 建立 HOLD 后终止相关执行并确认退出，覆盖下载 lane、在途写 token、已封存但未发布、旧失租约及无 generation 登记的遗留执行；只要不能证明停止就不删。普通 URL trash/restore/purge、reconcile/staging cleanup 在请求/物化/已排队实际执行与最终提交均遵守同一持久 hold。
5. Writer 等待 drain 时持久化状态并让出执行槽，不占槽等待同 lane 子任务。取消/失败/停止回执允许在 HOLD 下由原 token/fence 提交，不能要求 OPEN 从而堵死 drain。租约、任务终态、cancel/kill 请求均不是退出证据。

第一批收口当前写保护 WIP 和此处必需入口，不能以旧单元测试覆盖了新 guard 就宣称真实并发成立；也不因安全清单而新增与冻结证据无关的通用体系。

## 首删前全范围核验

认领和退出证明完成后，受控 reader 对本次所选的所有组、所有 keeper/copy 绕过内容缓存完整读取登记原媒体；核对实际文件、完整成员、来源和属性、排序多重集合及明确附属范围。每组保留者可在同一受控执行窗口读一次；不重读整个图库。所有组全部成功后，才可持久化首个删除意图。任一校验失败使操作过期/阻断，首删数必须为零；不能验证一组就先删一组。

外部停写声明必须覆盖此校验和后续全部删除；发现变化立即停止，不能将外部文件变化重新接纳为原授权。根 marker、路径祖先及普通文件身份在每个实际动作前继续核验，文件边界守卫不由起始 fresh hash 代替。reader 退出与 token 规则继续复用现有 supervisor。

冻结操作及逐文件记录独立于将被删除的 Artwork/Image。全部核验成功后，先持久化校验摘要、精确 manifest 和不可逆动作状态，将所有选中 COPY 隐藏，再开始原地删除。清单持久化/DB 不可写时不动文件。不新建隔离树、移动目标或 rename 能力探针，不递归清空目录、不顺带 rmdir。

## 逐文件协议、终结与故障

每条文件严格执行：当前操作/执行围栏及版本核验 → 核对冻结身份 → 持久 `DELETE_INTENT` → 对已验证父目录描述符下的精确文件 unlink → 按能力同步必要父目录 → 持久 `DELETED` 回执。任一步出错停止推进并保留现场。受控 reader 是唯一媒体 I/O 进程；不退回 shell rm 或普通作品删除接口。

- 无意图而文件缺失：异常，不能补造已删回执。
- 同一持久意图后文件已缺失：只有能将其绑定到原操作/执行及此前核验身份时，才可补原删除回执；不重新发现更大范围。
- 路径出现新文件、身份变化或根变化：保留新占用，阻断，不按原文件名直接删。
- unlink 成功而同步/DB 回执失败：保留原意图，不能声称未删除；重试以现场和原记录核对后续行。
- 部分失败或安全边界停止：保持 COPY 不可见、原冻结范围、必要 keeper/copy 声明、来源 hold 和日志。重试确认旧 reader 退出并重新完整验证保留者，复核未完成文件，只续原范围。若保留者变化则阻断；已经删除的文件没有撤销入口。
- 尚无删除意图时可取消；存在未决意图即按可能已删除处理，在确认执行退出和现场前不能释放声明或恢复可见性。开始后“取消”显示为请求停止，安全边界不发起新文件动作。

只有所有授权文件回执齐全，才能删除该副本业务记录及按既有规则清理其评分、媒体标记和阅读等关联；不把这些整理合并到 keeper。派生文件/指针也必须在冻结影响中明确，不能在终结时任意扩大原文件范围。操作、文件意图/回执、必要展示快照和墓碑不能被业务级联抹除。终结、来源状态及 Claim 释放在原版本/fence 下原子提交；不留“先释放再删除记录”的再发布窗口。

四来源采用同一专用协议。URL_ARCHIVE 不先回收、不依赖 purgeAfter、不让普通归档 purge 接管；已归档历史原件若未参加本次一致性验证，在 PREPARE 即阻断。LOCAL_CREATED 通过真实根/精确路径/Artwork 守卫保护，删除后保留操作审计；若无可再发现身份，不为适配墓碑伪造 provider。

## 来源墓碑与显式重新导入

可再发现的 PROVIDER、精确 PATH、经验证的 LOCAL_DIRECTORY 身份使用既有来源表的独立 TOMBSTONE，防止扫描、重扫、重试和迟到发布复活。预览显示哪些删除项会保留来源抑制；不暴露其他账户隐私。未知来源不能推断成父目录或外部身份。

成功删除后的 `allowReimport` 只解除明确选中的墓碑。HOLD/TOMBSTONE → OPEN 必须在既有根协调锁下与所有受影响重叠 PATH/DIRECTORY 的 generation 推进原子提交，覆盖子 PATH 影响祖先 DIRECTORY、祖先 DIRECTORY 影响子 PATH 两个方向；不能解除其他操作的 HOLD/TOMBSTONE。旧冻结任务即使来源重新 OPEN 仍因原代次失效而拒绝，新显式输入才能捕获新证明。

## 验收标准

| ID        | 必须证明                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| DD-01     | 扫描/App/归档实际写入口遵守显式及隐含 catalog 锁序；Claim 前后交错都拒绝受保护写入，原事务零写回滚                       |
| DD-02     | 真 drain 覆盖旧/孤儿/已封存执行；HOLD 不阻止原停止回执；超时/失租约/kill 不解锁；Writer 等待让槽                         |
| DD-03     | 四来源各自及混合重复组可准备并删除；LOCAL_CREATED 无假来源；旧 ISOLATION/PURGE/缺目的计划和门禁关闭的直接 API/任务均拒绝 |
| DD-04     | 只读 PREPARE 分页、完整范围与影响；共享路径/硬链接/符号链接/越界/未知附件/未验证历史归档原件阻断，不静默略过             |
| DD-05     | 先认领双方及退出，再对所有所选组绕缓存全读；最后一组失败时所有组首删数为零；成员/根/来源/整理变化拒绝                    |
| DD-06     | 只 unlink 冻结精确文件，平铺邻居、整个艺术家目录、未知文件和空目录均保持；没有 rename、回收或目录清空                    |
| DD-07     | 意图前、unlink 前后、同步/回执/终结前后的故障注入；无意图缺失不算成功，未决意图可按原证据对齐，替换文件绝不删            |
| DD-08     | 部分失败保留隐藏与声明；重试 fresh 验证 keeper，只续原范围；拒绝扩组、换保留者和新动作；旧执行不能写回执                 |
| DD-09     | 首个意图前取消零删且核实释放；开始后停在安全边界，保留已删事实，无恢复或撤销路径                                         |
| DD-10     | 文件完成后才业务删除，整理不合并，日志/墓碑独立存续；他人仅有保护资格提示，无私有记录泄漏                                |
| DD-11     | 真实重扫/迟到发布被墓碑拦截；双向重叠 release 代次及并发捕获；allowReimport 仅新意图可用且不恢复文件                     |
| DD-B01–03 | 正式 UI 的一次确认/重复提交/账户切换、删除记录/部分失败/停止边界、桌面手机/键盘/错误空态及最终全链路                     |

测试只用隔离库和合成文件，独立审查和证据记录后才可满足开放门槛。最终能力开关变更属于第三批验收决定，不能仅凭第二批单测通过放行。

## 第二批冻结的内部接口（v1）

DIRECT_DELETE v1 使用独立常量 `ARTWORK_DEDUP_DIRECT_DELETE_ENABLED=false`；不读环境变量、不由旧 stage 推导。`preparePurpose=DIRECT_DELETE` 必须同时具有 `protocolVersion=1`。READY 时服务器生成 `scopeDigest`，覆盖根、所有选中组/成员、来源/整理签名及精确文件身份；执行确认提交相同摘要、purpose、protocolVersion、expectedVersion、expectedUserId 和幂等键。旧数据保留 protocolVersion/scopeDigest 为 NULL，不升级为新授权。

维护任务的协议版本独立于删除协议：旧 `ARTWORK_DEDUP_MAINTENANCE@1` 仅兼容旧 PREPARE 等历史 payload；新目的 PREPARE 和 DIRECT_DELETE 一律使用 `definitionVersion=2`。v2 PREPARE payload 显式携带 `purpose=DIRECT_DELETE, protocolVersion=1`；DIRECT_DELETE payload 仍只携带 operationId/executionVersion/mode，授权从持久操作读取。新 Worker 同时注册 v1/v2，各版本使用严格 parser，v1 PREPARE 不能执行新目的操作。App 在领域创建前按现有 READY/heartbeat/capabilities 规则核对 writer lane 的维护 v2 能力；旧 Worker 只声明 v1，队列按版本过滤领取，不依赖领取后解析失败。

正式迁移 018 只扩充原队列策略的维护 v2 分支，保留 SCAN/v1 的 SYSTEM、writer lane、900 优先级、无定时/父任务/截止时间约束。v2 JSON 必须有正确类型和精确字段；缺字段、JSON null、旧 purpose、错误协议或附加路径均拒绝，SQL CHECK 显式把 UNKNOWN 视为失败。已有请求重放仍由领域核对规范输入和幂等键，不因 Worker 后续离线而创建第二个任务。新操作及需要重新入队的重试/停止收口仍要求可用 v2 Worker。

App 的 `prepareCleanup` 接受旧严格输入或新 DIRECT_DELETE 严格输入；旧 sourceOperationId 不能换目的重新签发。`directDelete` 使用专用一次确认输入；`retryOperation`/`cancelOperation` 按持久模式分派，新删除拒绝 itemIds 或任何新范围，停止不调用通用队列取消。`allowReimport` 只调用新墓碑 CAS，不再借用 PURGE 占位。查询增补协议、scopeDigest、STOP、完成/剩余副本和剩余精确文件计数；完成副本按已业务删除计算，文件完成按持久回执计算。删除后使用冻结标题/来源/时间快照，个人数据只投影当前账户，来源代次从实时来源读取。普通 archive 回收列表排除 ACTIVE+deletedAt 的去重副本。

DB 入口 `authorizeArtworkDedupDirectDelete` 只冻结确认和执行状态，调用者同事务建立专用 maintenance job 并绑定 jobId；输入 userId 来自 Session。`retryArtworkDedupDirectDelete` 只推进旧执行版本，必须 readerState=IDLE/token=NULL，Claim 跟随同一执行推进，不能补造退出证据。`requestArtworkDedupDirectDeleteStop` 设置持久停止请求；执行器确认退出后调用取消终结。

状态为 READY → DRAINING → VERIFYING → DELETING → DELETED；故障/停止保留 RECOVERY_REQUIRED/STOPPED。`freshVerifiedExecutionVersion` 是整操作全组 fresh 屏障，任何文件意图之前都必须等于当前 executionVersion。副本隐藏使用既有 Artwork.deletedAt（全部 fresh 成功后设置），archiveLifecycleState 保持 ACTIVE，不能交给普通 URL 回收/清理。PREPARE 与 DRAINING 不设置 deletedAt；KEEPER 始终保留。最终删除业务行与墓碑/声明释放同事务，日志保留。

来源墓碑保留精确 PATH、真实 PROVIDER 和经验证 DIRECTORY；LOCAL_CREATED 只会有真实精确 PATH 防止同路径发布，不生成 PROVIDER。首意图前取消打开本操作 HOLD 并推进重叠代次；部分删除只保留 HOLD。`allowArtworkDedupDirectDeleteReimport` 只接受 DELETED 副本绑定的 TOMBSTONE；核对操作版本/源代次并调用既有双向 reopen 原语。

内部实施补充：`impactSignature` 冻结预览时的标题、标签、系列及已知派生指针影响；正常 FRESH 让槽沿用操作 afterArtworkId/afterFileId，实际退出旧reader后按原执行版本续页，不使用内容缓存。业务故障重试推进执行版本、清理fresh游标并重读保留者。全部成员fresh完成前没有文件意图；进入删除的slice预算从屏障后计时。首个意图事务回滚时可能已隐藏COPY，核实零意图并退出后取消会恢复deletedAt及释放本操作HOLD。
