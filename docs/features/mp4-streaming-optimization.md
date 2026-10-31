---
status: current
scope: MP4 无损播放优化的作品筛选、跨页选择、固定目标预览与逐项入队
last-verified: 2026-10-31
sources:
  - packages/pixishelf/schemas/video-optimization.dto.ts
  - packages/pixishelf/services/video-optimization-batch-service.ts
  - packages/pixishelf/services/video-streaming-optimization-lock.ts
  - packages/pixishelf/server/routers/job.ts
  - packages/pixishelf/app/admin/tasks/_components/video-streaming-optimization-section.tsx
---

# MP4 无损播放优化

本文负责从作品选取 MP4 并提交优化的流程；任务记录、错误和结果统一在[执行动态](./background-job-history.md)查看。文件处理与恢复见[媒体处理与发布](../architecture/media-processing.md#视频流优化)，权限见[接口边界](../security/access-control.md)。隔离验证与未覆盖项见[2026-10-31 验证记录](../records/features/mp4-streaming-optimization-2026-10-31.md)，不表示生产已部署。

## 筛选与选择

任务页的“MP4 无损播放优化”按作品展示候选和状态，每页 20 个作品，按内部作品 ID 倒序。每个作品只处理满足筛选条件的 MP4；同一作品的其他媒体和其他状态视频不自动加入。

支持内部作品 ID、标题包含、艺术家名称、包含／排除标签、作品创建来源和视频最近任务状态。标题仅匹配标题，作品 ID 不解释为外站 ID；精确输入及标签规则以输入 Schema 与服务为准。创建来源不代表媒体的外站 Provider。

视频最近任务状态为：

| 状态                               | 含义与选择规则                                                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `NONE`                             | 未找到优化任务记录                                                     |
| `ACTIVE`                           | 排队、运行、暂停中、已暂停、自动重试等待或取消中；可查询，不能重复入队 |
| `COMPLETED`                        | 最近任务成功；须显式勾选该状态才能重做                                 |
| `FAILED` / `CANCELLED` / `SKIPPED` | 最近任务失败、取消或跳过；再次提交沿用重试链                           |

默认选择 `NONE`、`FAILED`、`CANCELLED`、`SKIPPED`。这是最近任务记录的分类，不探测文件是否已经具有 faststart 布局，不保证筛选结果都需要实际重排。

支持逐个作品、本页、跨页保留选择，以及“全选所有筛选结果”后排除作品。修改筛选会清空选择；翻页不会扩大显式选择。作品行只承载选择与状态，不展开任务进度、错误或处理结果，也不提供批量暂停、恢复或取消。

## 预览、确认与部分成功

1. 预览由服务端按当前筛选与作品选择计算实际可提交 MP4，排除活动任务。
2. 单次最多 1,000 个实际目标。超过上限整次拒绝，零入队，要求缩小范围；作品数量不替代 MP4 数量。
3. 预览返回固定目标，每项包含 `imageId`、`artworkId`、`latestJobId` 和最近状态；确认明确作品数、MP4 数和成功后重做数。
4. 确认只提交该固定目标列表，不重新发现新增媒体。预览后目标失效、归属变化或最近任务变化会跳过；已经存在活动任务则复用。
5. 每个目标独立事务处理，返回实际提交、复用、跳过和失败数。单项失败不回滚已经创建的其他任务；界面不得把部分成功显示成全部成功。

失败、取消和跳过的现有任务通过通用 retry 创建后继任务，保留 `RETRY` 触发来源及父任务链；失败提醒只在新任务确实创建的同一事务内确认。成功后重做创建新的手动任务。

已创建任务由通用 Worker 后台执行，关闭页面不停止这些任务。本次没有持久批次或发现任务；请求中断时，未创建的目标不承诺自动恢复。重新预览可检查当前状态后继续。

## 接口与查询入口

三个入口均使用 tRPC `adminProcedure`，操作者从 Session 取得；参数由[共享 Zod Schema](../../packages/pixishelf/schemas/video-optimization.dto.ts)维护。

| 接口                                           | 用途                                     |
| ---------------------------------------------- | ---------------------------------------- |
| `job.listVideoStreamingOptimizationCandidates` | 按筛选读取作品分页及 MP4 状态计数        |
| `job.previewVideoStreamingOptimizationBatch`   | 将显式作品选择或全筛选选择解析为固定目标 |
| `job.submitVideoStreamingOptimizationBatch`    | 逐项复核固定目标并入队，返回部分成功结果 |

执行动态可快捷限制为 MP4 优化任务，或进一步限制到单作品；原有 `jobId` 详情深链保留。目标作品、视频和处理前后体积变化只在任务详情读取，执行历史保持轻量摘要。

## 验收与恢复边界

- 默认状态、成功后显式重做、活动状态排除和同作品多视频筛选一致。
- 翻页保留显式选择，修改筛选清空选择，全筛选选择支持排除作品。
- 1,000 个目标可预览，1,001 个目标拒绝且零入队；提交范围不会随预览后新增媒体扩大。
- 普通入队、批量提交和 retry 竞争同一视频时，共用现有 image advisory lock；最多复用一个活动优化任务。
- 失效或状态变化目标跳过，单项失败仍保留其他已提交项；失败确认与 retry 后继任务原子提交。
- 无会话请求不得执行查询或写入；浏览器验收使用 `entry=direct` 和隔离数据库／媒体，jsdom 不作为真实浏览器证据。

本功能复用现有任务表和 Executor，不新增数据库迁移、任务类型或持久批次。界面回退不撤销已创建任务；媒体处理产生的临时文件、备份及恢复状态仍按现有 Executor 协议保留。实际批量媒体维护前遵循[备份与恢复基线](../operations/backup-and-recovery.md)，不能仅删除任务或换回旧界面来恢复原媒体。
