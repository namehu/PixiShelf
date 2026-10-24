---
status: historical
scope: App新扫描输入与URL收件意图的来源证明接线；不代表全写入口或文件生命周期验收
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf/services/media-root-central-service.ts
  - packages/pixishelf/services/archive-intake/archive-intake-service.ts
  - packages/pixishelf/services/source-audit/source-audit-apply-service.ts
---

# App 输入来源证明接线

在 `codex/artwork-deduplication`、HEAD `6e8d4f4c` 的指定独立工作树继续已有未提交工作。本批保持 gate 3，不开放隔离、恢复或永久清理，也不触及主工作区、用户5430服务或真实媒体。

## 本批行为

- CLIENT_LIST、本地目录导入、单作品 Pixiv/本地重扫在原 afterEnqueue 事务中一次调用 DB groups capture，来源证明与任务/输入原子提交。Pixiv 每输入 PROVIDER+精确 PATH；本地仅确认 createdVia=LOCAL_DIRECTORY 的 DIRECTORY。一次整批最多沿原10000输入限制，DB统一根与来源锁顺序；未新增 hash。
- 重用活动扫描严格 parse 原证明并一次 groups assert；历史 null 或旧代次不会被重新捕获。LOCAL_IMPORT/LOCAL_CREATED 兼容标签本身不再足以授权历史未知 createdVia 的父目录证明。
- 审计 Apply核对观察与原冻结输入证明相同，然后原样序列化复制；缺失、不匹配身份或代次返回 ITEMS_NOT_ELIGIBLE。证明与既有 metadata/audit 摘要分离。
- Provider新增同步 identifySource；E-Hentai /g 与 /s 共用纯 URL parser，严格主机/协议/凭据/端口/路径，gid及页号为正安全整数。/s不需要gtoken请求即可冻结身份；最终resolve身份验证由Executor批接入。App wrapper保留原错误边界。
- 新Intake在submission与RESOLVE任务同事务内、catalog之后一次分组捕获。Uploader原入口复用该事务；修改链接的新项同样捕获，DUPLICATE和容量失败审计项无执行证明。
- 收件箱及通用后台任务重试只验证原 identity/sourceId/generation；null、错误身份、旧代次拒绝，不修改原项或创建子任务。UI仅返回 sourceIntentValid，不泄漏原证明；缺证明项目不能直接重试或下载，历史READY仍可选择取消。取消/失败控制路径未加入OPEN前置条件。

## 验证与环境

新建合成专库 `dedup_app_inputs112`，仅连接既有容器 `pixishelf-dedup-postgres` 的 `127.0.0.1:55432`。建库前只读确认不存在，使用正式 `db:deploy` 从空库部署111条迁移；日志位于 `/private/tmp/dedup-app-inputs112-migrate.log`。没有db:push、旧库升级或真实数据备份恢复。两套新PG测试先验证精确目标再创建客户端，按专属user/prefix/sourceId清理自身夹具；扫描媒体只在mkdtemp合成目录内创建并清理。

| 命令/范围 | 结果 |
| --- | --- |
| Executor e-hentai.test.ts | 49项通过，包含13项纯身份/无网络与拒绝用例 |
| App media-root-central-service、source-audit-apply-service、archive-intake-service、archive-intake-view-state、job-command-service定向单测 | 100项通过 |
| 新media-root-source-proof.postgres.test.ts | 3项通过：整批实际冻结、HOLD事务回滚、历史null无重捕获、本地导入/重扫同根证明 |
| 新archive-intake-source-proof.postgres.test.ts | 6项通过：/g与/s同身份、HOLD整批回滚、null/代次/身份拒绝、两种服务重试入口、新链接新意图 |
| App `tsc --noEmit --incremental false` | 通过 |
| 本批文件定向oxlint及路径大小写检查 | 通过 |

首次定向单测发现审计严格摘要拒绝额外proof字段与测试缺少import；已将proof保持独立集合并修复，复验通过。初次普通沙箱Vitest启动因工作树缓存写权限失败，提升权限后运行成功。首次定向lint发现新行格式及Provider文件行数上限；已按纯URL解析职责提取 `e-hentai-url.ts` 并修复。

## 实际边界与后续

本批不宣称扫描/归档Executor消费、最终发布、source release/drain或全App写守卫完成；这些由后续批独立验证。新证明接口要求真实可解析URL，旧大归档PG夹具中的非数字E-Hentai占位gid、非真实token与手工READY/null历史项需在相关集成批按新语义分类更新；本批未运行该整套长期流水线，不据本批定向数字声称其通过。Uploader复用入口已核对，本批未重新运行完整Uploader/网络下载流程。

记录只覆盖本批实施者验证，仍待独立Sol审查；完整lint/test/build、规模、图示和真实浏览器验收由最终集成门禁统筹。未重做已审查阅读、评分、单图标记及单作品元数据/排序批。


## 独立审查 P2 修复

按[独立审查](./artwork-deduplication-app-input-proofs-review-2026-10-24.md)修复中央扫描服务的错误传输缺口。只在同服务新增窄 adapter，三处 groups capture/assert 的拒绝通过真实 `ArtworkDedupOperationError` 类型筛选；SOURCE_HELD 映射现有 CONCURRENT_MODIFICATION 并提示来源维护，SOURCE_GENERATION_CHANGED/SOURCE_IDENTITY_CHANGED 提示保留旧任务、复核后新提交。均经已有传输层得到 HTTP409 / tRPC CONFLICT。其他错误及其他领域错误码继续原样上抛，HTTP500脱敏行为保留；未修改共享transport分类器。

定向 `media-root-central-service.test.ts` 17项通过（新增7项覆盖两种capture、三种reuse拒绝和两种未知错误）。测试真实调用service→runBackgroundTaskApi→apiHandler，同时核验tRPC分类、未知错误引用不变和无重捕获。三个文件oxlint零问题；App `tsc --noEmit --incremental false`通过。原PG测试只更新已知拒绝码期望为CONCURRENT_MODIFICATION，不为错误映射重跑PG；未运行全量/docs/diagrams。

修复冻结SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `services/media-root-central-service.ts` | `2d2535c8fb1b65f8b6f82ae9a254bcdb4512b93a707f9361f18cdb3f782c7424` |
| `services/__tests__/media-root-central-service.test.ts` | `bdbe06c76e0d3969768d0d3894d0728a721e01cf52295dadbfd45b1a65d96825` |
| `services/__tests__/media-root-source-proof.postgres.test.ts` | `27f2d7ca3765838ae8dd78eab8b2a60c7b4ac9ba8529937ebe527e82ae094c64` |

以上路径均位于packages/pixishelf。修复仍待原独立审查者窄复核，其余本批文件保持冻结。
