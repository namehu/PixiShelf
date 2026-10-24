---
status: historical
scope: 第二阶段检测 UI 的独立代码审查与最小回归复现
last-verified: 2026-10-23
sources:
  - packages/pixishelf/app/admin/duplicates/page.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-check-start.tsx
  - packages/pixishelf/app/admin/duplicates/_components/duplicate-run-status.tsx
  - packages/pixishelf/app/admin/tasks/_components/background-task-format.ts
  - packages/pixishelf/app/admin/tasks/_components/background-task-console.tsx
  - packages/pixishelf/app/admin/tasks/_components/background-execution-row.tsx
  - packages/pixishelf/app/artists/[id]/_components/head-info.tsx
  - packages/pixishelf/lib/background-job-labels.ts
  - docs/design/artwork-deduplication/phase-2-contracts.md
---

# 第二阶段 UI 独立审查

日期：2026-10-23。审查者 GPT-6.1 Sol，未参与本阶段实施；实施者为 GPT-6 Astra。基线为 `9c0f23bc`，审查对象为 `artwork-deduplication` 工作树中尚未提交的第二阶段 UI；不重新审查第一阶段提交 `79b19167`。本文记录修复前的审查结果，行号对应本次阅读版本。

结论：**暂不通过，发现两项 P2 问题，需修复后定向复审。** 两项均能通过最小独立复现确认。没有发现 P0/P1 问题；没有发现对固定 App DTO 的调用契约冲突。未实施的后端收口、第三阶段审核和最终浏览器检查不作为本轮 UI 缺陷。

## 发现

### P2：延迟的控制响应覆盖较新的轮询结果

位置：[duplicate-check-page.tsx:184](../../packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx#L184)，尤其第 186 行的无条件 `setQueryData`。

触发顺序：页面持有 `RUNNING/v3`，用户暂停；服务端形成 `PAUSING/v4`，该响应在网络中延迟。Worker 已确认暂停，下一次查询先取得 `PAUSED/v5`，页面显示“检查已暂停”。此时 v4 控制响应抵达，现有代码取消后续查询并无条件把 v4 写回缓存，页面回退为“正在暂停检查”，继续按钮消失。下一次轮询前若使用旧版本取消，会产生不必要的版本冲突。

独立复现使用真实 React Query、组件和延迟 mutation；先通过 `invalidateQueries` 完成 v5 查询，再交付 v4 控制响应。缓存断言应为版本 5，实际为 4。取消尚未结束的查询无法保护已经提交到缓存的较新结果。

最小修复：更新缓存时比较同一 `runId` 的服务端 `version`，保留较新 DTO；不能把不同 run 的版本直接比较。start 成功切换新 run 时仍须接受新身份并维护 URL。补充“轮询先确认暂停、旧控制响应后到”的组件回归，核对状态、`allowedControls` 和后续请求的 `expectedVersion` 都继续使用新版本。

缺失验证：既有 13 项检测页测试没有覆盖 mutation 与轮询响应倒序；本轮独立复现已明确失败。

### P2：原生 UUID API 缺失时提交锁无法释放

位置：[duplicate-check-page.tsx:157](../../packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx#L157) 和[第 165 行](../../packages/pixishelf/app/admin/duplicates/_components/duplicate-check-page.tsx#L165)。

触发条件：浏览器没有 `crypto.randomUUID`，例如普通 HTTP 局域网来源或不支持该 API 的客户端。该 API 受安全上下文限制，参见 [MDN 的 API 说明](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)。现代 HTTPS 和 localhost 环境不会因这一条件触发，因此记为 P2 兼容性问题。

`submit` 先设置 `locked.current = true` 和 pending，随后在 `try` 外直接调用 `crypto.randomUUID()`。方法不存在时 Promise 拒绝，错误提示、刷新和 `finally` 均不运行；页面保持 pending，后续启动、暂停、继续、取消或重试被锁拒绝，直到刷新页面。

独立复现直接提取当前源码中的 `submit`，经 TypeScript 转译后注入缺少 `randomUUID` 的 Crypto 桩；确认出现该 TypeError，随后锁应释放的断言实际得到 `true`。这项复现证明同步准备错误的控制流，不代表执行过真实 HTTP 浏览器验证。

最小修复：沿用已有 [createBrowserUuid](../../packages/pixishelf/lib/browser-uuid.ts)，其以 `getRandomValues` 提供 fallback；同时把可能抛错的提交准备纳入 `try/finally`。补充缺失原生 API 的定向组件用例，证明写请求仍具有稳定幂等键、一次快速点击只发一次，准备失败后也能解除 pending。

缺失验证：既有组件测试始终使用 jsdom 提供的原生 UUID，没有覆盖上述兼容分支。

## 已核对的边界

| 项目 | 审查结果与证据边界 |
| --- | --- |
| 持久发现与刷新 | 初始按 artistId 查询活动或最近 run；runId 链接按身份查询。状态来自服务端，不从 localStorage 或计时器推算。源码与固定契约一致。 |
| 账户切换 | 查询输入绑定 expectedUserId；账户/位置变化重挂载意图作用域；卸载后丢弃迟到响应并清理对应查询。既有 StrictMode 账户用例已阅读，本轮未重复运行。 |
| 快速点击和幂等 | 同步 ref 锁先于异步 mutation；未确认响应保留同意图幂等键，控制携带 runId/version/userId。上述 UUID 错误仍需修复。 |
| 状态与允许操作 | 直接消费 allowedControls；暂停中与已暂停、取消中与已取消分别呈现；查询失败保留旧状态并禁用旧控制。响应倒序问题见发现一。 |
| 失败、无作品、局部失败 | 不显示原始异常；无作品不提供启动；局部失败不宣称零重复；retry 回原 run/version。服务端 DTO 的 reader 恢复提示不会变成通用重试。 |
| 任务中心 | 新标签与 payload schema 一致；详情和运行行使用经校验、编码的真实 runId 链接；去重任务不显示通用暂停/继续/取消/重试/优先级编辑。保留“忽略提醒”不改变领域执行状态。 |
| 阶段边界 | 没有第三阶段的假审核、隔离或删除按钮；没有引入媒体读取或列表全量加载。 |
| 简洁布局与触控 | 新页沿用 AdminWorkbench、语义 token；新增按钮、模式选项和菜单项设置最小 44px，底部预留 safe-area；未增加装饰统计卡。源码可确认，真实命中区域、320px 横向溢出和安全区仍须最终浏览器确认。 |

## 独立执行与引用证据

本轮独立执行：

- 临时目录 `/private/tmp/pixishelf-phase2-ui-review` 中的两个针对性复现，命令为主应用目录执行 `pnpm exec vitest run --config /private/tmp/pixishelf-phase2-ui-review/vitest.config.ts`；1 个文件、2 项失败，分别得到 `expected 4 to be 5` 与 `expected true to be false`。临时配置首次缺少 JSX runtime alias 导致零测试加载失败，修正临时 alias 后才产生上述有效结果。
- Impeccable 机械检测仅指向本轮新增/修改 UI，输出 `[]`；没有将检测器结果当作浏览器或业务正确性证明。
- `rg --files packages/pixishelf | rg '[A-Z]'` 无命中。

复现只写 `/tmp`，不改功能源码和正式测试、不提交、不访问数据库或真实媒体。完成报告后可删除临时目录。

引用[实施记录](./artwork-deduplication-phase-2-ui-2026-10-23.md)中的 38 项通过与 11 个文件 lint 通过：38 项为检测页 13 项、任务中心 25 项（24 项既有、1 项新增）。这些是实施者执行结果，本轮没有重复运行，也不把本轮两个失败与其相加为通过总数。

## 后续放行条件与限制

由实施者修复两处问题并添加相应最小回归，再由独立审查者复审变更与结果。主流程统一执行 App 类型收口和文档检查；本轮没有运行 App 全量 lint/test/build，没有因并行后端尚未收口而扩大审查。

遵循用户最新要求，未启动浏览器。桌面/手机布局、暗色、键盘、菜单焦点、触控、安全区、真实 Worker 状态同步和完整业务操作留到最终统一验收；这些项目目前为未执行，不能写成通过。UI 静态检查参考了[仓库设计规格](../design/artwork-deduplication/ui-design.md)和 [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)，未扩大到相邻旧 UI。


## 修复后的独立窄复审

日期：2026-10-23。仍由首次审查者 GPT-6.1 Sol 执行，未参与修复实现。本次只复核 `duplicate-check-page.tsx` 提交流程及相邻测试针对上述两项 P2 的修复，不扩大 UI 或后端范围。

**最新结论：两项 P2 均已关闭，第二阶段 UI 独立代码审查通过。** 此结论替代上文修复前的暂不通过结论；首次失败证据保留。浏览器、真实 Worker 联调与 App 总体收口仍按主流程执行，本结论不覆盖这些未执行项目。

| 原发现 | 修复核对 | 窄复审结果 |
| --- | --- | --- |
| 延迟响应覆盖新版本 | 第 187–193 行使用 cache updater；相同 runId 保留较新 version，同版本保留已经查询的 DTO；不同 run 不比较版本，旧 control 不切回旧身份。start 只替换提交时看到的 run，若查询先发现其他 run 则保留；第 195–198 行 URL 取最终接受的 DTO。 | 已关闭。原组件倒序复现独立通过，v5/PAUSED 与继续按钮不再被 v4/PAUSING 回退。 |
| UUID 准备异常留下提交锁 | 第 161–168 行把签名、幂等键准备放入 try；复用 createBrowserUuid 的 getRandomValues fallback；异常进入现有错误/刷新路径，第 204–208 行 finally 释放锁和 pending。 | 已关闭。独立复现模拟缺少 randomUUID 且随机源首次抛错，确认错误后可再次提交，并在第二次请求产生 UUID v4 幂等键。 |

本轮独立执行仍为临时目录中的两个最小复现，命令未变：主应用目录执行 `pnpm exec vitest run --config /private/tmp/pixishelf-phase2-ui-review/vitest.config.ts`。结果为 **1 个文件、2 项通过**。第一项继续使用真实 React Query 和组件；第二项直接提取当前 submit 源码并注入真实 createBrowserUuid，检查准备失败后的解锁和 fallback 成功路径。这是定向控制流证据，不代表真实 HTTP 浏览器验证。

同时阅读实施者新增六项用例：同 run 的状态与后续 expectedVersion、不同 run 的身份保护、start 的新身份与查询先行边界、fallback 幂等重放、准备异常后再次提交均有明确断言。六项通过、两份改动文件 lint 与 diff 通过引用[修复记录](./artwork-deduplication-phase-2-ui-2026-10-23.md#独立审查问题修复)，本轮未重复执行这六项，也未重跑原 38 项或全 App 检查。两组证据不拼接为新的整体通过总数。

本次只更新本审查记录和 `/tmp` 复现，不改功能代码、正式测试，不提交 Git。主流程最终文档检查请包含本记录；最终桌面/手机浏览器验收仍未执行。
