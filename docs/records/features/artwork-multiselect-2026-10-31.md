---
status: historical
scope: 阅读状态与媒体类型多选的客户端回归、兼容与隔离 PostgreSQL 查询验证
last-verified: 2026-10-31
sources:
  - packages/pixishelf/schemas/__tests__/artwork-filter.test.ts
  - packages/pixishelf/app/viewer/__tests__/viewer-filters.test.tsx
  - packages/pixishelf/tests/integration/artwork-multiselect.postgres.test.ts
---

# 阅读状态与媒体类型多选验证

## 版本与环境

2026-10-31，在基线 `3b9f00a3` 加本次工作区改动上验证。当前行为见[作品搜索与我的喜欢](../../features/artwork-search-and-favorites.md#阅读状态与媒体类型)及[快捷筛选](../../features/artwork-quick-filters.md)。本记录只登记多选的聚焦检查；同轮主应用全量检查与桌面／移动浏览器验收见[统一交付记录](./preview-controls-and-filters-2026-10-31.md)，不将 jsdom 结果计作真实浏览器或生产验收。

使用独立容器 `pixishelf-filter-multiselect-20261031`、PostgreSQL 16、`127.0.0.1:55438/filter_test`。连接仅来自显式 `MULTISELECT_DATABASE_URL`；测试拒绝其他主机、端口或数据库名，不回退应用数据库配置。空库通过 `pnpm --dir packages/pixishelf-db db:deploy` 应用现有 134 条 migration，没有修改数据库结构或使用 `db:push`。

## 客户端与边界回归

主应用目录执行 `pnpm exec vitest run`，明确选择以下 15 个文件，**126 项通过**：

- `schemas/__tests__/artwork-filter.test.ts`、`lib/__tests__/artwork-query-snapshot.test.ts`。
- `services/artwork-service/__tests__/{reading-keyset,artwork-management-query,random-page-query,viewer-feed-query}.test.ts`。
- `server/routers/__tests__/reading-auth.test.ts`。
- `components/artwork/__tests__/{infinite-artwork-list-reading-return,infinite-artwork-list-source-filter,filter-sheet-source-filter,gallery-filter-sheet}.test.tsx`。
- `app/viewer/__tests__/viewer-filters.test.tsx`、`app/artists/[id]/_components/__tests__/detail-filters.test.tsx`、`app/artworks/__tests__/artworks-layout.test.tsx`。
- `lib/mobile/__tests__/feed.test.ts`。

覆盖 CSV／数组输入、去重稳定排序、非法值拒绝、显式空优先旧单值、旧 URL／预设兼容及新快照往返；两组多选的全选、清空、重置、关闭丢弃草稿和应用；预设保存、编辑及完整描述；全局 viewer 旧偏好迁移、空集合覆盖偏好、艺术家固定范围与全局偏好隔离；账户前置条件、缓存返回与滚动恢复、重新应用。独立移动 reader API 继续保持原单选契约，经共享 schema 转成集合，未扩展 Android 筛选入口。

## 隔离查询与预设

主应用目录执行：

```bash
MULTISELECT_DATABASE_URL=<isolated-url> pnpm exec vitest run tests/integration/artwork-multiselect.postgres.test.ts
```

**20 项通过**。合成样本包含无媒体、静态图片、持久 `ANIMATION`、内容探测动画 WebP、视频、静图＋视频、动图＋视频及静态 WebP。同一艺术家外另有作品；两个账户的阅读记录不同，包含缺记录及零已读／零观看摘要。

- 媒体类型全部 8 种选择子集，包括三个单选、三个两选、三选与空集合；保留旧图片 `NOT VIDEO` 语义，混合及无媒体样本结果一致。
- 阅读状态全部 8 种选择子集，计数和列表一致；同账号取并集，另一账号使用自己的记录。
- 两组之间及扩展名条件取交集，艺术家范围保留；普通、随机与 viewer 续页不重不漏。
- 规范化后等价的选择可以继续游标；条件或账户变化拒绝旧游标。
- 旧单项预设转换，新多选预设保存、编辑、三项全选保留、账户与艺术家作用域隔离及艺术家预设禁止导航固定。

## 清理与限制

测试自行清理合成记录。清理后检查确认 `_prisma_migrations` 有 134 条完成记录，`Artwork` 与 `UserBA` 均为 0；随后移除本次独立容器。不读取或改写业务库、私人媒体及运行中的其他验证容器。

本次没有数据库迁移、媒体写入或生产数据变更。新多选预设不能由只理解旧单值的应用版本准确恢复；前后端需配套发布或回退到理解集合的版本，规则见[快捷筛选恢复边界](../../features/artwork-quick-filters.md#验证与恢复)。
