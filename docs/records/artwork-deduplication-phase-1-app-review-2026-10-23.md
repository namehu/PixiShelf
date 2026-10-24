---
status: historical
scope: 去重第一阶段 App 服务与媒体 HTTP 路径的独立代码审查、阻塞项及定向复现
date: 2026-10-23
---

# 第一阶段 App 独立审查

审查日期为 2026-10-23；对象是 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication` 相对基线 `a4f4a031` 的未提交 App 改动，包含未跟踪实现和测试。审查者使用独立上下文，未参与阶段实现，未改功能源码。本记录仅覆盖 App 上传、替换、章节、同步删除恢复、扫描发布、导入、MediaMark gate、相关 transport/客户端协议，以及媒体 HTTP 路径和包 alias；DB 库、Executor、任务控制与 archive 服务由其他审查负责。

依据为 [第一阶段规格](../design/artwork-deduplication/01-fingerprints.md)、[共享契约](../design/artwork-deduplication/phase-1-contracts.md)、[权限边界](../security/access-control.md) 和仓库工程规则。实现交接记录中的历史测试数量不算作本次新执行结果。

## 结论

**本轮不通过：有两项 P1 阻塞。** 第一项会让普通损坏图片上传留下不能走现有显式重新上传入口恢复的 READY gate；第二项会让单媒体/章节物理删除偏离用户刚确认的文件选择。二者均已用真实 PostgreSQL 和临时媒体复现。

## 阻塞项

### P1：元信息失败发生在 READY 后，普通图片上传无法恢复

位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/services/artwork-service/media-upload.ts:217`。相关状态提交在同文件 180–190 行，恢复处理仅包围 178–203 行，之后的元信息读取和长度复查不在该处理内。

触发：上传一个扩展名为 `.jpg`、字节长度合法但 Sharp 无法识别的文件。最后块先由 `ackMediaContentUploadChunk` 持久化为 READY，再调用 `readUploadMetadata`；Sharp 抛错后没有把当前版本置为 RECOVERY_REQUIRED，也没有返回可登记的媒体回执。

实际复现：上传抛错；随后 `getMediaUploadStatus` 返回 READY、nextChunkIndex=1；`captureContentDirectory` 返回 WRITING；用该状态返回的授权调用 `restartMediaUpload` 被拒绝。客户端仅在 RECOVERY_REQUIRED 时提供“重新上传该文件”，而 READY 的末块重放再次执行相同的 Sharp 失败。这个普通 App 上传没有 Worker job 可用离线授权接管；换新 token 也会被原 PATH gate 拦截。若是同 ID 覆写，相关媒体标记也持续不可用。

最小修复：最后块在 READY 前完成必要的媒体元信息校验；或对 READY 后的元信息/长度失败用**已经推进后的 checkpoint handle** CAS 转入 RECOVERY_REQUIRED，保留原 owner/token/gate，并允许现有显式从头重新上传。不能拿旧块版本标记恢复，也不能在失败时直接释放 gate。增加真实 Sharp/PG 回归，验证损坏图片及元信息 I/O 失败均有原会话恢复路径，修复后可发布并释放 gate。

### P1：单媒体/章节删除未提交预览选择，旧 operationId 会删除新路径

位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/services/artwork-service/image-manager.ts:347`。`previewDeleteImage` 在 328–329 行返回 operationId 和 selectedPaths，但 `deleteImageContent` 在真正删除时重新读取 Image 并重新构造 selectedPaths，传入 `executeDeletion` 时未提供调用者确认的 selectedPaths。

入口同样缺少此字段：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/server/routers/artwork.ts:249` 和 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/app/api/artwork/media-chapters/[image-id]/route.ts:28`；客户端确认框虽然展示 selectedPaths，提交时只带 operationId。

触发：打开章节物理删除预览，显示 `video..chapters.json`；确认之前，另一操作把 Image.chaptersPath 更新为规范的 `video.chapters.json`；随后提交原预览 operationId。正式章节上传本来就能把旧格式章节关联改到规范路径。

实际复现：同一个 operationId 被接受，服务端清单冻结并删除了新路径 `video.chapters.json`，原预览中的 `video..chapters.json` 仍存在。后续成员复核只比对开始删除时新生成的快照，因此不会发现预览已过期。IMAGE 删除入口共享同一问题：Image/path/chaptersPath 在预览后变化时，原选择没有约束实际 unlink。

最小修复：将 selectedPaths 从确认框贯通 tRPC/HTTP schema、服务入参及 `executeDeletion`；在首次持久化清单和建立 gate 前确认当前允许范围与用户提交的原范围完全一致，变化则要求重新预览。也可使用服务端冻结的预览意图绑定 operationId；不能只接受一个与预览范围无绑定的 UUID。恢复重试继续使用既有 manifest 的精确选择。补充 IMAGE/CHAPTERS 在预览后关联变化的拒绝测试，并断言新旧文件及数据库均未发生删除。

## 本轮验证

环境为既有隔离库 `dedup_app_tests`，PostgreSQL 端口 `127.0.0.1:55432`；显式设置 DATABASE_URL 和 QUEUE_KERNEL_TEST_DATABASE_URL，仅使用临时媒体目录与唯一 fixture 用户/作品。清理按本次 rootIdentity 和 fixture ID 执行，没有访问真实媒体或业务库。

| 检查                                                  | 实际结果                                              | 证据                                                               |
| ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| 独立缺陷复现                                          | 2/2 个复现断言通过，表示确认上述缺陷，不表示行为合格  | `/tmp/dedup-app-independent-review-sol/repro.test.ts`、`repro.log` |
| HTTP 隐藏路径隔离、Route 鉴权、chunk 与替换客户端恢复 | 4 文件、41 项通过                                     | `/tmp/dedup-app-independent-review-sol/boundaries.log`             |
| 现有上传与删除跨账户拒绝用例                          | 2 项通过、22 项按名称过滤未运行                       | `/tmp/dedup-app-independent-review-sol/accounts.log`               |
| App 大写路径检查                                      | `rg --files packages/pixishelf` 经 `[A-Z]` 过滤无匹配 | 本轮终端检查                                                       |
| 差异空白检查                                          | `git diff --check` 无输出                             | 本轮终端检查                                                       |

文档检查 `pnpm docs:check` 通过（191 份 Markdown）；日志为 `/tmp/dedup-app-independent-review-sol/docs-check.log`。`pnpm docs:diagrams:check` 未完成：本机缺少 Playwright 要求的 `chromium_headless_shell-1194`，未下载浏览器；本轮未修改图源。错误记录在 `/tmp/dedup-app-independent-review-sol/diagrams-check.log`。

复现 harness 初次因临时目录中的 Vitest mock API 解析失败而未执行测试；修正临时 alias 后才获得表中 2 项结果。harness/config/log 均在临时目录，不加入仓库。

跨账户检查验证：别的账户无法续传现有上传；别的账户无法取得未完成删除的预览；原选择更改及已确认缺失路径重新占用时仍拒绝。代码审查未发现本轮新增的跨账户接管路径。媒体 `/api/v1/images/[...path]` 对解码后的隐藏段、编码分隔符和实际根内隐藏路径再次检查；现有 4 个拒绝用例通过，未发现 manifest/token 经该路径可读取的新增绕过。tsconfig/Vitest 的 media-content 专用 alias 与包导出相符。

## 限制与后续门禁

本轮未运行全集、全量构建或新的 App typecheck；交接提到的 `services/archive/archive-module.ts:243` 类型问题归任务控制审查处理，未重复列为本组发现。未运行端口 55439 的旧 `tests/integration/artwork-deletion.postgres.test.ts`；不能声称其兼容改动已实测。未执行真实浏览器、真实 Session/Cookie/反向代理或 Next.js 生产 transport 验证，UI 交由指定浏览器阶段。文件系统测试证明了进程内失败注入与实际临时文件操作，不是断电/NFS 持久性演练。

两项阻塞修复后需复测其新增回归，再由主审查统一执行最终检查和浏览器门禁。本记录不构成阶段一整体验收或生产发布证明。

## 2026-10-23 两项 P1 修复后的窄复审

本节追加在初次审查之后，保留前文当时的结论与证据。复审对象仍为同一 worktree、分支和基线，依据[修复交接](artwork-deduplication-phase-1-app-handoff-2026-10-23.md)中“独立审查 P1 修复交接”一节，仅核对原两项 P1 及必要的服务/transport 交界，未重新开展全域审查，也未改功能源码。

**复审通过：原两项 P1 均已关闭，本 App 审查范围没有剩余阻塞。** 该结论允许进入后续浏览器和阶段最终门禁，不替代其他审查或阶段整体验收。

- P1-01 已关闭。`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/services/artwork-service/media-upload.ts:181` 在最后块 ack 前校验媒体元信息和声明长度；损坏图片及元信息 I/O 失败保留原 owner/token/source gate，进入 RECOVERY_REQUIRED。独立重跑原损坏图片场景后，原 token 的显式从头重传成功，后续登记释放目录 gate。READY 重放的元信息失败在同文件 230–240 行使用 `checkpoint.handle` 标记恢复，避免使用已过期块版本；COMPLETED 不会因此重启写入。直接相关回归还覆盖同 ID 覆写时标记持续不可用，以及恢复后保留 Image ID 完成发布。
- P1-02 已关闭。`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf/services/artwork-service/image-manager.ts:348` 要求完整 operationId/selectedPaths/memberDigest；360–367 行在首次 freeze/persist 前比较当前允许路径和成员摘要，383–390 行复核原 manifest 及数据库成员。确认框、tRPC 和章节 DELETE DTO 已完整传递字段。独立重跑原章节关联变化场景后，旧确认被拒绝，未建立 manifest/gate，新旧文件和数据库关联均保留；重新预览后的删除成功且只删除当前章节。IMAGE/CHAPTERS 两入口及“路径不变但成员大小变化”回归均通过。已存在 manifest 的恢复继续使用原选择和原成员摘要。

### 本次实际执行的检查

继续仅使用既有隔离库 `dedup_app_tests`（127.0.0.1:55432）及临时媒体，fixture 按自身 rootIdentity 和 ID 清理。原始缺陷复现脚本和日志保留，本次新增 `repro-fixed.test.ts` 以断言修复行为。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 两条原场景的独立修复复现 | 2 项通过；确认上传恢复可完成发布、旧删除预览零 manifest/gate/unlink | `/tmp/dedup-app-independent-review-sol/re-review-repro.log`、`repro-fixed.test.ts` |
| 原 P1 的必要 PG 交界 | 6 项通过，24 项按名称过滤未运行；包含损坏图片同 ID 覆写、元信息 I/O、READY 重放及三条过期成员/路径确认 | `/tmp/dedup-app-independent-review-sol/re-review-boundaries.log` |
| 确认字段传递 | tRPC 与章节 HTTP 各 1 项通过，37 项按名称过滤未运行 | `/tmp/dedup-app-independent-review-sol/re-review-transport.log` |

本轮没有重跑全集、build、typecheck、lint、图示或文档全局检查；交接中的 PG30、单元/接口62、tsc 与定向 lint 结果属于实现方证据，不冒充本轮执行。初次审查所列真实浏览器、生产 transport、55439 旧 integration 及断电/NFS 持久性等未实测范围继续有效，最终统一检查由主 agent 完成。
