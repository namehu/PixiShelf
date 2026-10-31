---
status: current
scope: 作品删除前预览、文件选择、空目录清理、当次总结及失败重试
last-verified: 2026-10-31
sources:
  - packages/pixishelf-job-executors/src/artwork-delete/delete-artwork.ts
  - packages/pixishelf/services/artwork-batch-delete-service.ts
  - packages/pixishelf/services/artwork-service/delete-artwork.ts
  - packages/pixishelf/services/artwork-service/delete-artwork-files.ts
  - packages/pixishelf/schemas/artwork-delete.dto.ts
  - packages/pixishelf/app/admin/artworks/_components/artwork-delete-report.tsx
---

# 作品删除与删除总结

归档作品的列表隐藏、回收站恢复和来源「已删除」状态见[归档回收站](./archive-trash.md)。归档删除意图与历史任务删除标记由正式迁移中的数据库触发器原子维护，永久清理后仍保留来源身份的删除意图。

`admin/artworks` 的“删除作品”先读取预览，管理员核对完整文件清单和选择后再执行。非 URL 归档作品直接删除选中文件；URL 归档保持整包回收和 7 天保留策略。请求成功不等于所有删除步骤成功，执行结果按项报告。

## 删除前预览与选择

- 安全的已登记媒体固定选中；作品目录内其他普通文件默认全选，包括子目录、普通隐藏文件、简介、链接说明、封面、压缩包和未识别元数据。文件名或内容不再决定附属文件能否删除；例如 `133479323-简介-links.txt` 可直接选择。
- 附属文件可逐项或按目录取消。目录复选框只调整全部可选后代，不影响固定媒体，也不受搜索或虚拟列表挂载范围限制。滚动、筛选后保留选择状态。
- 预览采用虚拟滚动列表，无分页。顶部保留作品、目录和搜索筛选；行内只显示相对文件路径和处理状态，完整路径、类型与原因点击查看，范围说明按需展开。底部固定显示删除/保留数量、目录结果和确认按钮；检查失败或结果未确认时直接显示错误。
- 系统只核对数据库引用，不能证明目录里没有尚未导入的其他作品；管理员需核对默认全选清单。
- 目录读取失败或超过检查限制时禁止确认，可解决问题后重新加载；扫描根不可用同样禁止执行。已不存在的目录和文件不阻止清理剩余记录。

## 范围与保护

- 覆盖本地导入、手工、Pixiv 扫描等非 `URL_ARCHIVE` 创建方式。目录依次从 `storagePath`、首个有序媒体父目录、`metaSource` 父目录确定。媒体分散时不推算公共祖先。
- 扫描根、第一层艺术家目录、`local-imports` 及其艺术家层级不整目录列举或清理；无法确定作品目录时只展示和处理登记文件。
- 共享作品目录递归只读展示，额外文件禁选且目录保留；其他作品引用的登记文件也保留，但允许移除本作品记录。
- 不跟随符号链接或 junction，不删除系统保留路径 `sources`、`.trash`、`.archive-staging` 和 `.pixishelf-root`，不处理非普通文件。非法登记章节路径保留。不根据文件内容扩展删除范围，不清理派生媒体根目录。
- 检查最多 100,000 个目录项、向下 12 层；达到边界时报告未完整检查并禁止执行。只处理本次作品，不扫描历史残留。
- 目录只在原清单的文件处理后、数据库发布前，从深到浅通过非递归 `rmdir` 清理，不向作品范围外延伸。用户保留文件导致目录非空是预期结果。

## 执行与失败

顺序为：管理员预览 → 提交明确选择与稳定 operationId → 服务端核对范围、持久化精确删除清单并建立写入声明 → 按清单删除文件 → 非递归清理原清单内空目录 → 在同一短事务中删除 Image/Artwork 记录并结束声明。App 与 Worker 共用 `job-executors/artwork-delete` 中的最小核心，不包含上传或替换业务重构；验收见[共享删除记录](../records/dedup-shared-deletion-2026-10-31.md)。

服务端在第一次文件写入前校验整份选择：必选媒体不可漏选，禁止选择目录、禁选项或范围外路径。不会把执行时新发现的文件追加到删除集合。首个 unlink 前，原选择、成员快照、根身份、逐文件身份和执行进度保存到扫描与媒体 HTTP 排除的恢复区；operationId 绑定会话账户和原目标，不能作为跨账户授权。每个文件实际删除前核对身份，数据库事务内复核原成员集合，避免删除未处理媒体的记录。

任何选中文件真实删除失败时保留作品、媒体记录和写入声明，其余文件可能已经删除，不自动恢复。同账户重新打开预览时展示原清单，选择保持冻结，明确点击“重试原删除”；单图和章节物理删除使用相同协议。重试不重新递归扩展范围。未回执的路径已经缺失可记为已处理；已确认缺失后路径重新出现、文件身份变化或成员变化时停止，不覆盖新内容。未知结果不按超时自动解除保护。

Image 与 Artwork 删除在同一短事务中，先获取 creator catalog 锁，再获取作品锁。任一步失败，两类数据库记录及触发器变更一起回滚；文件删除不随数据库回滚。数据库提交后才报告记录 `DELETED`。空目录或文件处理失败会保留业务记录供原清单重试；已经删除的文件不会因数据库回滚自动恢复。

按选择完成且有主动保留或安全保留文件时，结果可为 `COMPLETED`，界面明确展示保留数量及目录状态。文件或数据库步骤失败并已有文件删除时为 `PARTIAL`；没有完成任何删除时为 `FAILED`。目录清理错误为 `PARTIAL`。

## 接口

- `artwork.previewDelete`：`adminProcedure`，输入正整数作品 ID，返回 `ArtworkDeletePreview`。包含作品信息、目录模式（作品目录/共享目录/仅登记文件）、检查完整性、是否可执行、说明和逐项选择约束（必选/可选/禁选/目录批量选择）。
- `artwork.delete`：`adminProcedure`，输入 `{ artworkId, operationId?, selectedPaths? }`。本地删除必须提交明确相对路径数组，空数组仅在没有必选媒体时有效；URL 归档省略选择，继续整包回收。旧整数输入不再支持，页面与服务接口需随同一版本更新。
- 客户端选择不能越过服务器路径、系统保留项或共享引用保护；预览不执行文件删除。首个执行请求持久化恢复 manifest，复用共享目录/source 声明；不新增环境变量。响应丢失使用原 operationId 重放终态，不重复 unlink。

## 通用批量后台删除

`artwork.batchDeletePreview/Submit/Get/List/Stop/Retry` 使用管理员会话与账户一致性校验。预览复用上面的普通删除范围，服务端在 SystemJob payload 保存逐作品 preview、operationId 和选择；`PAUSED + CONFIRMATION` 仅为无占用草稿，用户确认后才转为 PENDING。Worker 另检查 `confirmed`，通用任务中心控制不能将草稿直接入队。关闭确认可取消草稿，不建立来源 hold。

`ARTWORK_BATCH_DELETE` 在既有 writer lane 内逐作品处理；普通文件 manifest 不变，不增加数据库表或逐文件去重回执。直接删除在文件边界检查现有执行失效信号，两个数据库短事务各自通过现有执行权入口。归档项只在短事务提交原 ARCHIVE_MAINTENANCE，然后继续其他作品；不会占着 writer lane 等待其子任务。报告区分“回收已提交”“文件已移入回收站”，已回收作品重放可直接显示完成。

单作品失败记录安全的具体原因并继续独立项。失败重试或正常 Worker 关闭后续跑使用相同任务、operationId 和已确认路径，不重新扩大范围；已成功项跳过。停止后续删除是持久业务请求，未开始的作品不执行，当前作品到原安全边界结束，已删和已提交归档回收不会自动撤销。失去执行权或 Worker 关闭信号及时中断，不能当作“等当前作品做完”。强杀残留 `.replace-write-lock` 不自动偷取或按超时删除，需按普通停写恢复流程核对。

批量报告持久保存在 SystemJob result，轻量列表只返回作品进度、结果及归档任务摘要；确认明细和完整下载按需查询。去重结果页在处理结果变化时刷新受影响结果，不重新执行检测。单作品接口的返回与原报告展示保持原行为。

## 报告契约

`artwork.delete` 返回 Zod 校验的 `ArtworkDeleteReport`：

- 报告 UUID、删除 operationId、作品 ID、删除前标题、创建方式、目录、开始及结束时间。
- `mode`：`DIRECT_DELETE` / `ARCHIVE_TRASH`；`outcome`：`COMPLETED` / `PARTIAL` / `FAILED` / `QUEUED`。
- `entries`：逐路径记录媒体、章节、元数据、目录或其他文件，附删除依据、保留原因、安全错误码。状态为 `DELETED` / `MISSING` / `RETAINED` / `FAILED` / `NOT_ATTEMPTED`。
- `database`：Image 与 Artwork 各步骤结果、Image `deleteMany` 实际数量及成功删除所移除的关联类型；标签、艺术家和系列实体保留。
- `counts`：根据实际明细汇总，路径去重；`inspectionComplete` / `warnings` 标明检查边界。
- `archive`：回收任务 ID、生命周期状态、是否复用。归档仅报告标记与提交，不把后台移动写成已完成的物理删除。

执行后的业务失败也返回已有明细；认证、参数和作品不存在等前置错误使用接口错误。服务端日志关联同一报告 UUID；客户端不接收原始堆栈、数据库错误详情或服务器绝对路径。

## 展示、下载与恢复

结果侧边抽屉自动打开，顶部紧凑显示结果、删除/保留/失败数量和作品记录状态；报告编号、数据库明细和说明按需查看。文件明细使用虚拟滚动，支持路径搜索、状态筛选；失败原因直接显示，其余原因点击查看。底部固定下载和关闭操作。UTF-8 TXT 下载包含全部明细，不受筛选或列表挂载范围影响。标题、路径及错误遵循隐私遮蔽，主动下载包含真实内容。

当前页面仅在内存中保留最近一次报告，关闭后可重开；刷新、离开或新结果替换后不提供历史查询。请求期间禁用重复删除、不自动重试；未收到响应时显示“结果未确认”。重新打开删除预览可按原 operationId 显式核对并重试，完整报告历史仍不提供列表查询。

归档报告通过 `/admin/tasks?jobId=...` 打开任务控制台详情，回收仍遵循 7 天保留策略。报告不是备份，恢复依赖兼容备份或快照；空目录可按明细重新创建，代码回退不会恢复被删内容。参见[备份恢复基线](../operations/backup-and-recovery.md)。

## 验证

文件测试只使用临时 fixture，覆盖链接说明文件、隐藏文件、子目录、取消选择、共享引用、路径穿透、符号链接、检查不完整、删除失败与重试。组件测试覆盖默认选择、固定媒体、2,000 项列表的挂载范围和滚动选择、搜索与目录操作、按需说明、禁用确认、重复提交和隐私标记。

隔离 PostgreSQL 测试位于 `tests/integration/artwork-deletion.postgres.test.ts`。仅接受 `DELETION_VALIDATION_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/pixishelf_delete_validation` 对应的专用测试库；先部署仓库已有迁移，再运行该测试。失败注入通过测试库触发器验证 Image/Artwork 原子回滚，不得指向实际图库数据库。

历史验证与限制见[2026-10-02 删除事务验证](../records/features/artwork-deletion.md)。
