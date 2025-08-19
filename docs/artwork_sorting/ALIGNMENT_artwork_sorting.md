# ALIGNMENT_artwork_sorting.md

## 项目上下文分析

### 现有项目架构
- **技术栈**: Node.js + Fastify + Prisma + PostgreSQL + React + TypeScript
- **数据库模型**: Artist -> Artwork -> Image 层级结构
- **API架构**: RESTful API with `/api/v1/artworks` 端点
- **前端架构**: React + React Query + URL状态管理

### 现有代码模式和约定
- 使用 Prisma ORM 进行数据库操作
- 基于 URLSearchParams 的状态管理
- 分页查询模式 (page, pageSize)
- 支持标签过滤和搜索功能
- 使用 React Query 进行数据缓存和状态管理

### 业务域和数据模型理解
- **Artist**: 艺术家，包含 name, username, userId, createdAt, updatedAt
- **Artwork**: 作品，包含 title, description, artistId, createdAt, updatedAt
- **Image**: 图片，包含 path, sortOrder, artworkId, createdAt, updatedAt
- **扫描机制**: 按目录结构扫描，目录创建时间影响数据库记录的 createdAt

## 原始需求分析

### 核心需求
1. **默认排序变更**: 从当前的 `createdAt DESC` 改为按"最新添加时间"排序
2. **排序选项扩展**: 支持多种排序方式切换
   - 按最新添加（默认）
   - 按名称升序
   - 按名称降序
3. **时间基准确认**: 需要确定"最新添加时间"的具体含义

### 边界确认
- **包含**: 前后端排序逻辑实现、UI排序控件、数据库结构适配
- **不包含**: 扫描逻辑修改、数据迁移脚本、性能优化
- **约束**: 保持现有API兼容性、不影响现有搜索和过滤功能

## 需求理解和技术分析

### 当前实现现状

#### 数据库层面
```sql
-- 当前 Artwork 模型字段
model Artwork {
  id          Int       @id @default(autoincrement())
  title       String
  description String?
  artistId    Int?
  createdAt   DateTime  @default(now())  -- 当前排序依据
  updatedAt   DateTime  @updatedAt
  -- 其他关联字段...
}
```

#### API层面
```typescript
// 当前排序实现 (artworks.ts:85)
orderBy: { createdAt: 'desc' }
```

#### 前端层面
- 无排序控件UI
- 无排序状态管理
- 固定使用API默认排序

### 技术实现分析

#### 1. 时间基准问题
**关键疑问**: "最新添加时间"的具体含义？
- **选项A**: 数据库记录的 `createdAt`（当前实现）
- **选项B**: 目录的创建时间（文件系统时间）
- **选项C**: 目录的修改时间（文件系统时间）
- **选项D**: 扫描发现时间（每次扫描更新）

**技术影响**:
- 选项A: 无需修改，已有字段
- 选项B/C: 需要在扫描时获取文件系统时间并存储
- 选项D: 需要修改扫描逻辑，每次扫描更新时间戳

#### 2. 数据库结构适配需求

**当前字段评估**:
- `createdAt`: 记录创建时间 ✓
- `updatedAt`: 记录更新时间 ✓

**可能需要新增字段**:
```sql
-- 如果需要文件系统时间
model Artwork {
  -- 现有字段...
  directoryCreatedAt DateTime?  -- 目录创建时间
  directoryModifiedAt DateTime? -- 目录修改时间
  lastScannedAt DateTime?      -- 最后扫描时间
}
```

#### 3. API扩展需求

**查询参数扩展**:
```typescript
interface ArtworksQuery {
  page?: string
  pageSize?: string
  tags?: string
  search?: string
  sortBy?: 'newest' | 'title_asc' | 'title_desc'  // 新增
}
```

**排序逻辑映射**:
```typescript
const sortMappings = {
  'newest': { createdAt: 'desc' },           // 或其他时间字段
  'title_asc': { title: 'asc' },
  'title_desc': { title: 'desc' }
}
```

#### 4. 前端UI设计需求

**排序控件位置**: Gallery页面顶部，搜索栏附近
**控件类型**: 下拉选择器或按钮组
**状态管理**: 通过URLSearchParams同步状态

## 疑问澄清

### 高优先级问题

1. **时间基准确认** (影响数据库设计)
   - 用户期望的"最新添加时间"具体指什么？
   - 是否需要区分"首次添加"和"重新扫描"？

2. **排序选项范围** (影响UI设计)
   - 除了时间和名称，是否需要其他排序选项？
   - 是否需要支持多字段组合排序？

3. **默认行为** (影响用户体验)
   - 新的默认排序是否应该对所有用户生效？
   - 是否需要用户偏好设置功能？

### 中优先级问题

4. **性能考虑** (影响实现方案)
   - 大量作品时排序性能要求？
   - 是否需要添加数据库索引？

5. **兼容性** (影响迁移策略)
   - 现有数据如何处理时间字段？
   - API变更是否需要版本控制？

## 技术约束和集成方案

### 现有系统约束
- 必须保持现有API的向后兼容性
- 不能影响现有的搜索和过滤功能
- 需要与React Query缓存机制兼容
- 遵循现有的错误处理模式

### 集成点识别
1. **数据库层**: Prisma schema 和 migration
2. **API层**: artworks.ts 路由处理
3. **类型层**: shared 包中的类型定义
4. **前端层**: Gallery.tsx 组件和状态管理
5. **扫描层**: scanner.ts 中的数据收集逻辑（如果需要文件系统时间）

### 风险评估
- **数据迁移风险**: 如果需要新字段，现有数据的处理
- **性能风险**: 新排序字段的查询性能
- **兼容性风险**: API变更对现有客户端的影响
- **用户体验风险**: 排序变更对用户习惯的影响