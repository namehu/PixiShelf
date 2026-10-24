---
status: historical
scope: 第四阶段作品和来源声明数据库基础的独立代码审查；不代表全写入口或释放协议验收
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/design/artwork-deduplication/04-isolation.md
  - docs/records/artwork-deduplication-claims-foundation-2026-10-24.md
  - packages/pixishelf-db/src/artwork-dedup-claims.ts
  - packages/pixishelf-db/src/media-content-writes.ts
  - packages/pixishelf-db/src/index.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-claims.postgres.test.ts
---

# 作品和来源声明基础独立审查

2026-10-24，分支 `codex/artwork-deduplication`，提交基线 `6e8d4f4c98514c96233404e02acb241f0a1be20f` 上的冻结未提交改动。审查者未参与实现。本次未发现需要在本基础批修复的阻断问题；共享门禁保持3，不据此宣称第四阶段或全部生产写入口已经验收。

## 范围、方法与证据

静态审查新增 [artwork-dedup-claims.ts](../../packages/pixishelf-db/src/artwork-dedup-claims.ts)、其七项 [PostgreSQL 测试](../../packages/pixishelf-db/src/__tests__/artwork-dedup-claims.postgres.test.ts)、[media-content-writes.ts](../../packages/pixishelf-db/src/media-content-writes.ts) 中两个 begin 原语新增接点，以及 [index.ts](../../packages/pixishelf-db/src/index.ts) 的 claims 导出。定向读取既有操作执行身份检查、审核快照复核、creator catalog 和媒体根/作品锁，作为锁序与前置契约依据；没有扩大到这些既有实现的全面审查。

核对 [声明契约](../design/artwork-deduplication/claims-contracts.md)、[第四阶段设计](../design/artwork-deduplication/04-isolation.md) 与 [实现验证记录](./artwork-deduplication-claims-foundation-2026-10-24.md)。读取原始日志 `/private/tmp/dedup-claims-tests.log`、`/private/tmp/dedup-claims-media-regression.log`、`/private/tmp/dedup-claims-types.log`，确认其分别记录新 PG 7/7、既有原语 2/2（其余16跳过）和 DB TypeScript 通过。这些属于实现者的独立 loopback 专库运行证据，本审查未冒称重新执行。

没有连接数据库或访问媒体，没有执行迁移、释放、实际文件动作、native 复审、全量测试、构建、规模或图示检查；产品代码全程只读，只新增本记录。

冻结文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `artwork-dedup-claims.ts` | `ddace30ec50b940fb88d074a53ac87827a2b3e94700e141a9ae983fe66ec3823` |
| `media-content-writes.ts` | `b744b778880709c901270ae2988ac78f81ab9b93624e958dadfec130af804113` |
| `index.ts` | `6a06d5c57a7af04cced744cf1e010bd857057aba0cf0aff96238b8e19309c37b` |
| `artwork-dedup-claims.postgres.test.ts` | `c9588faaa62fbc3e3ec9fb34a2b4bbc0634c4f33113cca8c74599de6e43d31b0` |

## 核验结论

| 核验点 | 代码依据与结论 |
| --- | --- |
| 全局 keeper/copy 持久认领 | claims 第215–225行在作品升序锁和快照复核后校验全局唯一 Claim 的 operation、role、executionVersion，再集合插入；两个角色都认领，不按 artist 局部协调。跨艺术家测试保留第一项声明并交接 writer，证明后续 writer 仍被拒绝；真实锁竞争由另一双连接测试证明。 |
| fence、锁序和 CAS | claims 第152–180行复用执行身份、expectedVersion、ISOLATE/ISOLATING、准备与确认前置，依次取得 run/operation、ReviewState、既有 creator catalog 和根协调；第189–215行按 identityKey 锁来源，再由既有快照复核按 Artwork ID 升序锁作品。runtime fence 仍明确由调用者持有；没有新增反向锁或自动接管执行版本。 |
| 来源和范围复核 | claims 第138–145行从冻结文件/作品及已登记 provider 派生来源，最终快照签名复核覆盖当前来源、内容、整理及创作者变化。身份编码在捕获和认领中共用 SQL 函数；来源行持久保存。目录重叠按完整路径段匹配，根身份变化由既有根协调拒绝。 |
| 双向写入互斥 | claims 第211–220行在根锁后检查 ACTIVE/READY/RECOVERY_REQUIRED 路径声明，在作品锁后检查内容 token。两个 begin 接点分别在既有根锁、作品锁后检查 hold/Claim，以原 WRITING 语义拒绝；普通写者不反向取得 operation、catalog 或来源行锁。 |
| 回滚与重放 | 同操作同版本重放保留 operation version；已有异 operation/执行版本/角色 Claim 或异来源 generation 均拒绝。冲突向外抛出，绑定/来源/Claim 与外层事务一并回滚。测试覆盖主动回滚及冲突后的无残留。不得由调用者捕获领域异常后提交部分事务。 |
| 阅读例外及其余守卫 | claims 第107–120行先锁作品，再检查唯一 Claim；只有 KEEPER/READING 放行，COPY 阅读及所有声明作品的 ORGANIZATION/STRUCTURE/CONTENT/DELETE 拒绝。未知作品拒绝。七项 PG 中遍历两个角色和五种写类型。 |
| URL hold | claims 第122–135行由 COPY Claim、持久项目状态、来源 HOLD/TOMBSTONE 和未完成文件意图判定；不依赖普通 purgeAfter，也不依赖实际 Artwork 继续存在。带锁 assertion 用于现存作品；导出的 SQL predicate 保留缺失 Artwork 后的持久事实判断。 |

## 后续释放与发布的明确限制

位置：`artwork-dedup-claims.ts` 第66–105行。当前捕获和 publication 只比较**精确来源身份**的 generation；路径来源额外检查当前目录上下级 HOLD/TOMBSTONE。它没有把祖先目录 generation 纳入返回值。

具体场景：先捕获 `PATH a/new.jpg` 的 generation 0；以后 `DIRECTORY a` 被 HOLD，再经未来释放协议变为 OPEN 并只将该目录 generation 加1。此时 `PATH a/new.jpg` 自身仍为 OPEN/0，当前 publication 会接受旧 PATH generation 0。实现者已确认本批未实现目录释放对子路径 generation 的传播。本批没有任何释放 helper，因此该序列不能由本批 API 自身执行，未列为本批阻断问题；也不能把现有精确 provider generation 测试扩展成已经证明目录释放周期中的旧发布失效。

统筹者与实现者已锁定后续单一方案，并在[声明契约](../design/artwork-deduplication/claims-contracts.md)维护具体规则：DIRECTORY 释放须在既有根锁下将覆盖范围内既存 PATH/DIRECTORY 的 generation 一并递增，与来源变回 OPEN 原子提交。后续须增加目录 HOLD→OPEN 后旧子路径发布被拒绝的 PG 用例。当前未实现该释放方案，不能仅递增目录自身 generation 后宣称迟到发布已完整防护。

全部 App、scan、download、archive publisher、普通回收/恢复写入口、URL drain、受控文件动作及释放终态/CAS 仍是后续范围；本审查没有因其尚未接入而记作本基础批缺陷，也没有替代这些集成验收。

## 文档检查

本记录交付时 `pnpm docs:check` 通过230份 Markdown；新增记录的 `git diff --no-index --check` 无输出；主应用大写路径扫描无命中。本次没有改图源，未运行图示生成或图示检查。具体文档检查输出见 `/private/tmp/dedup-claims-review-docs.log`。
