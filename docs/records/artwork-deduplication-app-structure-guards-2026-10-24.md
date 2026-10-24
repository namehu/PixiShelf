---
status: historical
scope: 第四阶段 App 单作品元数据与媒体排序声明守卫小批
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/app-write-guards.md
  - packages/pixishelf/services/artwork-service/index.ts
  - packages/pixishelf/services/artwork-service/image-manager.ts
  - packages/pixishelf/services/artwork-service/__tests__/artwork-dedup-structure.postgres.test.ts
---

# 单作品元数据和排序守卫

2026-10-24，worktree artwork-deduplication/PixiShelf，基线 6e8d4f4c 的未提交小批。共享门禁仍为3；没有文件动作、迁移或新来源捕获字段。复用已通过独立审查的 App 声明错误适配器。

## 冻结改动

- packages/pixishelf/services/artwork-service/index.ts：updateArtwork 原事务在必要的 creator catalog 锁后执行 STRUCTURE，早于全部元数据、手工标签与该作品创作者关系写入。标签/日期单独更新也锁 Artwork 检查 Claim。
- packages/pixishelf/services/artwork-service/image-manager.ts：只在 reorderArtworkImages 的原 Artwork 锁后执行 STRUCTURE，保留 expectedImageIds 完整顺序与成员检查。
- 同目录 **tests**/artwork-dedup-structure.postgres.test.ts（新）；update-artwork-tags.test.ts 和 image-manager.test.ts 仅 mock 新适配器以继续验证旧单元职责。
- [App 写入口设计](../design/artwork-deduplication/app-write-guards.md)第二小批和分类表同步；本记录。

生产代码合计两个导入、两个守卫调用，没有调整原 Schema、路由权限或 Session 实例共享编辑语义。未改 artist-service 全局删除/合并、全局标签级联、manual-storage、章节注册/文件路径或新建作品。

## 真实验证

只访问独立 dedup_data_next（loopback PG55432，正式迁移110）。随机前缀的用户、作品、媒体、标签、operation/Claim 由夹具创建并精确清理。Claim 直接持久化以验证实际 App 写入口，未运行认领或隔离文件流水线。

| 检查                      | 结果                      | 输出                                   |
| ------------------------- | ------------------------- | -------------------------------------- |
| 新结构 PG 文件            | 2/2 通过，290ms           | /private/tmp/dedup-structure-pg.log    |
| 原标签/文本与媒体排序单测 | 9/9 通过，文件删除2例跳过 | /private/tmp/dedup-structure-unit.log  |
| App TypeScript            | 通过            | /private/tmp/dedup-structure-types.log |

PG 覆盖 keeper/copy 的文本、手工标签、日期、creatorIds/artistId 两分支及排序拒绝，操作前后全部作品行、标签关系、创作者关系、媒体行完全相同。无声明样本证明文字 override、sourceDate、来源标签保留/手工标签清除及连续排序；重放旧 expectedImageIds 拒绝且不改变新顺序。

命令：独立测试 URL 下执行 pnpm --filter @pixishelf/next exec vitest run services/artwork-service/**tests**/artwork-dedup-structure.postgres.test.ts。旧测试仅运行 update-artwork-tags.test.ts、image-manager.test.ts，并以测试名 updateArtwork tag provenance|media ordering 筛选。未运行全量 build/test 或浏览器。

## 边界

本批覆盖两个实际服务入口，不代表全部 D4-02 结构/元数据守卫闭合。批量艺术家/标签级联、原媒体注册、章节内容、上传迟到发布、来源 generation、归档回收/恢复仍由后续小批覆盖。现有目录释放代次契约未实现，不在本批增加释放方法。完成后冻结交独立差异审查。

最终 docs:check 234份通过（/private/tmp/dedup-structure-docs.log），本批既有文件 diff --check 无错误，主应用大写路径扫描无命中。没有图源变更，不重复图示检查。
