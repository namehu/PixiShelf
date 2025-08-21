# 扫描器重构 - 对齐阶段

## 项目上下文分析

### 现有项目结构
- **技术栈**: Node.js + TypeScript + Fastify + Prisma + PostgreSQL
- **架构模式**: Monorepo (pnpm workspace) + 分层架构
- **数据库**: PostgreSQL with Prisma ORM
- **前端**: React + Vite + TailwindCSS
- **部署**: Docker + Docker Compose

### 现有扫描器分析

#### 当前实现特点
1. **FileScanner类**: 位于 `packages/api/src/services/scanner.ts`
2. **性能优化**: 已实现并发处理、批量数据库操作、流式处理
3. **进度跟踪**: 完善的SSE进度推送机制
4. **错误处理**: 完整的错误处理和恢复机制
5. **API接口**: RESTful API + SSE流式接口

#### 现有数据库模型
```prisma
model Artist {
  id        Int       @id @default(autoincrement())
  name      String    // 显示名称
  username  String?   // 解析出的用户名部分
  userId    String?   // 解析出的用户ID部分
  bio       String?
  artworks  Artwork[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  @@unique([username, userId], name: "unique_username_userid")
}

model Artwork {
  id                  Int       @id @default(autoincrement())
  title               String
  description         String?
  directoryCreatedAt  DateTime?
  imageCount          Int       @default(0)
  descriptionLength   Int       @default(0)
  images              Image[]
  artist              Artist?   @relation(fields: [artistId], references: [id])
  artistId            Int?
  artworkTags         ArtworkTag[]
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@unique([artistId, title], name: "unique_artist_title")
}

model Tag {
  id          Int       @id @default(autoincrement())
  name        String    @unique
  artworkTags ArtworkTag[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model ArtworkTag {
  id        Int      @id @default(autoincrement())
  artwork   Artwork  @relation(fields: [artworkId], references: [id], onDelete: Cascade)
  artworkId Int
  tag       Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  tagId     Int
  createdAt DateTime @default(now())
  @@unique([artworkId, tagId])
}

model Image {
  id        Int      @id @default(autoincrement())
  path      String
  width     Int?
  height    Int?
  size      Int?
  sortOrder Int      @default(0)
  artwork   Artwork? @relation(fields: [artworkId], references: [id])
  artworkId Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([artworkId, path], name: "unique_artwork_path")
}
```

#### 现有扫描逻辑
1. **扫描策略**: 目录遍历 + 图片文件识别
2. **数据提取**: 从目录结构解析艺术家和作品信息
3. **批量处理**: 优化的批量数据库操作
4. **进度反馈**: 实时SSE进度推送

### 业务域理解
- **核心业务**: 艺术作品管理和展示
- **数据来源**: 本地文件系统中的艺术作品目录
- **用户场景**: 艺术作品收藏、浏览、搜索

## 需求理解确认

### 原始需求分析
用户希望重构扫描器，实现以下功能：

1. **初始扫描**: 扫描元数据文件 `{artworkID}-meta.txt`
2. **完整扫描**: 扫描媒体文件并建立关联
3. **增量扫描**: 后续功能，仅扫描新增内容

### 元数据文件格式
```
ID
131278560

URL
https://www.pixiv.net/i/131278560

Original
https://i.pximg.net/img-original/img/2025/06/07/16/29/58/131278560_p0.png

Thumbnail
https://i.pximg.net/c/250x250_80_a2/img-master/img/2025/06/07/16/29/58/131278560_p0_square1200.jpg

xRestrict
R-18

AI
Yes

User
Aisey

UserID
102941617

Title
嗨♪ 想我了吗

Description


Tags
#AI生成
#R-18
#崩壊3rd
#崩坏星穹铁道
#爱莉希雅
#崩壊スターレイル
#Elysia
#cyrene
#昔涟
#キュレネ
#崩壊:スターレイル

Size
1160 x 1432

Bookmark
334

Date
2025-06-07T07:29:00+00:00
```

### 边界确认

#### 任务范围
✅ **包含**:
- 重新设计扫描器架构
- 实现元数据文件解析
- 实现分阶段扫描逻辑
- 保持现有API接口兼容性
- 复用现有数据库表结构
- 保持现有性能优化特性

❌ **不包含**:
- 增量扫描的具体实现（仅设计）
- 数据库表结构修改
- 前端界面修改
- 新的API接口设计

#### 技术约束
- 必须保持与现有系统的兼容性
- 必须复用现有数据库模型
- 必须保持现有API接口不变
- 必须保持现有性能优化特性

## 需求理解

### 对现有项目的理解

#### 现有扫描器的优势
1. **高性能**: 已实现并发处理和批量操作
2. **稳定性**: 完善的错误处理和恢复机制
3. **可观测性**: 详细的进度跟踪和性能监控
4. **用户体验**: 流畅的SSE进度推送

#### 现有扫描器的局限
1. **数据源单一**: 仅支持从目录结构推断信息
2. **元数据缺失**: 无法获取详细的作品元数据
3. **扩展性限制**: 难以支持多种数据源格式

### 重构的核心价值
1. **丰富数据源**: 支持结构化元数据文件
2. **提升数据质量**: 获取更准确、更丰富的作品信息
3. **增强扩展性**: 为未来支持多种数据源做准备
4. **保持兼容性**: 不破坏现有功能和性能

## 疑问澄清

### 1. 元数据文件格式兼容性
**问题**: 元数据文件格式是否固定？是否需要支持其他格式？
**决策**: 基于用户提供的格式，采用键值对解析方式，具备一定的容错性

### 2. 现有数据迁移
**问题**: 如何处理现有数据库中的数据？
**决策**: 重构后的扫描器应能处理现有数据，不强制重新扫描

### 3. 字段映射策略
**问题**: 元数据字段如何映射到现有数据库字段？
**决策**: 
- `ID` → 作为作品的外部ID（可能需要新增字段）
- `User` + `UserID` → Artist表的name、username、userId
- `Title` → Artwork.title
- `Description` → Artwork.description
- `Tags` → 通过ArtworkTag关联到Tag表
- `URL`、`Original`、`Thumbnail` → 可能需要扩展Image表或新增字段
- `Date` → Artwork.directoryCreatedAt

### 4. 文件关联策略
**问题**: 如何确保元数据文件与媒体文件的正确关联？
**决策**: 通过ID字段匹配文件名中的ID部分（如 `131278560_p0.png`）

### 5. 错误处理策略
**问题**: 元数据文件格式错误或缺失必填字段时如何处理？
**决策**: 
- 必填字段缺失：跳过该文件，记录错误
- 格式错误：尝试容错解析，失败则跳过
- 部分字段缺失：使用默认值或空值

### 6. 性能考虑
**问题**: 新的扫描逻辑是否会影响现有性能？
**决策**: 复用现有性能优化组件，确保性能不降级

## 技术实现方案概述

### 架构设计原则
1. **渐进式重构**: 不破坏现有功能
2. **模块化设计**: 新增组件独立可测试
3. **策略模式**: 支持多种扫描策略
4. **向后兼容**: 保持现有API接口

### 核心组件设计
1. **MetadataParser**: 元数据文件解析器
2. **ScanStrategy**: 扫描策略接口
3. **MetadataScanStrategy**: 元数据扫描策略
4. **MediaScanStrategy**: 媒体文件扫描策略
5. **ScanOrchestrator**: 扫描编排器

### 集成方案
- 扩展现有FileScanner类
- 复用现有性能优化组件
- 保持现有API接口不变
- 添加新的配置选项支持新功能

## 验收标准

### 功能验收
1. ✅ 能够解析指定格式的元数据文件
2. ✅ 能够执行初始扫描（仅元数据）
3. ✅ 能够执行完整扫描（元数据+媒体文件）
4. ✅ 能够正确关联元数据和媒体文件
5. ✅ 能够处理目录结构中的多个作品
6. ✅ 保持现有API接口完全兼容

### 性能验收
1. ✅ 扫描性能不低于现有实现
2. ✅ 内存使用控制在合理范围
3. ✅ 支持大规模文件扫描
4. ✅ 进度反馈及时准确

### 质量验收
1. ✅ 代码质量符合项目标准
2. ✅ 错误处理完善
3. ✅ 日志记录详细
4. ✅ 单元测试覆盖核心逻辑

### 兼容性验收
1. ✅ 现有数据库数据不受影响
2. ✅ 现有API接口行为不变
3. ✅ 现有配置继续有效
4. ✅ 现有性能优化特性保持

## 风险评估

### 技术风险
1. **数据库字段不足**: 可能需要扩展数据库模型
   - **缓解**: 优先使用现有字段，必要时添加可选字段

2. **性能回归**: 新逻辑可能影响性能
   - **缓解**: 复用现有优化组件，进行性能测试

3. **兼容性问题**: 可能破坏现有功能
   - **缓解**: 保持现有接口，添加功能开关

### 业务风险
1. **数据质量**: 元数据文件质量参差不齐
   - **缓解**: 实现容错解析和数据验证

2. **用户体验**: 扫描时间可能增加
   - **缓解**: 优化扫描策略，提供进度反馈

## 后续规划

### 短期目标（本次重构）
1. 实现元数据文件解析
2. 实现分阶段扫描逻辑
3. 保持系统兼容性

### 中期目标（后续迭代）
1. 实现增量扫描
2. 支持更多元数据格式
3. 优化扫描性能

### 长期目标
1. 支持多种数据源
2. 智能数据清洗
3. 自动化数据质量检查