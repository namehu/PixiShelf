---
status: historical
scope: 第四阶段 App 单作品元数据和媒体排序守卫的独立差异审查；门禁保持3
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - docs/records/artwork-deduplication-app-structure-guards-2026-10-24.md
  - docs/security/access-control.md
  - packages/pixishelf/services/artwork-service/index.ts
  - packages/pixishelf/services/artwork-service/image-manager.ts
  - packages/pixishelf/services/artwork-service/__tests__/artwork-dedup-structure.postgres.test.ts
---

# 单作品元数据和排序守卫独立审查

2026-10-24，分支 `codex/artwork-deduplication`，基线 `6e8d4f4c98514c96233404e02acb241f0a1be20f` 上的冻结未提交小批。审查者未参与实现。本批差异未发现阻断问题，门禁保持3。

## 范围与方法

生产差异仅为 [artwork-service/index.ts](../../packages/pixishelf/services/artwork-service/index.ts) 的 updateArtwork 和 [image-manager.ts](../../packages/pixishelf/services/artwork-service/image-manager.ts) 的 reorderArtworkImages 各新增一个导入与 STRUCTURE 守卫调用。检查新 [PostgreSQL 测试](../../packages/pixishelf/services/artwork-service/__tests__/artwork-dedup-structure.postgres.test.ts) 和既有 update-artwork-tags/image-manager 单测的守卫 mock。定向读取两个完整函数、editArtworkCreators 和现有路由错误传播，以核验所有分支及锁序。

按 [App 接线分类](../design/artwork-deduplication/app-write-guards.md) 和 [权限边界](../security/access-control.md) 限定范围。复用已审查的 App 错误适配器与 DB Claim 守卫；没有修改或重审其冻结产品实现。没有扩大到艺术家或标签的全局级联、删除、文件写入、媒体注册或来源发布。

读取原始日志 `/private/tmp/dedup-structure-pg.log` 与 `/private/tmp/dedup-structure-unit.log`，分别记录新 PG 2/2通过（290ms）、既有定向单测9/9通过（文件删除2例跳过）。App TypeScript 通过取自[实现记录](./artwork-deduplication-app-structure-guards-2026-10-24.md)，对应 types 日志为空。本审查未独立重跑这些检查，没有连接数据库或访问媒体，没有执行全量测试、构建、规模或图示检查。产品代码全程只读，只新增本记录。

冻结文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `artwork-service/index.ts` | `7f33404effed633ffaf5c5a42045b04b16e57c7a1bb491d77a5615ede7867ba1` |
| `artwork-service/image-manager.ts` | `d4328b9b0b007c5c20994a3888e0cb2bddbc80c42f33ceccafc083112c266088` |
| `artwork-dedup-structure.postgres.test.ts` | `24bf1431b782b5dcd3706347fb12c74146a405c6c027dccff61b3b6edb47fbfa` |

## 核验结论

| 核验点 | 代码位置与结论 |
| --- | --- |
| update 的统一前置 | index.ts 第405–408行在同一事务中执行守卫。标题/说明、sourceDate、tags、creatorIds、artistId 以及它们的组合均经过该点；事务前仅构造数据和转换日期，没有数据库写入。守卫早于第420行 artwork.update、第422行 editArtworkCreators 和第429–435行标签删除/创建。 |
| 锁序与无残留 | 含 creatorIds/artistId 时第406–407行先取得既有 creator catalog，再由守卫锁 Artwork；editArtworkCreators 后续重复取得的是已持有的同一 catalog 锁。文本、标签和日期单独更新也先锁 Artwork；不取得来源或根锁。Claim 冲突发生在首个实际写入前，两个角色均拒绝 STRUCTURE，调用方没有捕获后继续提交的路径。 |
| 排序原语与 CAS | image-manager.ts 第243–248行沿用原事务和 Artwork 锁，在读取顺序及写 sortOrder 前执行守卫。第257–261行仍逐项比较 expectedImageIds；第264–274行仍要求新顺序包含所有成员恰好一次；第277–281行顺序更新仍处于同一事务。没有弱化旧编辑器的冲突检测或成员归属检查。 |
| 原行为与错误 | 无 Claim 时继续原文本 override、日期转换、SOURCE 标签保留和 MANUAL/LEGACY 标签替换流程；本批没有重写这些逻辑。共享编辑仍由原 authProcedure 保护，未增加 expectedUserId 或改变 Session 语义。排序路由只转换既有 ArtworkImageOrderError，新的固定维护 CONFLICT 继续原样抛出；未知异常也未吞掉。 |
| 新 PG 与旧 mock | 新 PG 使用真实 App 服务和 DB 守卫、直接持久化 keeper/copy Claim；五类 update 输入和排序均拒绝，作品行、标签关系、创作者关系及媒体行前后相同。无声明样本验证原元数据/标签行为和排序，再以旧 expectedImageIds 重放确认拒绝且新顺序不变。既有两个单测仅 mock 新适配器，不影响新 PG 的真实守卫。 |

## 限制与交付检查

新 PG 的创作者输入分别使用 `creatorIds: []` 与 `artistId: null`，证明两个分支在现存 Claim 下拒绝；非空新增归属也经过相同统一守卫，但未单独作为本 PG 样本。状态快照比较 artworkArtist 关系，没有单独比较 evidence 或 discovery 表；代码位置已核验在调用整个 editArtworkCreators 之前拒绝，不将其描述为那些下游表已被逐表测试。

没有新增双连接 App 并发用例；本批串行语义沿用已审查的 Artwork 行锁及前一 claims 批证据。所有剩余结构级联、文件/来源写入口和 D4-02 全矩阵仍按分类表后续验收，本记录不扩展结论。

受影响既有文件 `git diff --check` 无输出，主应用大写路径扫描无命中。新增记录运行 `pnpm docs:check`，结果保存于 `/private/tmp/dedup-app-structure-guards-review-docs.log`。本批没有图源改动，不运行图示生成或检查。
