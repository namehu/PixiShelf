---
status: historical
scope: v0.55.12 旧去重历史只读契约的测试修正与 patch 交接
last-verified: 2026-10-31
sources:
  - packages/pixishelf/services/__tests__/artwork-dedup-display.test.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# v0.55.12 旧去重历史测试修复

[v0.55.11 CI run 41192984456](https://github.com/namehu/PixiShelf/actions/runs/41192984456) 的唯一失败是 Web 单元测试中五条过时断言：旧去重历史仍被期待允许 CANCEL／STOP／DIRECT_DELETE 或重新导入。当前历史 DTO 已只读，返回空动作及 `canAllowReimport=false`。该 run 的 Worker／WebP、Web lint／typecheck 成功，Web build 跳过；Web 测试为 493 文件／3,678 tests 通过、1 文件／5 tests 失败、43 文件／292 tests 跳过。

本次只将 `artwork-dedup-display.test.ts` 的期望对齐当前只读契约，保留历史证据与隐私断言，不修改运行时代码、工作流、权限或迁移，也不改写 [v0.55.11 交接](./mp4-streaming-optimization-release-2026-10-31.md)和原失败证据。

先用 `pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-display.test.ts` 复现原五项失败。修正后执行 `pnpm --filter @pixishelf/next exec vitest run services/__tests__/artwork-dedup-display.test.ts services/__tests__/artwork-dedup-direct-delete-candidate.test.ts services/__tests__/artwork-dedup-direct-delete-disabled.test.ts server/routers/__tests__/artwork-delete-auth.test.ts`：四文件 16 tests 通过（5＋2＋2＋7，3.70s）。`pnpm --filter @pixishelf/next exec oxlint services/__tests__/artwork-dedup-display.test.ts` 为 0 warnings／0 errors；whitespace 与主应用路径检查通过。上述定向命令由实施者执行，发布整合不重复运行。

fetch 后 main 与 origin/main 均为 `c123f9b5`，最新规范标签为 `v0.55.11`；本次追加附注标签 `v0.55.12`，与 main 原子推送，不移动旧 tag 或强推。版本继续由 tag 注入 `APP_VERSION`，不改 package versions／锁文件。NAS 由用户更新，继承迁移边界沿用上版交接；本次不执行部署、迁移或重复全量验证。推送仅以 Git 返回为证据，不等待或轮询新 CI／镜像状态。
