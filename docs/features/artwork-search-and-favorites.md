---
status: current
scope: 当前账户喜欢筛选、标签搜索建议与多语言名称匹配
last-verified: 2026-10-22
sources:
  - packages/pixishelf/schemas/artwork.dto.ts
  - packages/pixishelf/services/artwork-service/query-builder.ts
  - packages/pixishelf/lib/artwork-query-snapshot.ts
  - packages/pixishelf/app/artworks/_components/search-box.tsx
  - packages/pixishelf/services/search-service.ts
  - packages/pixishelf/services/tag-service.ts
---

# 作品搜索与我的喜欢

本文维护喜欢集合的浏览规则与标签名称查找。预设保存、应用及并发规则见[快捷筛选](./artwork-quick-filters.md)，候选及分页见[查询架构](../architecture/artwork-feed-query-performance.md)。不新增收藏夹、标签别名或来源实体合并。

## 我的喜欢

- 共享筛选面板提供“只看我的喜欢”，与关键词、标签、媒体、来源、阅读状态、日期及排序组合，复用当前账户的 `ArtworkLike`。没有喜欢时显示正常空结果。
- 控件沿用筛选草稿，点击应用才更新查询。清除恢复全部作品；已应用条件随 URL 刷新、作品列表与沉浸浏览跳转保留。
- `likedOnly=true` 只取当前账户喜欢；缺失或 false 取全部作品。快捷筛选保存这一条件，旧预设缺失字段默认 false，无需迁移或回填。
- 非随机喜欢列表复用既有 keyset 游标，随机列表复用随机游标；二者绑定账户及条件。取消喜欢成功后刷新该账户的集合及浏览状态，不更新其他账户缓存。动态候选不承诺数据库快照。
- 身份来自服务端 Session。`expectedUserId` 只用于拒绝账户切换后的过期查询和点赞写入，不授予其他账户的访问能力；失败不把未确认结果写入本地集合。[权限边界](../security/access-control.md)

## 标签原名与译名

- 支持标签选择的作品列表／筛选搜索框中，输入 `#` 前缀进入标签建议，例如 `#风景`；前缀不参与名称匹配，清除前缀恢复普通模式。普通作品关键词保持既有职责；仅接收关键词的其他搜索框不把 `#` 解释为标签模式。
- 建议支持 `name`、`name_zh`、`name_en` 的不区分大小写包含匹配，非空单字可查询，结果数量有界。一个标签多个名称命中只返回一次，显示去重后的原名及译名。
- 选择建议按稳定标签 ID 应用条件，不把译名当成新标签或作品关键词。标签输入在选中前仅作为本地查询，不写入作品关键词草稿。Enter 仅在有高亮建议时选择；空白、仅 `#` 或没有选中结果时，不隐式提交作品关键词或清除原有筛选。
- 标签管理复用三字段包含匹配。标签列表／选择器保留 PostgreSQL 全文索引、分词前缀匹配、相关度及分页；查询清理保留 Unicode 字母和数字，原名中的假名等字符不再被删除。

支持相同名称字段不表示各入口有相同排序或任意子串匹配：建议／管理采用包含匹配，列表仍为全文搜索。此变更不新增搜索引擎、不合并同义标签、不改变来源标签或人工覆盖。

## 验收与发布

回归覆盖喜欢的账户隔离、缺失／错误账户参数、组合筛选、普通及随机分页、取消喜欢、URL／预设往返与移动筛选；搜索覆盖原名、仅译名、大小写、单字、原语言字符、重复命中、无结果及键盘选择。

不修改数据库结构或原媒体。前后端应一起发布；旧预设保留兼容。生产发布与真机验收单独登记，本地测试不代表生产已部署。

本次实现、隔离数据库与本地验收证据见 [2026-10-22 验证记录](../records/features/artwork-search-and-favorites.md)。
