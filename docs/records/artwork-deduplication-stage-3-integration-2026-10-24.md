---
status: historical
scope: 共享阶段门禁3与真实领域API到PREPARE队列执行的窄集成证明
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/03-review.md
  - docs/records/artwork-deduplication-stage-3-data-review-2026-10-24.md
  - packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts
  - packages/pixishelf/services/__tests__/artwork-dedup-stage3-integration.postgres.test.ts
---

# 阶段三门禁与最小串联

数据与Worker编排独立审查正式通过后，按统筹授权将单一共享 `ARTWORK_DEDUP_RELEASE_STAGE` 从2推进至3。只开放查看、保存审核、PREPARE/ISOLATION目的的只读准备与预览，以及已定义的PREPARE控制。隔离、恢复、永久清理、PREPARE/PURGE预检和显式重导继续由真实API及执行器门禁拒绝，不能凭UI或类型注册绕过。

本批无迁移、无产品文件动作、无声明或写入口guard扩展。工作树未提交；仍需本批窄差异独立复核，不将该常量推进解释为完整最终验收。

## 集成范围与结果

新增 `artwork-dedup-stage3-integration.postgres.test.ts`，使用专用 `dedup_data_next`、正式110及 `/tmp` 合成媒体。唯一替换为App默认Prisma模块注入显式专库；未mock共享门禁、tRPC router/procedure、领域service、队列repository、执行器或受控reader。tRPC in-process caller提供合成的已鉴权Context，实际authProcedure检查仍执行；不声称这验证真实Cookie签名、HTTP proxy或浏览器登录。

单个场景先通过真实start API、队列claim与SCAN生成检测证据，再串联：

1. listGroups返回可用审核/准备动作；匿名、切换账户的prepareCleanup拒绝。
2. prepareCleanup经Zod/领域事务创建BUILDING操作和SYSTEM/900/BACKGROUND_WRITER任务；同输入幂等返回原operationId。
3. 真队列claim后执行维护executor与真实child，完成两部作品的只读清单；getOperation返回READY、2文件、8字节副本容量、1保留/1副本，且无高级allowedActions。
4. 新建caller模拟刷新，仍能以稳定operationId查询同一结果；列表可发现该操作，原幂等输入仍返回原操作。换账户expectedUserId被拒绝。
5. isolate/restore/preparePurge/purge/allowReimport均通过实际路由输入校验后返回FORBIDDEN。
6. 在副本独占目录增加一个未登记附件，再次通过prepareCleanup生成新操作并执行；结果FAILED/INVENTORY_BLOCKED，文件页保留requiresReview+BLOCKED，容量未知，不能ISOLATE。原登记媒体字节不变。这里BLOCKED是文件状态，操作状态按现有契约为FAILED。

首跑1/1通过，用例约3.6秒，日志 `/tmp/dedup-stage3-gate-integration.log`。fixture清理仅本轮ID/根身份及临时目录，未触碰scale、真实数据库或媒体。

## Gate直接影响的验证

- 维护共享契约2/2：`/tmp/dedup-stage3-gate-contracts.log`。PREPARE/ISOLATION开放，PREPARE/PURGE及ISOLATE/RESTORE/PURGE关闭。
- 审核及操作按钮组件13/13：`/tmp/dedup-stage3-gate-ui.log`，仍以server allowedActions显示真实可执行动作。没有修改UI实现。
- 既有API账户/高阶段拒绝测试由“PREPARE全关闭”改为“切换账户PREPARE拒绝”；暂停继续用例去除模拟门禁，使用实际stage3。只定向选择这2项执行，2/2通过、3项跳过，日志 `/tmp/dedup-stage3-gate-api.log`；不重跑原22项全集。
- 执行器所有者将原“PREPARE关闭”门禁用例窄改为生产PURGE关闭（operation、job payload、context mode一致），只跑该1例通过，其余10例跳过；本线未修改其文件。
- App类型首轮只发现测试注入的是plain PrismaClient而生产模块静态类型为扩展client，已明确该fixture类型后做最终收口；最终App tsc通过（`/tmp/dedup-stage3-gate-app-tsc-final.log`），不涉及产品类型逃逸或新业务变更。

## 本线差异文件

- `packages/pixishelf-job-contracts/src/artwork-dedup-maintenance.ts`：单一stage常量2→3。
- `packages/pixishelf-job-contracts/src/__tests__/artwork-dedup-maintenance.test.ts`：开放/关闭集合断言。
- `packages/pixishelf/services/__tests__/artwork-dedup-stage3-integration.postgres.test.ts`：新增真实串联。
- `packages/pixishelf/services/__tests__/artwork-dedup-review-service.postgres.test.ts`：gate变化相关旧断言窄调。
- `packages/pixishelf/services/__tests__/artwork-dedup-resume.postgres.test.ts`：去掉模拟stage3。
- `docs/design/artwork-deduplication/phase-3-contracts.md`：当前开放范围。
- `docs/design/artwork-deduplication/03-review.md`：当前实施状态与剩余验收边界。
- 本记录。

执行器所有者的门禁用例更改由其负责，独立审查可一并核对；没有改任何native实现或真实文件动作。

## 未覆盖和后续门槛

本批没有浏览器、HTTP生产框架、真实Cookie、桌面/手机交互验收；没有50万PREPARE清单或性能测量，没有重跑已通过22项数据/接口与11项编排整套。最终全量主应用build/test及浏览器仍集中在最终交付。阶段四/五写入口guard、全局声明、来源hold/drain、隔离/恢复、永久清理与tombstone继续按独立门槛推进；原生文件写基础的阻断事项不在本批范围。不能用本次只读PREPARE串联代替这些验证。

冻结前文档检查224份Markdown通过（`/tmp/dedup-stage3-gate-docs.log`），主应用路径大小写检查无输出。本线18项定向验证通过（集成1、契约2、UI13、API2），另执行器所有者门禁1例通过。无运行任务、无提交，交原Sol做窄差异复核。
