---
status: historical
scope: 同艺术家作品去重第二阶段最小检测入口、进度控制与组件验证
last-verified: 2026-10-23
sources:
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-run-status.tsx
  - packages/pixishelf/app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx
  - packages/pixishelf/app/admin/tasks/_components/__tests__/background-task-console.test.tsx
  - docs/design/artwork-deduplication/phase-2-contracts.md
---

# 第二阶段检测 UI 实施与验证

日期：2026-10-23。工作树为 `artwork-deduplication`，阶段 1 基线提交 `79b19167`；本文记录尚未提交的阶段 2 UI 改动，不代表生产部署或浏览器验收。实施使用 GPT-6 Astra；独立审查由主流程另行组织。

## 实施范围

艺术家详情增加“检查重复”，进入 `/admin/duplicates?artistId=…`。检测页沿用 AdminWorkbench、PageHeader、系统字体及现有蓝色语义 token，内容宽度约 1040px，无额外统计卡墙。复用既有 shadcn Button、ToggleGroup、Progress、Alert、Empty、DropdownMenu 等组件，依据仓库 frontend-design 与 shadcn 指南实现。

首次进入按艺术家向服务端查询活动或最近的 run；任务中心和启动成功后的地址使用稳定 runId。状态、冻结范围、已处理数量、模式和可用控制均来自固定 DTO，不依赖 localStorage，不用计时器推算进度。区分等待、检查中、暂停中、已暂停、取消中、已取消、失败、完成无重复、完成有未检查项和没有作品；失败诊断按需展开，只展示服务端脱敏 code/message。

启动提供增量/完整模式；控制包括服务端允许的暂停、继续、取消与重试。每次写调用携带 expectedUserId、幂等键；控制另带 expectedVersion。同步 ref 锁阻止快速重复提交，未确认响应保留同意图幂等键并重新查询，明确点击重试才再次提交。账户或地址变化重建意图作用域，卸载后忽略迟到响应并清理对应检测查询缓存。

任务中心显示“检查重复作品”，运行行和任务详情可跳转检测页。入口只消费通过 payload schema 校验的 runId；去重任务不显示通用暂停/继续/取消/重试/优先级编辑，防止 UI 指向拒绝领域约束的通用入口。

本阶段未实现第三阶段组审核、隔离或清理，没有占位操作按钮。新增操作触区至少 44px；内容底部预留安全区，复用全局隐私遮蔽标记处理艺术家名称。

## 定向验证

环境：本机工作树、Vitest/jsdom、合成 DTO、真实 React Query 和组件交互；tRPC 传输及 Session 为测试桩。未访问真实数据库、媒体或运行服务。

| 检查 | 命令/范围 | 结果 |
| --- | --- | --- |
| 组件 | `pnpm exec vitest run app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx app/admin/tasks/_components/__tests__/background-task-console.test.tsx`（主应用目录） | 2 个文件、38 项通过；检测页新增 13 项、任务中心 25 项（既有 24 项及新增 1 项），总数不重复叠加 |
| 静态 | `pnpm exec oxlint` 指向本阶段 11 个新增/修改 UI 文件 | 0 warnings、0 errors |
| 路径 | `rg --files packages/pixishelf` 接全大写路径筛选 | 无命中 |
| 差异 | `git diff --check` | 通过 |

组件验证覆盖模式选择、快速重复启动、按艺术家/runId恢复、服务端控制可用性、真实进度、暂停确认后继续、取消中状态、原 run 失败重试、未知响应复用幂等键、原始错误不外显、切账户丢弃迟到响应、网络失败保留状态并禁用过期控制、无作品和局部失败不冒充零重复；同时以 StrictMode 运行页面作用域测试。

首次定向 lint 发现三处多行 if 的花括号规范问题，已修正并复查通过；没有改变测试断言或扩大 mock 来消除失败。

## 限制与收口

遵循用户最新验证频率要求，本阶段没有浏览器操作、全量 App test/build 或真实服务验证。App typecheck、独立代码审查及文档检查由主流程统一收口；最终浏览器验收仍需核对桌面/手机布局、暗色、键盘、菜单焦点和安全区。jsdom 结果不能代替真实浏览器、真实 Worker 状态/版本及持久数据库验收。

## 独立审查问题修复

2026-10-23，针对[独立 UI 审查](./artwork-deduplication-phase-2-ui-review-2026-10-23.md)的两项 P2，仅修改检测页提交流程及相邻组件测试，未扩展 UI 范围、未提交 Git。

1. 控制响应回写改用 cache updater：同 runId 保留较高 version；同版本优先保留已查询的状态。若 artistId 查询已切到另一条 run，旧控制响应不会切回。start 可以替换提交时看到的旧 run，不跨 run 比较 version；若查询已先行发现另一条更新 run，则保留该身份，URL 采用最终接受的 DTO。
2. 幂等键生成复用既有 `createBrowserUuid`，支持没有原生 `crypto.randomUUID` 的环境；签名与 UUID 准备纳入 `try/finally`。同步准备失败会显示现有错误提示、重新查询并释放提交锁，不会把页面永久卡在 pending。

本次只运行新增针对性用例：

```bash
pnpm exec vitest run app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx -t 'late control|accepts a new run|fallback UUIDs|UUID preparation'
pnpm exec oxlint app/admin/duplicates/_components/duplicate-check-page.tsx app/admin/duplicates/_components/__tests__/duplicate-check-page.test.tsx
```

结果：6 项通过，检测页既有 13 项因名称过滤未运行；两份改动文件 lint 为 0 warnings、0 errors。新增用例分别验证同 run 的 v5 状态及 allowedControls/后续 expectedVersion 不被迟到 v4 回退，不同 run 不被旧控制切回，start 正常接受新身份且不覆盖后来查询的身份，UUID fallback 保持快速点击去重和未知响应重试的同一幂等键，以及随机源抛错后按钮可再次提交。没有重新运行此前的 38 项整体套件，不把历史与本次执行拼成新的整体通过总数。

修复后独立窄复审由原审查者执行；本段仅记录实施者修复和定向验证，不提前宣称复审通过。App 类型收口、文档检查和最终浏览器验收仍由主流程统一处理。
