---
status: historical
scope: 普通作品删除预检的隔离验证
last-verified: 2026-11-18
sources:
  - packages/pixishelf-job-executors/src/artwork-delete/delete-artwork.ts
  - packages/pixishelf-db/prisma/migrations/20261118000000_artwork_delete_image_reference_indexes/migration.sql
  - packages/pixishelf/tests/integration/artwork-deletion.postgres.test.ts
---

# 2026-11-18 作品删除预检的引用查询验证

- **隔离执行计划：** Linux Docker PostgreSQL 15.13，默认排序规则 `en_US.utf8`，完整 Prisma migration 链部署成功。`DELETION_VALIDATION_EXPLAIN=1` 在复制实际索引的 1,860,000 行合成临时表上准备服务生成的 SQL；custom / generic 两种计划的两支路径范围均进入 `Index Cond`，未见 `Image` 全表扫描。数据库执行时间分别为 0.046 / 0.056 ms。这是合成环境的 SQL 时间，不与生产耗时直接作倍数比较。
- **隔离 HTTP 抽样：** 单独在本机 Linux 的 Next.js 生产构建中登录合成账户，测试 11 条登记媒体和 2 个附属文件的小目录。五次只读 `artwork.previewDelete`（含 `entry=direct`）分别约 96 / 28 / 20 / 20 / 20 ms；均返回 HTTP 200、`WORK_DIRECTORY`、检查完整及预期选择清单。该抽样使用小型数据库和本地文件系统，不是大表测试或生产 NAS 验收。
- **回归：** Linux 真实 PostgreSQL 删除集成 8 项全通过（含两种索引计划）；主应用 `pnpm test` 3,839 通过、405 跳过（含其他未配置专用 fixture 的套件），`pnpm lint` 0 错误、`pnpm build` 通过，执行器与 Worker 构建通过。Windows 单独验证了现有大小写不敏感查询分支；Windows 文件删除测试遇到现有目录 `fsync` 的 `EPERM`，实际文件删除回归以 Linux 为准。

未部署生产、未应用生产迁移、未确认真实作品删除。生产发布前按[标准发布](../../operations/deployment.md#标准发布)准备同点恢复集合；上线后仍需对同类小目录做五次实际预检，每次目标不超过 2 秒。
