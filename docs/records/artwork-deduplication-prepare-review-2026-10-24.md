---
status: historical
scope: 第三阶段冻结只读 PREPARE 来源、清单、目录检查点与来源 IPC 独立审查
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-prepare-executor-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-prepare.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-source.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-directory-checkpoint.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-protocol.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-child.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader.ts
  - packages/pixishelf-job-executors/src/scan/content-reader.ts
---

# 只读 PREPARE 独立审查

2026-10-24，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f`，审查对象为未提交的阶段三冻结差异。工作目录为隔离 worktree `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`；独立上下文按统筹指定的 GPT-6.1 Sol/xhigh 执行。没有修改产品代码、主目录或真实媒体；没有连接数据库。

本次范围严格限定于[只读交接记录](./artwork-deduplication-prepare-executor-2026-10-24.md)：maintenance-prepare、maintenance-source、maintenance-directory-checkpoint 及对应测试；reader-protocol/reader/reader-child 只审新增 maintenance-source 读取通信；scan/content-reader 只审新增进度回调。为判断发布条件，阅读了直接依赖的 inventory、文件保存、单项 snapshot 和最终 complete DB helper，但没有重新审计其全部实现。

`maintenance-executor.ts`、共享 supervisor/reader-latch 恢复与新生产归档夹具属于正在进行的另一批，不在本次结论中。`maintenance-files.ts` 只读取检查结果的类型声明，没有审查其执行实现；native、能力探针、原媒体移动/删除及其曾被平台拦截的独立复审均未尝试。本报告不能替代或关闭文件写入基础复审，release stage 保持 2。

同日两项 P2 均完成最小修复及窄复审，已审范围内没有遗留可确认阻塞项；后文保留修前发现和证据。此结论不提升 release stage，不构成完整第三阶段验收。

## 方法与环境

阅读 AGENTS、文档入口、文档维护规则、阶段三共享契约、文件执行契约与冻结交接记录；静态追踪真实来源身份、封印/成员映射、归属覆写、分页事务、目录恢复、source IPC、进度和错误路径。

只为两个具体疑点建立最小临时夹具：实际导出的目录函数加 DB/reader doubles（不模拟 native 动作）；真实固定 reader 在临时目录读取一个 8 MiB 合成无效 JSON。所有临时材料位于 `/private/tmp/pixishelf-prepare-review-sol/`，不是产品测试或持久操作入口。没有使用真实 PostgreSQL、`dedup_executor_next`、规模库或实际媒体；没有运行全量 test/build/lint、规模测试或浏览器。

交接记录的 33/33 来源/reader/stable-read、9/9 PostgreSQL+child 和 executor typecheck 是实现者旧批证据，本次没有独立重跑。新的归档生产链夹具和 orchestration 结果也不计为本次独立通过。

## 首审发现

### P2：已登记文件的类型变化未进入目录阻断结果

修前位置：`maintenance-prepare.ts:326–355`、`:358–390`；最终发布条件参考 `pixishelf-db/src/artwork-dedup-review.ts:285–339`。

目录阶段把精确文件路径与“有已登记后代的目录”合并为同一个 `knownPaths` 集合。媒体在 inventory 保存 VERIFIED 行后、首次目录检查前被替换成同名符号链接或特殊文件时，页已经报告 SYMLINK/OTHER，但 `known` 分支直接跳过，不更新原行。变成同名空目录时，代码把精确文件路径当作合法目录递归，最终也不修改原行。此时目录状态与游标都可正常持久化为完成，原媒体行仍是 FILE/VERIFIED。

最终 complete helper 核对 DB 快照、归属和文件状态，没有再次读取 FS，因此不能补救这次已经观察到的变化。在其他成员正常完成的条件下，它仍可发布 READY。这里的问题是忽略明确的类型变化，不是要求 PREPARE 持续监控未观察到的文件变化。

最小复现调用实际 `prepareArtworkDirectory`，分别提供已登记 `owned/media.bin`、旧 VERIFIED 行和目录页观测 SYMLINK/OTHER/DIRECTORY。三个场景均得到：

```text
inspectionComplete=true
saveArtworkDedupOperationFilesPage.entries=[]（所有提交）
原 MEDIA status=VERIFIED
DIRECTORY 场景还会进入 owned/media.bin 进行目录遍历
```

复现命令：

```bash
pnpm --filter @pixishelf/job-executors exec vitest run --config /private/tmp/pixishelf-prepare-review-sol/vitest.config.mts --root /private/tmp/pixishelf-prepare-review-sol repro.test.ts
```

结果 3/3，实际执行约 0.3 秒；没有 DB 或真实媒体动作。实现者亦确认无另一处最终 FS 类型复核。

修复要求：区分精确文件与有登记后代的目录；已登记文件观察到类型或可靠属性变化时，更新原稳定 referenceKey 为阻断，不能当合法目录递归。更新既有文件不能重复增加 fileCount/preparedFiles，并覆盖三类替换回归。

### P2：来源读取失败漏算已读字节

修前位置：`maintenance-source.ts:119–155`、`reader-child.ts:101–108`、`:131–145`、`reader.ts:303–329`。

来源读取每块调用进度，但 child 按 250 ms 节流发送。完整读取后若 metadata/章节/manifest 身份或解析失败，只返回不带最终 bytesRead 的 error；父进程错误分支直接 reject，不补齐实际已读字节。因而 PREPARE 可把已完整读取的大文件记成一个块，依赖 reader.metrics 的 256 MiB 让出条件会漏算失败来源。

真实固定 child 读取临时 8 MiB 无效 Pixiv metadata 后返回 SOURCE_IDENTITY_MISMATCH，结果为：

```json
{ "actualCompletedRead": 8388608, "metricsBytes": "65536", "reads": 0 }
```

最小用例为同目录下 `source-metrics.test.ts`，命令仅将上例末尾文件名替换。1/1，通过约 0.4 秒。沙箱内 child 的固定进程身份探针不能启动，首次返回 READER_ENVIRONMENT；提升权限后运行得到上面的实际计量。没有连接 DB，没有调用能力探针或维护文件动作。

修复要求：错误路径也结算该请求实际累计字节，保持 IPC 单调校验与有界进度；不能用 250 ms 节流事件替代最终结算。补充完整读取后身份失败仍计入预算的回归，失败前尚未读取的超限请求仍计 0。

## 其余已审结论

- MEDIA 来自冻结页及阶段二 sha/stat 证据，URL 媒体还检查真实 importItem 摘要/字节；SOURCE_FILE 核对 Pixiv 文件内 ID，归档核对 revision/provider/externalId、完整文件摘要和 DB sealed/drained/memberCount 证据。章节复用既有规范解析和冻结 chaptersHash。未把文件名或同目录关系当作独占证明。
- 每页最多 50 个 Image/100 个文件行；媒体检查并发最多 4，章节与来源读取串行。文件行、计数和 afterImageId 在同一个调用方提供的 fenced transaction 中提交；每个来源的稳定 referenceKey 行单独提交并作为续跑标记。
- 页读取前和提交前均执行 operation 身份及目标作品 snapshot 复核；最终 helper 再核对全范围。内部 context 的 transaction 必须由既有 runtime fence 提供，本函数不自行取得全局 reader 或替代租约围栏。
- 目录检查点为 version/visited/至多 12 层路径及游标/十进制纳秒属性，不保存全文件列表；范围、损坏路径、超深/超预算拒绝，异常时不覆盖旧检查点。未知子树作为阻断项记录，不递归认领。Pixiv 平铺只检查精确来源，不遍历邻居。
- source 请求在父/子两侧与其他活跃读请求互斥，进度使用原 ack、stall 和 close 机制；SOURCE 身份错误为局部阻断，ROOT_CHANGED/reader 环境错误向上终止。未在本范围加入作品隐藏、长期声明或媒体移动/删除入口。

这些是代码层结论，不等于本次独立重跑了每一种故障和配置，也不代表其未审依赖已验收。

## 限制与后续验证

仍缺本次独立定向证据的边界：多层 DFS 进入/返回/兄弟目录续跑，恰好 12 层和 10,000 项预算边界；来源读取过程中替换、取消、失租约以及错误字节结算的完整 IPC 故障组合；真实归档 sealed/drained/importItem 发布链、跨作品/跨角色引用全集和嵌套根组合。既有测试覆盖单层目录变化、局部媒体 lease/snapshot 变化、source 硬链接/符号链接、来源上限和 scope 损坏，不能据此宣布上述完整组合已经通过。

目录真实分页枚举实现、原生文件检查/写入基础和其他平台/NAS 语义不在本次审查范围。生产 orchestration、10 秒/256 MiB 调度、close 失败保留占用、离线恢复、最终 scope.complete 和 release gate 仍须按其独立批次与最终统一验收核对。

## 修复窄复审与交付检查

窄复审仍基于相同 HEAD 的未提交差异，只检查本报告两项修复与新增回归，未扩展到 orchestration 或维护文件写入。

| 首审问题                   | 当前修复与验证                                                                                                                                                                                                                                                                                                   | 结论 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 目录忽略已登记文件类型变化 | `maintenance-prepare.ts:326–385` 分别维护 exact 文件和 descendantDirectories；只对后者下探。exact 再次检查 FILE 类型及 size/mtimeNs/ctimeNs/dev/inode/nlink，变化时按原 referenceKey 更新 BLOCKED/FILE_CHANGED。`:414–419` 只以 addedFiles 累计计数。独立最小三类复核 3/3 均保存阻断、无目录递归、计数增量为 0。 | 关闭 |
| 来源错误漏算完整读取       | `reader-child.ts:101–110` 在节流前累计真实字节，`:146` error 返回最终 bytesRead；`reader.ts:312–319` 先验证非倒退 bigint，再补充尚未计入的差值。协议 error 要求 bytesRead。独立真实固定 child 1/1，8 MiB 身份失败计量精确为 8,388,608，reads 仍为 0。                                                            | 关闭 |

独立复核命令与首审命令相同，末尾文件分别使用 `directory-fixed.test.ts` 和 `source-metrics-fixed.test.ts`；实际调用耗时分别约 4 ms 和 186 ms，Vitest 总耗时约 0.24/0.41 秒。目录夹具使用 doubles；来源夹具使用真实固定 child、合成文件和提升权限的进程身份探针。修前复现保留在原文件中，因此不应把临时目录的所有用例当作一个应当全绿的长期测试套件。

实现者新增的持久回归已静态阅读：`maintenance-prepare.postgres.test.ts:380–418` 分别替换 SYMLINK/空目录/FIFO，确认原行 BLOCKED、计数不增、最终 complete 拒绝 READY；`maintenance-source.test.ts:212–225` 确认 8 MiB 无效来源全部计量。实现者报告受影响 PostgreSQL+child 整文件 12/12、source 整文件 15/15 通过；本次没有独立重跑这两个整文件。只将本报告独立执行的 3+1 项计为独立验证。

交付检查结果见下文；未修改 Mermaid/SVG，未重跑全量 App/Worker 检查或规模任务。

主应用路径检查 `rg --files packages/pixishelf | rg '[A-Z]'` 无输出；本报告 no-index 空白检查无错误（新增内容时 diff 返回 1）。`pnpm docs:check` 通过，最终检查 220 份 Markdown。`pnpm docs:diagrams:check` 已执行但未完成：Playwright 缺少 `chromium_headless_shell-1194/chrome-mac/headless_shell`；没有安装浏览器或改动图源，图示验证保留给环境具备后的统一交付检查。本记录单文件使用 Prettier 格式化，未格式化他人文件。
