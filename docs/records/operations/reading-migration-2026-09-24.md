---
status: historical
scope: 阅读记录初始 migration 的隔离 PostgreSQL fixture 验证
last-verified: 2026-09-24
sources:
  - packages/pixishelf-db/prisma/migrations/20260924130000_add_artwork_reading_tracking/migration.sql
---

# 阅读记录迁移验证

环境：隔离 PostgreSQL 15；版本：20260924130000_add_artwork_reading_tracking。生产发布状态未由本记录核验。

2026-09-24 的隔离 PostgreSQL 15 演练已验证空库完整 85 条迁移和一个含 3 作品、3 媒体、2 账户的非空库从 84 条迁移升级到 85 条；升级前 custom-format dump 已校验可列出内容，SHA-256 为 `CA3AACFC9DC97FA38064BFF8F33BD21BDA24CABB71E117C8E608D25B7C31D5E8`，原行数保留，三个作品版本为 1，阅读表为空。这证明该合成 fixture 的迁移路径，不替代生产数据检查点或完整媒体恢复演练。功能验收记录见[作品阅读记录与进度](../../features/artwork-reading.md)。
