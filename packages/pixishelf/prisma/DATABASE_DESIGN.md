# PixiShelf 数据库设计补充文档

本文档总结了 `schema.prisma` 中未体现，但通过 Migration 脚本 (`migrations/`) 直接应用到数据库中的核心逻辑、扩展和索引设计。这些逻辑对于保证数据一致性和查询性能至关重要。

## 1. 数据库扩展 (Extensions)

- **pg_trgm**: 启用了 PostgreSQL 的 Trigram 扩展。
  - **用途**: 实现高效的模糊字符串匹配（类似 `LIKE '%text%'` 但性能更好，且支持索引）。
  - **来源**: `migrations/20250906135951_enable_pg_trgm_extension`

## 2. 自动化业务逻辑 (Triggers & Functions)

为了保证数据一致性并减少应用层逻辑复杂度，部分统计字段由数据库触发器自动维护。**应用层代码无需（也不应）手动更新这些字段。**

### 2.1 标签作品计数 (`Tag.artworkCount`)
**机制**: 当 `ArtworkTag` 表发生记录插入、删除或标签变更时，数据库自动更新对应 `Tag` 的 `artworkCount` 字段。

- **触发器**:
  - `artwork_tag_after_insert_trigger`: 关联增加时，计数 +1。
  - `artwork_tag_after_delete_trigger`: 关联移除时，计数 -1。
  - `artwork_tag_after_update_trigger`: 标签变更时，旧标签 -1，新标签 +1。
- **安全函数 (`update_tag_count_safe`)**:
  - 使用 `FOR UPDATE` 行锁防止并发写入冲突。
  - 包含负数保护逻辑（计数不会低于 0）。
  - 所有操作均记录在 `TriggerLog` 表中以便审计。

### 2.2 作品点赞计数 (`Artwork.likeCount`)
**机制**: 当 `ArtworkLike` 表发生变化时，自动更新 `Artwork` 的 `likeCount`。

- **触发器**: `artwork_like_count_trigger` (监听 INSERT 和 DELETE 事件)。
- **函数**: `update_artwork_like_count()`。
- **初始化**: Migration 脚本中包含了一次性 SQL 用于校准现有数据的计数。

### 2.3 标签全文搜索 (`Tag.search_vector`)
**机制**: 为了支持高性能的多语言标签搜索，`Tag` 表维护了一个 `tsvector` 类型的列 `search_vector`（Schema 中定义为 `Unsupported("tsvector")`）。

- **触发器**: `tag_search_vector_update` (监听 BEFORE INSERT OR UPDATE)。
- **逻辑**: 自动将 `name`, `name_zh`, `name_en` 三个字段拼接并转换为向量：
  ```sql
  to_tsvector('simple',
      COALESCE(NEW.name, '') || ' ' ||
      COALESCE(NEW.name_zh, '') || ' ' ||
      COALESCE(NEW.name_en, '')
  )
  ```
  使用 `simple` 配置以避免语言特定的词干提取（Stemming），适合中英文混合环境及精确匹配需求。

### 2.4 作品图片计数 (`Artwork.imageCount`)
**机制**: 当 `Image` 表发生记录插入、删除或更新（修改归属作品）时，数据库自动更新对应 `Artwork` 的 `imageCount` 字段。

- **触发器**:
  - `artwork_image_count_trigger` (AFTER INSERT): 批量增加计数。
  - `artwork_image_count_delete_trigger` (AFTER DELETE): 批量减少计数。
  - `artwork_image_count_update_trigger` (AFTER UPDATE): 处理图片所属作品变更的情况（旧作品-1，新作品+1）。
- **优化**:
  - 采用 **语句级触发器 (FOR EACH STATEMENT)** 而非行级触发器，在批量操作时极大减少数据库 I/O 和锁竞争。
  - 逻辑封装在 `update_artwork_image_count()` 函数中。
- **初始化**: Migration 脚本中包含了全量校正 SQL。

## 3. 高级索引设计 (Advanced Indexes)

部分复杂索引无法在 Prisma Schema 中直接定义，或需要通过 Raw SQL 优化以获得最佳性能。

### 3.1 作品混合模糊搜索
- **索引名**: `artwork_title_description_trgm_idx`
- **定义**: `GIN ((title || ' ' || COALESCE(description, '')) gin_trgm_ops)`
- **用途**: 允许用户在一个搜索框中同时搜索标题和描述，且走索引查询。
- **注意**: Prisma Schema 中可能存在单独的 title/description 索引定义，但数据库层面实际生效且最高效的是这个复合 GIN 索引。

### 3.2 艺术家模糊搜索
- **索引名**: `Artist_name_idx`
- **定义**: `GIN (name gin_trgm_ops)`
- **用途**: 加速艺术家名字的模糊匹配查询。

## 4. 审计与维护 (Audit & Maintenance)

### 4.1 触发器日志 (`TriggerLog`)
- **用途**: 记录所有触发器的操作日志，用于调试自动计数逻辑是否正确，以及追踪数据变更来源。
- **表结构**: 包含 `operation` (INSERT/UPDATE/DELETE), `table_name`, `old_value`, `new_value`, `error_message` 等字段。

### 4.2 维护函数
数据库内置了以下维护函数，可在必要时（如直接操作数据库导致计数偏差后）手动调用：

| 函数名 | 描述 |
| :--- | :--- |
| `check_tag_count_consistency()` | 检查所有标签的 `artworkCount` 与实际 `ArtworkTag` 数量是否一致。返回不一致的 Tag 列表及预期值。 |
| `fix_tag_count_inconsistencies()` | 自动修复所有计数不一致的标签，并将修复操作记录到 `TriggerLog`。 |
| `cleanup_trigger_logs()` | 清理 30 天前的触发器日志，防止日志表无限膨胀。 |

## 5. Migration 文件对照参考

| Migration ID | 关键内容 |
| :--- | :--- |
| `20250906135951` | 开启 `pg_trgm`，创建 Artwork Title+Description 混合 GIN 索引 |
| `20250929092056` | 创建 `TriggerLog` 表，添加 Tag 计数触发器 (`ArtworkTag`) 与维护函数 |
| `20250929103727` | 添加 Tag 搜索向量列 (`search_vector`) 及基础更新触发器 |
| `20251001054605` | 更新 Tag 搜索触发器以支持 `name_en` (多语言搜索) |
| `20251003034237` | 添加作品点赞计数触发器 (`ArtworkLike`) |
| `20260203000000` | 添加作品图片计数触发器 (`Artwork.imageCount`, 语句级优化) |
| `20260227003621` | 重构认证系统 (BetterAuth)，User -> UserBA，并清理无效 ArtworkLike 数据 |
