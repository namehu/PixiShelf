---
status: historical
scope: 去重第一阶段 App 上传、替换、扫描接入的实现交接与定向验证；同步删除恢复另行交接
date: 2026-10-23
---

# 第一阶段 App 实现交接

日期为 2026-10-23。适用 `codex/artwork-deduplication` 独立 worktree 的未提交实现，设计基线提交 `a4f4a031`。本记录不是阶段验收，独立审查、浏览器验证及最终全量检查由主 agent 统一执行。设计以[第一阶段计划](../design/artwork-deduplication/01-fingerprints.md)和[共享契约](../design/artwork-deduplication/phase-1-contracts.md)为准。

## 本次交付范围

- 普通上传在没有 Image 时创建 PATH 声明；最后块仅完成 READY，登记媒体与结束声明同事务。响应丢失可按原回执幂等登记；同路径覆写保留 Image ID，成功发布才退休原图片标记引用。
- chunk 的账户、会话、token、路径、声明大小、块序号、offset、请求 ID 与声明版本均参与校验。完成块重放不再打开文件。文件写入在短 DB 事务外的现有目录锁中执行，拒绝符号链接和硬链接。
- 客户端按账户持久化上传凭据和发送前逐块摘要。刷新后使用原凭据查询，重新选文件时验证本机已确认前缀；这不是服务器文件内容的完整性证明。顶层不确定写入由用户明确选择“重新上传该文件”，保留 gate，精确 CAS 新版本并从头重写，旧块在写文件前被拒绝。
- DIRECTORY 替换的授权、子上传回执与待提交清单贯通前后端。关闭弹窗或刷新不丢失原凭据；可重试原提交或恢复原件。完成响应丢失通过持久结果幂等返回。
- 提交未纳入的子上传、回滚产生的子文件均依据持久子路径与文件身份移入 `.pixishelf-upload-recovery`；不按媒体扩展名猜测删除。未知文件及恢复路径冲突会停止，父声明不释放。
- 恢复 manifest 使用原子 rename、0600 权限、文件及目录 fsync。首次 manifest rename 前留下的已知临时文件被保留，不妨碍在未移动任何原件时重建 manifest；已有备份却无正式 manifest 仍拒绝自动接管。
- 章节上传使用同一 PATH/子路径协议及持久凭据。旧格式章节候选文件不再未经独立声明就删除，保留原件；关联以规范章节文件为准。
- 旧 App 扫描、Local 导入/重扫在发现前捕获目录代次，发布时复核。reconcile 保留相同规范路径的 Image ID 和已有顺序，避免纯重扫误删个人标记。
- `mediaMark` 写入检查 Image/Artwork 源 gate，覆盖写期间不可操作，验证回滚保留原标记。

## 定向验证证据

环境是 PostgreSQL 15 容器端口 55432 的独立 `dedup_app_tests`，103 份正式迁移已部署；媒体全部为测试自建临时文件。没有对真实图库进行写入。测试清理仅处理自身 rootIdentity 的目录状态与声明。

| 检查 | 结果 | 证据位置与范围 |
| --- | --- | --- |
| App 定向单元/组件/扫描 fixture | 28 文件、218 项通过 | `/tmp/dedup-app-final-unit.log`；上传、章节、替换、图片管理、删除原路径、批量导入、扫描/重扫、标记、路由鉴权、受保护 action 与客户端恢复 |
| 最后新增边界复测 | 2 文件、46 项通过 | `/tmp/dedup-app-final-boundaries.log`；包括替换首次 manifest rename 中断恢复与 PATCH 重启路由的 Session 前置鉴权；与上一行有重叠，不相加为总数 |
| 章节确认故障复测 | 6 项通过 | `/tmp/dedup-app-chapter-fault.log`；内容已写入而 ack 数据库失败时标记恢复，不提交章节关联；与上方测试有重叠 |
| 真实 PostgreSQL + 文件系统 | 9 项通过 | `/tmp/dedup-app-postgres.log`；测试源为 `packages/pixishelf/services/artwork-service/__tests__/media-content-upload.postgres.test.ts` |
| App TypeScript | 通过 | `pnpm exec tsc --noEmit`，`/tmp/dedup-app-typecheck.log` 空输出、退出 0 |
| App lint | 0 警告、0 错误 | `pnpm lint`，`/tmp/dedup-app-lint.log` |
| 文档与差异检查 | 通过 | `pnpm docs:check` 检查 188 份 Markdown；`git diff --check` 无输出；未修改 Mermaid 图源 |
| App 大写路径检查 | 无匹配 | `rg --files packages/pixishelf` 经大写路径过滤无输出 |

真实数据库 9 项覆盖：无 Image 时拦截扫描与登记幂等、回执重放不重写、账户和 offset 拒绝、同目录不同 PATH 独立提交、同 ID 覆写后的标记失效、DIRECTORY 回滚保留原文件与标记、子路径已处置后的父提交重试及未完成文件隔离、失败后重启的新版本与迟到旧块拒绝、重扫稳定 ID 后真实 deleteImage、章节完成重试不重写。部分测试同时证明多个边界，不能视作全部故障点已覆盖。

上述日志位于本机临时目录；长期验收以测试源码、后续阶段提交及主验收记录为准。尚未执行浏览器视觉验证和全量 build；不宣称已验收。

## 删除恢复交给后续 worker

现有 guard 集成已落地，但以下删除失败恢复**尚未完成，不可据此通过阶段门禁**：

- `services/artwork-service/delete-artwork.ts` 已给非 URL 删除添加 DIRECTORY 声明，并在 owner 发布事务中删除 Image/Artwork。当前每次请求仍随机生成 session/token，文件中途失败后无法重新认领原 gate；必须改成稳定删除意图。`delete-artwork-files.ts` 当前仍按调用选择执行，需要冻结逐文件清单及身份，不可在重试时重新递归扩大范围。
- `services/artwork-service/image-manager.ts` 的 `deleteImage` 已在目录文件锁内为媒体/章节路径建立声明，成功后 owner 事务删除记录，但同样缺稳定删除意图及显式原范围重试。真实数据库正常删除已经验证；完整作品删除和崩溃重试需要下一 worker 补测。
- `clearChaptersForImage` 的物理章节删除也有相同的 gate + unlink + owner 发布结构；请一并核对失败后原声明的恢复，不能留下永久阻挡的随机 session。
- 删除 preview / DTO / UI 由后续 worker 接手；本次停止编辑这些区域。整作 URL 回收仍走原 Worker 维护机制，后续恢复保持它的领域限制。

已批准的实施方向是：同账户稳定 operationId/token，在 scan/HTTP 排除的恢复位置持久化精确选择、媒体快照、逐文件身份和每步结果；原 manifest 与 gate 都持久后才允许首个 unlink。preview 展示原操作及选择，用户按原 operationId 重试。仅允许原范围；路径缺失可认作上次删除后未回执，身份不匹配或确认删除后路径重新出现则停止。目录项逐文件执行，不根据新 preview 或递归发现增加目标。未知状态保留 gate。该协议仍须先补到权威设计/契约，然后实施和故障注入验证。

可复用接口位于 `services/artwork-service/content-source-guard.ts`：

- `resolveContentPath(scanRoot, target)` 在事务外验证根身份和规范路径，返回 canonical root/path/directory。
- `beginContentDirectoryWrite({scanRoot, relativeDirectory, artworkId, userId, sessionId, writeToken})` 建立目录和 Artwork 源 gate。
- `beginContentUpload({scanRoot, absolutePath, userId, sessionId, writeToken, declaredFileSize, totalChunks, parent?})` 建立 PATH 和当前 Image 源 gate，`parent` 可授权 DIRECTORY 内子记录。
- `contentOwner`、`contentHandle`、`contentAuthorization` 统一 wire bigint 转换；`assertContentOwner(tx,userId,authorization)` 核对持有者与精确版本。
- `publishContentOwner(tx,userId,authorizations,outcome,publish)` 在 DB owner 锁中运行业务 DML，然后结束仍存在的 source rows，最后同事务结束路径声明。该 helper 按 token **重新查询幸存 source rows**，所以 Image/Artwork 级联删除后的不存在源行不会再次 finish；不要用删除前快照要求被级联删除的行继续存在。
- `finishContentSources(tx,writeToken,outcome)` 可在需要时直接使用；`outcome` 只能是 `committed` 或已经验证的 `verified-rollback`。
- `recovery-manifest.ts` 的 `writeRecoveryManifest(filePath,value)` 负责 0600 临时写、sync、原子 rename、目录 sync。调用者必须先验证父目录、拒绝符号链接越界，并持有原文件操作锁；它不推断业务授权或恢复范围。

`addImage`、`associateChaptersToImage` 两个旧内部函数目前经调用点搜索未被运行入口使用。实际登记已使用 `addImageWithChapters` + receipt；新增调用不得绕开此协议。


## 独立审查 P1 修复交接

本节记录同步删除恢复收口之后，对[App 独立审查](artwork-deduplication-phase-1-app-review-2026-10-23.md)两项 P1 的定向修复；前文测试数量与未完成事项保留为对应交接时点的历史证据。本轮未修改公共 `content-source-guard.ts`、数据库契约实现、Worker 或任务控制，仍待独立审查者窄复审。

- P1-01：`media-upload.ts` 在最后块确认 READY 前完成媒体元信息读取及声明长度校验。损坏图片或元信息 I/O 失败保留原 owner/token/gate，转为 RECOVERY_REQUIRED，使用既有显式从头重传入口恢复。对已 READY 回执的重放再次读元信息失败时，用已经推进后的 checkpoint handle 标记恢复；COMPLETED 回执不会重新打开写入。测试使用真实 Sharp，验证损坏图片同 ID 覆写、元信息 I/O 故障及 READY 重放失败后的原会话重新上传与发布。
- P1-02：IMAGE/CHAPTERS 预览增加原成员快照的 SHA-256 `memberDigest`。既有确认框经 tRPC/HTTP DTO 提交 operationId、selectedPaths 与 memberDigest；物理删除缺少任一确认字段时拒绝。首次清单/gate 建立前比较当前允许路径及成员摘要，旧预览遇到章节路径或成员变化时拒绝，并保留所有文件与 DB 关联。已有 manifest 的恢复继续使用原选择及原成员摘要，不能以新查询结果扩大范围。

| 本轮检查 | 实际结果 | 日志 |
| --- | --- | --- |
| PostgreSQL + 临时媒体故障回归 | 2 文件、30 项通过；上传 12 项、删除恢复 18 项 | `/tmp/dedup-app-p1-postgres.log` |
| 受影响单元与接口 | 5 文件、62 项通过；上传、并发上传、image-manager、tRPC 与章节 HTTP | `/tmp/dedup-app-p1-unit.log` |
| App TypeScript | `pnpm exec tsc --noEmit` 退出 0，空输出 | `/tmp/dedup-app-p1-tsc.log` |
| 定向文件 lint | 11 文件、0 警告、0 错误；修正新增 if 大括号后复验 | `/tmp/dedup-app-p1-lint.log` |
| 文档、路径与差异检查 | `pnpm docs:check` 通过；主应用大写路径无匹配；`git diff --check` 无输出 | `/tmp/dedup-app-p1-docs.log` |

数据库沿用端口 55432 的隔离库 `dedup_app_tests`，两个 PG 文件串行执行，测试按自身 fixture rootIdentity 清理。未运行全集、全量 build、端口 55439 的旧 integration 或浏览器验证；旧 integration 本轮没有执行证明。未修改图源，因此不重复图示检查。上述测试与原交接测试有重叠，不应相加为阶段总测试数。
