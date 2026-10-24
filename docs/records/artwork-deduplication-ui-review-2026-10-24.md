---
status: historical
scope: 去重第三至第五阶段 UI 首批未提交改动的独立静态窄审
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-ui-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/ui-design.md
  - packages/pixishelf/app/admin/duplicates
  - packages/pixishelf/app/admin/tasks/_components/background-task-format.ts
  - packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts
---

# 去重 UI 首批独立审查

2026-10-24 在工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication`、基准 HEAD `c2d6be73` 上审查第一批未提交 UI。审查者为独立 GPT-6.1 Sol，上下文不依赖实现者的推理；仅新增本文，没有修改应用、测试、后端或门禁。

结论：首审发现 **2 项 P2，现均经窄复审确认修复**；本次修复及相邻状态逻辑未发现新增问题。未发现确定的 P0/P1。这不代表阶段三至五可以开放：共享 `ARTWORK_DEDUP_RELEASE_STAGE` 仍为 2；API 集成、独立文件/数据库验证和统一浏览器验收不在本次通过结论范围内。

## 范围与依据

- 已读工程指南、文档入口、产品基线、权限边界、第三至第五阶段计划、页面设计、阶段三共享契约和本批 UI 证据。
- 按 `git status --short` 与 `git diff` 核对 `app/admin/duplicates/**` 的未提交实现与新增测试；对既有检查页只审本批 diff。
- 窄审任务中心维护任务的领域链接、中文动作入口和通用控制禁用，以及对应新增测试。没有扩展审查任务中心其他行为。
- 共享维护 DTO/Zod 仅作接口对照。未审正在并行修改的 router、服务、DB helper、迁移和文件执行器；已知 router 方法与 `lastCompletedRun` 尚待接入，不重复作为本轮缺陷。
- 使用 Web Interface Guidelines、Impeccable 的静态审查规则，并对照仓库 shadcn 组件与应用壳层。没有创建新视觉方向或修改全局组件。

## 首审发现与处置

### [P2] 手机固定导航会遮住跨页选择栏的操作

位置：`packages/pixishelf/app/admin/duplicates/_components/duplicate-review.tsx:213`。

触发：手机或平板宽度小于 `lg`，选择任意组后，在长结果页中使用悬停于视口底部的选择栏。这里使用 `sticky bottom-0`，而应用的手机主导航在 `components/layout/mobile-bottom-navigation.tsx:18` 使用 `fixed bottom-0 z-50`，占据至少 64px 加安全区。`AppShell` 的末尾 padding 只让内容末尾可滚出，不会把处于 sticky 状态的栏抬高。

影响：尤其在窄屏操作栏换成两行时，下方“清除选择 / 预览隔离”会落在主导航后面；用户需要滚到页面末尾才可能重新接触按钮。现有 `safe-area-inset-bottom` padding 不能补偿主导航高度。此处也直接偏离页面设计要求的浮动栏位置。

最小修复：在小于 `lg` 时将选择栏的 bottom 设为 `var(--app-mobile-navigation-offset)`，桌面仍为 0；为最后一页内容留出与栏实际高度匹配的空间。对应窄验证应覆盖 320px/390px 下栏换行时按钮和分页没有被遮挡。此结论来自壳层与定位代码，尚未宣称浏览器视觉复现。

复审状态：**已修复**。现 `duplicate-review.tsx:214` 使用导航 offset 与 `lg:bottom-0`；栏保持 sticky 和 flex-wrap，在正常文档流中保留自适应高度，`duplicate-review.tsx:129` 为手机端额外保留导航 offset 的末尾空间。分页在栏之前，两个操作保留 `min-h-11`。静态定位冲突已解除；320px/390px DOM 约束测试不替代真实视觉、软键盘或安全区验收。

### [P2] 全部推荐的排除项失去资格后，范围可能错误归零

位置：`packages/pixishelf/app/admin/duplicates/_components/duplicate-selection.ts:34`；受影响入口为 `duplicate-review.tsx:104` 和 `duplicate-review.tsx:211`。

触发：先选择全部推荐，并排除 A 组；随后查询得到新的推荐数，A 因内容/资格变化已不再包含于推荐数，而 B 组仍有资格。`excludedGroupIds` 仍保留 A，但 summary 无条件从新的推荐数扣除所有排除 ID。有效输入为 `recommendedGroupCount=1`、`excludedGroupIds=['A']`，实际仍选中 B，显示结果却为 0。

影响：有剩余有效组时操作栏会被隐藏，`prepareSelection` 也拒绝提交，用户甚至失去清除这次全部推荐选择的入口。更一般地，扣除了已不在推荐集合中的排除项时，显示数量会小于实际范围。后续服务端冻结预览仍可保护实际文件授权，因此本项未定为不可逆操作漏洞。

最小修复：不要把“当前推荐总数减历史排除数”当作精确实际范围或空选择依据。未取得服务端交集计数时，全部推荐模式可以显示“当前 N 组推荐、已排除 M 组；实际范围以预览为准”，并保留清除/准备入口；或者由服务端提供当前推荐集合与排除集合的交集计数。显式模式仍可按 ID 数判断为空。补充 A 失去资格、B 仍有效的定向用例。

首审对修复前实现的纯函数复现结果为：

```json
{ "displayed": { "groups": 0, "copies": null }, "remainingEligibleGroupSelected": true }
```

复审状态：**已修复**。现 `duplicate-selection.ts:35` 的 ALL_RECOMMENDED summary 返回 `groups: null`，分别携带推荐数和历史排除数；`duplicate-review.tsx:52` 将该模式视为仍有选择意图，`duplicate-review.tsx:105` 只拒绝明确为 0 的显式范围，`duplicate-review.tsx:219` 明示两个计数及“实际范围以预览为准”。清除回到空 EXPLICIT；PREPARE 保持原 ALL_RECOMMENDED/excludedGroupIds 输入，未通过前端猜测交集或扩大范围。

## 已核对的保护

- 账户和 run/batch 的组件 key 隔离本地选择，查询输入带 `expectedUserId`；`useDuplicateIntent` 在同步 ref 上锁，并在卸载后忽略迟到回调。
- 已保存审核按较高 `reviewVersion` 合并，准备使用已知较高 `reviewRevision`；所选组的未保存草稿阻断准备。保留选择与清理勾选独立。
- ALL_RECOMMENDED 请求发送服务端范围语义及排除项，不发送当前页冒充全量；组页、成员页和清单页固定 20 项，游标独立。
- 操作摘要以 operation ID、业务版本及更新时间抑制较旧结果；确认组件 key 绑定 operation/version/purgePreview.version，版本变化清空确认。
- 隔离、恢复、永久清理和重导入口消费服务端 `allowedActions`。隔离要求 READY；新永久清理要求 ISOLATED 与 READY purgePreview，提交带 `expectedPurgePreviewVersion`。原 PURGE 的恢复处理不暴露新恢复或重新预检路径。
- 原范围重新准备发送 `sourceOperationId/expectedOperationVersion`，原动作重试不重新拼装已加载组或文件；重导明确选择 TOMBSTONE 来源及 generation，并说明不会恢复文件。
- 组件只展示自己的整理明细与他人的保护布尔提示；作品标题与缩略图沿用隐私标记。未见浏览器自行计算或展示他人私有标记细节的代码。
- 新增按钮、分页和选择标签使用至少 44px 的命中区域；两层详情均有标题、说明、关闭与焦点返回，沿用系统 token。最终手机布局和键盘行为仍须浏览器核验。

## 验证与限制

| 内容                        | 本轮结果                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 静态差异与新增测试审阅      | 已完成上述冻结范围；没有审后端半成品                                                                                     |
| ALL_RECOMMENDED 边界复现    | 通过 `pnpm exec node --import tsx -e ...` 直接调用现有纯函数，复现错误归零；不访问数据库、媒体或网络                     |
| Impeccable 静态 detector    | `impeccable detect --json packages/pixishelf/app/admin/duplicates` 返回 `[]`；正则扫描不能发现本记录的状态与壳层定位问题 |
| 应用路径大小写              | `rg --files packages/pixishelf \| rg '[A-Z]'` 无匹配，退出码 1 表示未发现大写路径                                        |
| 冻结范围 diff whitespace    | `git diff --check -- <冻结 UI 范围>` 通过                                                                                |
| 文档检查                    | `pnpm docs:check` 通过，检查 212 个 Markdown 的本地链接、锚点、路径大小写与代码围栏                                      |
| 实现者已运行的定向测试/lint | 仅审阅既有 [UI 证据](./artwork-deduplication-ui-2026-10-24.md) 和测试代码，未将其 20 个新增用例重新运行或算作本轮执行    |
| 浏览器、真实图库、数据库    | 均未使用；按用户要求留最终统一验收                                                                                       |
| 全 App build/test/typecheck | 均未运行；共享 API 就绪后由统筹统一收口                                                                                  |

工具准备曾尝试当前 CLI 不支持的 `impeccable audit --format json`、`detect --format json`，随后按帮助使用 `detect --json` 成功；没有将前两次视作扫描通过。纯函数首个 tsx CLI 调用因沙箱 IPC `EPERM` 失败，ESM 命名导入又遇到 CJS 导出形式，最终以 Node 的 tsx loader + require 成功执行，无需提升权限。

本轮是静态窄审，不给出冒充实测的视觉/对比度/性能总分。没有图源变更；`docs:diagrams:check` 的脚本即使在 check 模式也会启动 Chromium，故按本轮禁止浏览器的约束未执行，留给统筹最终汇总。Web 审查规则取自 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。

## 2026-10-24 两项修复窄复审

同一工作树与基准 HEAD `c2d6be73` 上，仅复审 `duplicate-selection.ts`、`duplicate-review.tsx` 的上述修复及相邻空选择、准备门禁、文案、清除状态，以及相应新增回归代码。没有重开整批 UI 审查或检查并行后端；`createRun` fixture 的 `lastCompletedRun: null` 已按通知静态核对，不扩展验证旧检测流程。

- 审阅实现者 [两项 P2 窄修证据](./artwork-deduplication-ui-2026-10-24.md#2026-10-24-独立审查两项-p2-窄修) 与 6 项相关用例的结果，包含 2 项既有语义覆盖及 4 项新增覆盖；本复审没有重复运行这 6 项或 5 文件 lint。
- 独立通过 `pnpm exec node --import tsx -e ...` 调用修复后的现有函数：A 已排除、当前推荐数为 1 时，summary 为 `groups:null/recommendedGroups:1/excludedGroups:1`，B 仍选中，输入仍为 `ALL_RECOMMENDED/excludedGroupIds:['A']`。空显式选择仍返回 `groups:0/copies:0`。
- 原来的同步意图锁、未保存草稿阻断、服务端 allowedActions、账户与版本输入均保留；相邻逻辑未发现新增问题。两项问题关闭。
- 更新后 `pnpm docs:check` 通过，核对 213 个 Markdown；没有图源变更，图示检查仍按禁止浏览器的约束留最终收口。
- 仅更新本审查记录；没有运行全 App 检查、浏览器、真实图库或数据库。手机实际遮挡、触控和动态视口表现仍留最终统一浏览器验收。共享发布门禁静态核对仍为 2。
