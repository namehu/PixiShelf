---
status: current
scope: 艺术家多来源身份、Pixiv 资料人工补全、图片发布与兼容迁移
last-verified: 2026-08-25
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/server/routers/artist.ts
  - packages/pixishelf/services/pixiv-artist-enrichment-service.ts
  - packages/pixishelf-job-executors/src/pixiv-artist/
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
---

# Pixiv 艺术家补全

艺术家来源身份由 `ArtistExternalRef` 表达，不再把 `Artist.userId` 解释为 Pixiv 身份。一个 Artist 可以同时具有本地目录映射、Pixiv 身份或其他未来 Provider 身份；同一 Provider 在一个 Artist 上最多一条身份，同一个 Provider 外部 ID 也最多归属一个 Artist。本地目录来源继续由 `LocalImportArtistMapping` 维护，手工创建且没有任何来源关系的艺术家显示为“手工”。

`Artist.userId` 只在兼容发布周期内保留为回滚镜像。新建手工艺术家不再生成 `p_{id}`，创建和编辑接口使用 `pixivUserId` 管理正式 Pixiv 身份。物理删列必须等稳定运行一个发布周期后，通过独立 migration 完成。

## 迁移与审计

迁移只自动认领同时满足以下条件的历史 Artist：

- `userId` 是不以零开头的正整数字符串；
- 名下至少一个 Artwork 具有 `providerKey=pixiv` 的正式作品来源引用；
- 整个 Artist 表中只有一个 Artist 使用该数字 ID。

重复数字 ID、没有作品来源证据的数字 ID 和 `p_{id}` 都不会被自动认领。管理员可在编辑框看到未确认的历史数字 ID，并必须点击确认后才会建立 Pixiv 外部身份。

上线前运行只读 [artist-source-identity-audit.sql](../../packages/pixishelf-db/prisma/diagnostics/artist-source-identity-audit.sql)，记录自动认领数量、重复 ID 和无来源证据 ID；迁移后运行 [artist-external-ref-verification.sql](../../packages/pixishelf-db/prisma/diagnostics/artist-external-ref-verification.sql)，`missing_expected_claims` 和 `duplicate_provider_identities` 必须为零。审计 SQL 不修改数据。

## 补全任务

`PIXIV_ARTIST_ENRICHMENT` 运行在 `BACKGROUND_WRITER`，只由管理员手工启动：

1. `DISCOVER` 默认发现下一批最多 200 个 `providerKey=pixiv` 且尚未检查的身份；多选模式最多重查 200 个已确认身份；管理员也可以显式开启“刷新已有资料”，按最久未检查顺序刷新下一批或只刷新所选身份；
2. 每个 `ARTIST` 子任务冻结 Artist ID、外部引用 ID 和 Pixiv UserID，执行前与发布事务内都重新校验身份；
3. Worker 查询 Pixiv 用户 Ajax 接口并保存来源姓名；默认模式只在 Artist 对应字段仍为空时发布头像或背景图，刷新模式会重新下载并替换已有图片；
4. Pixiv 来源姓名不会覆盖 `Artist.name`，管理员可以在列表中逐项采用；
5. 任务支持整批取消、单项重试和页面刷新后的进度恢复。默认批次跳过 `SUCCESS`、`PARTIAL`、`NO_DATA`、`FAILED` 等所有已检查状态。

| 状态      | 含义                                               |
| --------- | -------------------------------------------------- |
| `SUCCESS` | 用户响应有效，所需图片均已保存                     |
| `PARTIAL` | 用户响应有效，但头像或背景图下载/校验失败          |
| `NO_DATA` | Pixiv 明确无此用户或响应中没有可用姓名和图片       |
| `FAILED`  | 请求失败、重试耗尽、身份不一致或响应契约不符合预期 |

429 使用 `Retry-After`，临时网络错误和 5xx 使用有界指数退避。404 记录为 `NO_DATA`。响应 UserID 与冻结身份不一致时安全失败。刷新模式仅替换 Pixiv 实际返回且通过验证的图片；远端没有对应图片或下载失败时保留旧值。发布前还会比较任务读取时与事务内的图片字段，管理员在任务期间刚做的修改不会被旧任务覆盖。

## 图片存储与读取

头像和背景图写入现有 `PIXISHELF_PUBLIC_DATA_PATH`：

```text
pixiv_data/artists/<pixiv-user-id>/avatar-<sha256>.<真实扩展名>
pixiv_data/artists/<pixiv-user-id>/background-<sha256>.<真实扩展名>
```

Worker 仅接受 HTTPS `i.pximg.net`，每次重定向重新校验主机，并限制响应体、格式、像素数和尺寸。Sharp 验证成功后按内容哈希命名，先写同目录临时文件，再原子发布；相同内容直接复用，变化后的图片使用新 URL，避免旧缓存遮住刷新结果。数据库只保存文件名；App 通过受 Session 保护的 `/api/pixiv-data/artists/...` 读取。App 对该目录只读，Worker 对同一挂载读写，因此 PostgreSQL 与 `pixiv_data` 必须位于同一备份和恢复检查点。

## 扩展边界

浏览器扩展不再提供用户 ID 采集、作者图片下载或 Artist SQL 生成。这些能力由 Next 管理页、正式外部身份表和持久 Worker 任务统一承担。E-Hentai 本期只保留未来 Provider 扩展能力，不把 `artist/group` 标签转换成 Artist；Artwork 与 Artist 的单一关联也不在本期改造。
