---
status: current
scope: 作品删除、附属文件与空目录清理、当次总结及失败边界
last-verified: 2026-09-15
sources:
  - packages/pixishelf/services/artwork-service/delete-artwork.ts
  - packages/pixishelf/services/artwork-service/delete-artwork-files.ts
  - packages/pixishelf/schemas/artwork-delete.dto.ts
  - packages/pixishelf/app/admin/artworks/_components/artwork-delete-report.tsx
---

# 作品删除与删除总结

`admin/artworks` 的“删除作品”在确认后执行。非 URL 归档作品直接删除已登记媒体；URL 归档记录删除意图并交给回收任务。页面收到结果后自动展示总结，不能把请求成功等同于所有删除步骤成功。

## 直接删除范围

- 覆盖本地导入、手工、Pixiv 扫描等非 `URL_ARCHIVE` 创建方式。
- 目录依次从 `storagePath`、首个有序媒体的父目录、`metaSource` 的父目录、艺术家 `userId` 与作品 `storageKey/externalId` 确定。媒体分散时不推算公共祖先。
- 保留扫描根、第一层艺术家目录、`local-imports` 及其艺术家层级，以及根目录下的 `sources`、`.trash`、`.archive-staging`。共享或无法定位的目录不执行新增清理。
- 删除登记媒体和合法命名的已登记章节文件。其他作品或媒体引用的文件保留，不跟随符号链接或 junction。
- 附属文件限目录内已登记 `metaSource`、匹配可信 Pixiv ID 的 `<ID>-meta.json/txt`、`<ID>_pN-meta.json/txt`，以及现有视频章节命名规则确定的候选。元数据需通过解析，有可信 Pixiv ID 时内容必须一致；未登记章节候选必须通过章节校验。身份冲突、解析失败或检查后变化的文件保留。
- 未登记封面、压缩包、说明文件、隐藏文件和其他未知文件保留。不根据章节 JSON 内容继续删除引用文件，不清理派生媒体根目录。
- 原文件删除无真实失败且数据库删除成功后，才清理新增附属文件，再由深到浅用非递归 `rmdir` 删除空目录。非空目录保留，不向作品目录外继续清理。

检查最多 100,000 个目录项、向下 12 层，元数据最多 16 MiB、章节候选最多 5 MiB；达到边界时报告未完整检查并跳过新增清理，不静默截断为成功。只处理本次作品，不自动清理历史残留。

## 执行与失败

顺序为：读取作品与共享引用 → 检查目录 → 删除登记文件 → 删除 Image 记录 → 删除 Artwork 记录 → 清理附属文件 → 清理空目录。

沿用现有文件系统与数据库非原子语义：原文件删除失败仍可能继续删除数据库记录；Image 删除成功后 Artwork 删除失败也不会自动撤销。报告分别记录实际结果，附属清理不再继续。不能把数据库媒体数量当作文件删除数量。

`ENOENT` 为“原本不存在”，不算本次删除。权限、安全或 I/O 错误记录为失败或保留。目录检查后出现新文件时 `rmdir` 保留目录；检查状态不承诺目录之后不会变化。无法进入的目录明确标注内部未检查。

## 报告契约

`artwork.delete` 接受已认证管理员会话和正整数作品 ID，返回 Zod 校验的 `ArtworkDeleteReport`：

- 报告 UUID、作品 ID、删除前标题、创建方式、目录、开始及结束时间。
- `mode`：`DIRECT_DELETE` / `ARCHIVE_TRASH`；`outcome`：`COMPLETED` / `PARTIAL` / `FAILED` / `QUEUED`。
- `entries`：逐路径记录媒体、章节、元数据、目录或其他文件，附删除依据、保留原因、安全错误码。状态为 `DELETED` / `MISSING` / `RETAINED` / `FAILED` / `NOT_ATTEMPTED`。
- `database`：Image 与 Artwork 各步骤结果、Image `deleteMany` 实际数量及成功删除所移除的关联类型；标签、艺术家和系列实体保留。
- `counts`：根据实际明细汇总，路径去重；`inspectionComplete` / `warnings` 标明检查边界。
- `archive`：回收任务 ID、生命周期状态、是否复用。归档仅报告标记与提交，不把后台移动写成已完成的物理删除。

执行后的业务失败也返回已有明细；认证、参数和作品不存在等前置错误使用接口错误。服务端日志关联同一报告 UUID；客户端不接收原始堆栈、数据库错误详情或服务器绝对路径。

## 展示、下载与恢复

结果侧边抽屉自动打开，支持路径搜索、状态筛选、每页 50 项。UTF-8 TXT 下载包含全部明细，不受筛选分页影响。标题、路径及错误遵循隐私遮蔽，主动下载包含真实内容。

当前页面仅在内存中保留最近一次报告，关闭后可重开；刷新、离开或新结果替换后不提供历史查询。请求期间禁用重复删除、不自动重试；未收到响应时显示“结果未确认”，应核对列表与服务端日志。

归档报告通过 `/admin/tasks?jobId=...` 打开任务控制台详情，回收仍遵循 7 天保留策略。报告不是备份，恢复依赖兼容备份或快照；空目录可按明细重新创建，代码回退不会恢复被删内容。参见[备份恢复基线](../operations/backup-and-recovery.md)。
