---
status: current
scope: E-Hentai 上传者来源保存、人工增量/历史扫描、结果确认与归档收件箱衔接
last-verified: 2026-09-02
sources:
  - packages/pixishelf/app/admin/archive/inbox/
  - packages/pixishelf/server/routers/archive-inbox.ts
  - packages/pixishelf/server/routers/archive-uploader.ts
  - packages/pixishelf/services/archive-intake/
  - packages/pixishelf/services/archive-uploader/
  - packages/pixishelf-job-contracts/src/
  - packages/pixishelf-job-executors/src/archive/
  - packages/pixishelf-worker/src/
  - packages/pixishelf-db/prisma/schema.prisma
---

# E-Hentai 上传者人工扫描

本文定义第一版上传者发现能力。它是归档收件箱的人工 URL 发现工具，不是订阅、爬虫调度器或自动下载系统。

## 用户问题与范围

管理员希望保存常用 E-Hentai 上传者，通过人工操作发现其最新或更早的公开画廊，确认后把选中 URL 加入现有归档收件箱。

第一版支持：

- 按上传者名称或数字 UID 保存来源，UID 优先；
- 人工“扫描最新”和“继续扫描更早作品”；
- 在来源页直接取消等待中、重试等待、暂停或运行中的扫描；
- 单次最多返回 100 个画廊，后续扫描使用持久游标；
- 将最近 30 天已完成扫描按来源汇总为去重的虚拟无限列表，而不是要求用户切换运行批次；
- 标记新发现、活动任务、已归档、可能更新和版本替代关系；
- 批量勾选后加入现有归档收件箱；
- 归档或重新启用上传者来源，保留身份与游标；
- 扫描由 PostgreSQL 持久任务执行，可在 Worker 重启后安全重试。

第一版不支持：

- 定时或自动扫描；
- 自动加入收件箱、自动选择质量或自动下载；
- ExHentai、Cookie 或登录凭据；
- 标签、语言、页数和任意搜索表达式过滤；
- 把 Uploader 转换为 Artist；
- 因远端画廊消失而删除、回收或改写本地归档。

## 用户流程

```text
保存上传者来源
  -> 人工扫描最新 / 继续扫描历史
  -> 查看并勾选结果
  -> 加入现有归档收件箱
  -> 等待 ARCHIVE_RESOLVE_ITEM 解析
  -> 人工选择 ORIGINAL / DISPLAY 并入队
  -> ARCHIVE_IMPORT 下载和发布
```

上传者扫描只产生候选 URL。归档身份、完整元数据、媒体计划、质量决策、revision 发布和下载恢复仍由现有收件箱链路负责。

## 持久模型

### ArchiveUploaderSource

保存一个公开 E-Hentai 上传者来源：

- Provider、身份类型、规范化身份值和显示名称；
- `ACTIVE` 或 `ARCHIVED` 生命周期；
- 最新扫描已完整覆盖的水位；
- 未完成的大批增量扫描游标与头部水位；
- 历史向后分页游标；
- 最近成功/失败扫描摘要。

归档来源只停止新的人工扫描，不删除游标、运行记录或已归档作品；重新启用后从原水位继续。

### ArchiveUploaderScanRun

每次点击创建一个运行，模式为：

- `LATEST`：从最新结果开始，首次建立最新水位，后续在旧水位处停止；
- `HISTORY`：从历史游标继续向更早结果推进。

运行与一个 `ARCHIVE_UPLOADER_SCAN@v1` System Job 一一对应。只有完整成功才推进来源游标；失败、取消、租约丢失或响应结构不完整不得推进。

运行记录是任务状态和审计边界，不是结果浏览导航。来源页只显示当前活动运行和最近运行摘要；重复点击扫描不会新增需要用户手动切换的结果 tab。

### ArchiveUploaderScanItem

每个画廊保存 GID、canonical URL、标题、缩略图、上传时间、轻量元数据指纹、替代关系和分类。选中加入收件箱后保存对应 `ArchiveIntakeItem` 引用。

结果读取跨该来源所有仍在保留期内的已完成运行汇总，以 Provider/GID 去重并保留最新一次分类，再按远端发布时间通过服务端游标分页。前端使用虚拟列表，只渲染可视区域并在接近底部时自动加载下一页；活动扫描完成后自动刷新结果流。

终态运行与逐项记录保留 30 天；来源身份、游标和最近运行汇总长期保留。清理只处理扫描操作历史，不删除归档作品、来源引用或媒体。

## 结果分类

| 分类              | 含义                                                          | 默认操作           |
| ----------------- | ------------------------------------------------------------- | ------------------ |
| `NEW`             | 本地、活动收件和活动归档任务均不存在                          | 可勾选             |
| `ACTIVE`          | 相同 Provider/GID 或 canonical URL 已在收件箱或活动归档任务中 | 不重复提交         |
| `ARCHIVED`        | 已存在本地来源引用，轻量指纹未发现变化                        | 不重复提交         |
| `POSSIBLE_UPDATE` | 已存在本地来源引用，但轻量指纹发生变化                        | 可勾选重新解析     |
| `REPLACEMENT`     | 当前远端画廊明确替代了本地已有的旧画廊                        | 明确提示，人工决定 |

扫描分类只帮助人工选择。最终 `NEW/UPDATE/UNCHANGED/ACTIVE_TASK` 仍以现有收件解析器的完整 metadata hash 与领域状态为准。

## 任务与资源边界

新增 `ARCHIVE_UPLOADER_SCAN@v1`，payload 只包含 `scanRunId`。任务：

- 只能由管理员人工创建；
- 固定进入 `ARCHIVE_RESOLVE` lane；
- 每个任务只处理一个来源，最多发布 100 个结果；
- 没有父任务、子任务或自动续跑；
- 搜索页面和批量 gdata 请求都在数据库事务外执行；
- 通过 execution fence 提交运行终态和游标；
- 取消或 Worker 停止后不提交旧执行结果。

Provider Governor 增加 `SEARCH` 请求类。E-Hentai 搜索请求最小间隔固定为 3 秒，可以与活动媒体下载并行，但仍与其他请求共享持久请求间隔和 Provider penalty；`RESOLVE` 和 `DOWNLOAD` 保持现有治理语义。

## 分页与水位

首次 `LATEST` 从最新页开始：

- 结果不超过 100 时保存首个 GID 为最新完整水位，并保存更早结果游标；
- 达到 100 且仍有更新结果时，保存增量续扫游标和本轮头部 GID；下一次“扫描最新”继续该增量段；
- 后续增量到达旧水位或远端结果结束后，才把暂存头部 GID发布为新水位。

`HISTORY` 只推进历史游标，不改变最新水位。Provider 返回的游标必须重新校验为公开 `https://e-hentai.org/` 搜索 URL，不能接受任意远端地址。

## 收件箱衔接与幂等

扫描结果批量提交复用 `createArchiveIntakeSubmission()`，仍受单次 100、活动容量 1000、URL/身份去重和管理员权限约束。

每次用户点击提交时生成一个 submission attempt ID。幂等键由 source/item 指纹和 attempt ID 共同生成，因此一次选择可以跨越多个扫描运行：同一次网络重放复用原 Submission，容量不足后再次明确点击则创建新尝试。随后按 URL 把 Scan Item 关联到实际 Intake Item；未生成 Intake Item 的容量拒绝项保持可操作。扫描层不直接创建 `ArchiveImport`。

## 权限与敏感数据

- 来源读取需要登录会话；创建、归档、恢复、扫描和加入收件箱使用管理员 procedure；
- 仅允许公开 HTTPS E-Hentai 搜索、API 与现有媒体 allowlist；
- 不保存 Cookie、Authorization 或 ExHentai 凭据；
- 普通列表只展示脱敏后的 gallery URL，完整 canonical URL 只在服务端入箱衔接中使用，错误与事件继续使用归档脱敏规则；
- Uploader 是来源账号，不证明 Artwork 的 Artist 身份。

## 验收标准

1. 名称和 UID 来源都能创建，规范化身份不能重复。
2. 每个来源同一时间最多一个活动扫描运行。
3. 单次最多保存 100 个去重画廊；历史扫描从持久游标继续。
4. 增量扫描到达旧水位后停止，不重复制造收件项目。
5. 新发现、活动、已归档、可能更新和替代关系分类可解释。
6. 搜索与 gdata 请求遵守 Provider Governor 的三秒间隔和 penalty，但不因活动下载而让行。
7. 活动扫描可从来源页直接取消；失败、取消、响应不完整和 lease 丢失都不推进水位。
8. 已完成结果按来源跨运行去重汇总，通过虚拟无限列表自动分页，不生成运行切换 tab。
9. 选中结果只进入现有归档收件箱，不自动下载；一次选择可以包含不同运行产生的结果。
10. 容量拒绝的结果保持可操作；释放容量后的新提交尝试可以入箱，同一次网络重放仍保持幂等。
11. 归档来源后不能新建扫描，重新启用后保留原游标。
12. 新页面复用现有 shadcn/Radix 组件并满足键盘、标签和空状态可访问性。

## 发布与回滚

使用 expand migration 新增表、枚举值、关系和 lane 约束；部署顺序仍为 migration、支持新 capability 的 Worker、App。旧 Worker 不理解新 job type，不得在 migration 后继续作为唯一消费者。

回滚 App/Worker 前应停止新扫描并等待活动 `ARCHIVE_UPLOADER_SCAN` 终态。新表是附加数据；回滚旧版本时可以保留，不影响现有 URL 收件和归档读取。删除新表与 enum 值属于后续独立 contract migration，不与功能回滚绑定。
