---
status: draft
scope: 第三至第五阶段页面交互首批实现与定向验证，等待共享 API 集成和独立审查
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-parallel-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/ui-design.md
  - packages/pixishelf/app/admin/duplicates
  - packages/pixishelf/app/admin/tasks/_components/background-task-format.ts
---

# 重复作品处理 UI 首批证据

本批以 `c2d6be73` 为起点，在指定工作树中并行实现 UI。没有修改后端、数据库、执行器、共享 DTO、锁文件或发布门禁，也没有提交 Git。其他协作者的修改保留。第一批代码于 2026-10-24 冻结，供独立 Sol 审查；此记录不代表第三至第五阶段已开放。

## 依据和设计约束

读取第三、四、五阶段计划、页面设计和原型，以及共享阶段三契约。使用仓库 [frontend-design](../../.agents/skills/frontend-design/SKILL.md) 和 [shadcn](../../.agents/skills/shadcn/SKILL.md) 技能；沿用现有字体、蓝色主题、Button/Sheet/AlertDialog/Tabs/Checkbox/Field 等组件，没有创建新视觉品牌或修改全局组件。

页面为“检查结果 / 隔离区”两标签。作品组采用有留白的行，最多三个小预览；大组进入桌面侧栏、手机全宽详情。各分页固定 20 项。输入、按钮和选择标签提供至少 44 px 触区，详情和底栏含底部安全区间距。未做浏览器验收。

## 第一批：结果审核与异步预览

- 独立保留选择、组勾选；保存保留作品不会自动纳入处理。失败的选择保留在界面，所选组尚未保存时禁止 PREPARE。
- 组与成员使用独立分页游标；成员页单独显示不在当前页的已保存保留作品。详情只展示当前账户的评分、有效/失效书签和喜欢、阅读情况；其他账户仅显示服务端布尔提示。
- 显式跨页选择保存 ID 和副本数；ALL_RECOMMENDED 使用服务端全范围计数和排除 ID，不把已加载页冒充全量。达到契约上限明确报错，不截断。
- PREPARE 使用 expectedRunVersion、expectedReviewRevision、expectedUserId 和幂等键，获得稳定 operationId 后打开批次；URL 保留该 ID，刷新可找回。
- 批次详情独立读取摘要、作品页或文件页，显示实际冻结/排除/阻断范围和验证时间。BUILDING 轮询，READY 为快照，STALE 经 sourceOperationId/expectedOperationVersion 重新预览原组范围，生成新的操作。
- 保留了当前 run 的检测控制；运行中/失败时可使用契约中的 lastCompletedRun 返回上次完成结果。该字段仍待数据端接入。

## 第二批：隔离与恢复

- 仅展示服务端 allowedActions 开放的实际动作；ISOLATE 需要 READY，要求备份检查点引用、备份确认和外部停写确认，必要时另确认整理记录影响。
- 确认表单以 operationId/version/purgePreview.version 为作用域，状态代次变化重置确认；所有写入带 expectedUserId、expectedVersion 和稳定幂等键。
- 恢复单独确认本批次范围，说明遇到目标冲突不覆盖；失败和 RECOVERY_REQUIRED 显示服务端安全原因及原动作的重试。重试不扩展授权范围。
- 批次列表、任务中心均可发现持久操作。维护任务使用共享严格 payload schema 校验安全 ID 后跳转领域页面，前端通用暂停、取消、恢复、重试和优先级入口均禁用；中文任务名为“重复作品处理”。后端保护由数据端独立负责。

## 第三批：永久删除与显式允许重导

- preparePurge 先异步复核；只有 ISOLATED、READY 的 purgePreview 和服务端 PURGE 动作一起满足才显示独立永久删除入口。
- 删除对话框再次确认备份、外部停写和不可恢复后果；提交包含 expectedPurgePreviewVersion 和原批次 ALL 范围。
- 保留作品或文件变化使预览失效时，不提供可提交的删除入口。PURGE 的 RECOVERY_REQUIRED 仅允许原范围继续删除，不出现恢复或重新预检的路径。
- 允许重新导入必须明确选择本批已删除作品的 TOMBSTONE 来源，并提交各 sourceId/expectedGeneration；单独确认说明只解除导入保护，不恢复文件或整理记录。

## 并发、账户与迟到响应

`useDuplicateIntent` 在同步引用上锁，快速点击不会重复提交；未确认失败保留同一幂等键，UUID 使用既有浏览器 fallback。离开账户/资源作用域后不再执行成功或失败回调。组保存按 reviewVersion、reviewRevision 取较新数据，批次响应按 operationId、version、updatedAt 合并，旧操作和低版本响应不会把页面切回。

## 本批定向验证

只运行本任务相关用例和 lint，没有重新运行阶段二全套 38 个用例或全 App test/build/typecheck，没有操作真实数据库或服务。

| 验证 | 结果与边界 |
| --- | --- |
| duplicate-intent.test.tsx | 3 个新增用例分别通过：快速重复/失败幂等键、账户切换后迟到响应、全部确认及版本重置。初次 2 通过、1 因测试环境缺 ResizeObserver 失败；补测试环境后仅重跑该 1 项通过。 |
| duplicate-selection.test.ts | 4/4 通过：跨页显式范围、真实全部推荐、上限拒绝、批次响应版本顺序。 |
| duplicate-review.test.tsx | 4/4 通过：未保存选择阻断、保留选择不勾组且推进审核代次、全量范围与快速准备、服务端未开放时不可执行。首次失败仅因断言文案过短，修正后该文件 4 项通过。 |
| duplicate-operation-actions.test.tsx | 6/6 通过：服务端动作门禁、隔离确认绑定版本、单独永久删除确认、PURGE 恢复边界、持久原范围重建、显式来源代次重导。 |
| duplicate-workspace.test.tsx | 1/1 通过：URL 恢复稳定批次、关闭移除参数、新批次更新参数且保留 artistId。 |
| duplicate-members-sheet.test.tsx | 1/1 通过：20 项成员页、独立 memberCursor、当前页之外的保留者和跨页保留选择。 |
| background-task-console.test.tsx | 仅筛选新增维护任务用例：1 通过，25 跳过。验证安全领域链接及通用控制禁用，不宣称重新通过全部 26 项。 |
| 定向 oxlint | 首次发现四处多行 if 花括号规则；限定本 UI 修正后通过。 |
| App 路径大小写检查、git diff --check | 由本批最终收口命令核对。 |

以上共 20 个不同的新增用例已通过，分批运行；不将重跑次数或既有用例叠加为更多覆盖。现有阶段二页面测试增加 Workspace 的隔离 mock，以保持原检测控制测试边界，但本轮未重跑其全文件。

## 交接和未完成验收

- 等待数据端将共享 DTO 对应方法接入 artworkDedup router 以及 lastCompletedRun。UI 已直接消费 job-contracts 导出，未私造 API 或 DTO。数据端确认操作命令都返回 OperationDto，getOperation 返回 OperationResponseDto，listOperations 返回 items/nextCursor。
- 完整 App 类型检查由统筹在 API 就绪后一次收口；当前不能宣称完整编译或集成通过。若类型或字段不匹配，仅窄修复对应文件。
- 独立 Sol 审查和最终桌面/手机浏览器验收尚未执行。维护门禁仍由共享契约保持阶段 2，实际开放必须等待对应后端保护与独立验收。
- 尚未运行真实文件隔离/恢复/永久删除；这些行为的正确性由数据与执行器证据验证，组件测试不能替代文件系统或数据库测试。

## 2026-10-24 独立审查两项 P2 窄修

依据 [独立 UI 审查](./artwork-deduplication-ui-review-2026-10-24.md)，仅修复下列两项，保留其他协作者修改：

1. 手机选择栏使用 `bottom-[var(--app-mobile-navigation-offset)]`，桌面 `lg:bottom-0`。栏保持正常文档流的自适应高度，窄屏换行仍占据真实高度；父容器在手机端额外保留导航 offset 的末尾空间，使最后一页分页能完整滚出栏上方。按钮保持 44 px 触区。
2. ALL_RECOMMENDED 不再从当前推荐数扣除所有历史排除 ID，也不把该差值作为空选择依据。显示“当前 N 组推荐、已排除 M 组”，明确实际范围以预览为准；保持清除和准备入口。EXPLICIT 仍使用精确 ID 数量。实际组交集和冻结由既有 prepareCleanup 处理，未添加私造 DTO 或扩大后端接口，已与数据线同步。

另外，数据线已接入 nullable lastCompletedRun，按其通知只为旧检测测试 createRun 补 `lastCompletedRun: null`，未改其余检测流程。

定向验证：

- 两个相关文件只筛选 6 个用例：已有全量范围及提交语义 2 项、新增失去资格纯函数与组件回归 2 项、手机 320/390 配置的布局约束回归 2 项。首次 5 通过、1 因查询观察者的异步更新尚未进入 DOM 而失败；等待观察者显示更新结果后，仅重跑该 1 项通过。6 个不同用例均已通过；本次新增覆盖为 4 项，不把复跑次数累加。
- 组件回归先全部推荐并排除 A，再刷新为 A 不在推荐集合且 B 有资格，验证 B 保持选择、准备和清除仍可使用，请求仍携带原排除 A 的 ALL_RECOMMENDED 语义。
- 手机回归核对共享导航偏移、桌面覆盖、换行与正常文档流保留、分页顺序、44 px 操作触区。jsdom 不计算真实布局，不能据此宣称完成 320/390 像素视觉验证；仍等待最终统一浏览器验收。
- 5 个改动文件的定向 oxlint 为 0 warning / 0 error；未运行全 App build/test/typecheck 或浏览器。API 集成类型检查由数据线/统筹统一收口。

窄修代码再次冻结，交原 Sol 审查者复审，不开启下一批。
