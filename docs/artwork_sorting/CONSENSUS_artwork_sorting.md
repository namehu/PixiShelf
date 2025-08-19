# CONSENSUS_artwork_sorting.md

## 需求共识确认

基于用户反馈，以下决策已确认：

### 关键决策确认

#### 1. 时间基准定义
**选择**: 选项B - 目录创建时间（文件系统时间）
- 使用文件系统的目录创建时间作为"最新添加时间"
- 需要在扫描过程中获取目录的 `birthtime` 或 `ctime`
- 需要在数据库中新增字段存储此时间

#### 2. 排序选项范围
**确认**: 实现完整的排序选项集合
- ✅ 按最新添加（默认）- 基于目录创建时间
- ✅ 按名称升序
- ✅ 按名称降序
- ✅ 按艺术家名称排序（升序/降序）
- ✅ 按图片数量排序（降序/升序）
- ✅ 按作品描述长度排序（降序/升序）

#### 3. 用户体验策略
**确认**: 简化的用户体验
- 新的默认排序对所有用户立即生效
- 不需要保存用户的排序偏好
- 排序状态通过URL参数管理（临时状态）

## 技术实现方案

### 数据库结构变更

#### 新增字段
```sql
-- 在 Artwork 模型中新增字段
model Artwork {
  -- 现有字段...
  directoryCreatedAt DateTime?  -- 目录创建时间（文件系统时间）
  imageCount        Int       @default(0)  -- 图片数量（冗余字段，提升查询性能）
  descriptionLength Int       @default(0)  -- 描述长度（冗余字段，提升查询性能）
  
  -- 新增索引
  @@index([directoryCreatedAt])
  @@index([imageCount])
  @@index([descriptionLength])
}
```

#### 数据迁移策略
- 现有数据的 `directoryCreatedAt` 初始化为 `createdAt` 值
- `imageCount` 通过关联查询计算并更新
- `descriptionLength` 通过字符串长度计算并更新

### API接口设计

#### 查询参数扩展
```typescript
interface ArtworksQuery extends PaginationQuery {
  tags?: string
  search?: string
  sortBy?: SortOption  // 新增排序参数
}

type SortOption = 
  | 'newest'           // 按最新添加（默认）
  | 'title_asc'        // 按名称升序
  | 'title_desc'       // 按名称降序
  | 'artist_asc'       // 按艺术家名称升序
  | 'artist_desc'      // 按艺术家名称降序
  | 'images_desc'      // 按图片数量降序
  | 'images_asc'       // 按图片数量升序
  | 'desc_length_desc' // 按描述长度降序
  | 'desc_length_asc'  // 按描述长度升序
```

#### 排序逻辑映射
```typescript
const sortMappings: Record<SortOption, any> = {
  'newest': { directoryCreatedAt: 'desc' },
  'title_asc': { title: 'asc' },
  'title_desc': { title: 'desc' },
  'artist_asc': { artist: { name: 'asc' } },
  'artist_desc': { artist: { name: 'desc' } },
  'images_desc': { imageCount: 'desc' },
  'images_asc': { imageCount: 'asc' },
  'desc_length_desc': { descriptionLength: 'desc' },
  'desc_length_asc': { descriptionLength: 'asc' }
}
```

### 前端UI设计

#### 排序控件设计
```typescript
const sortOptions = [
  { value: 'newest', label: '最新添加' },
  { value: 'title_asc', label: '名称 A-Z' },
  { value: 'title_desc', label: '名称 Z-A' },
  { value: 'artist_asc', label: '艺术家 A-Z' },
  { value: 'artist_desc', label: '艺术家 Z-A' },
  { value: 'images_desc', label: '图片数量 多-少' },
  { value: 'images_asc', label: '图片数量 少-多' },
  { value: 'desc_length_desc', label: '描述长度 长-短' },
  { value: 'desc_length_asc', label: '描述长度 短-长' }
]
```

#### UI布局
- 位置：Gallery页面顶部，搜索栏右侧
- 控件类型：下拉选择器（Select组件）
- 默认值：'newest'
- 状态管理：通过URLSearchParams同步

### 扫描逻辑变更

#### 文件系统时间获取
```typescript
// 在扫描过程中获取目录创建时间
const getDirectoryCreatedTime = async (dirPath: string): Promise<Date> => {
  const stats = await fs.stat(dirPath)
  // 使用 birthtime（创建时间）或 ctime（状态变更时间）
  return stats.birthtime || stats.ctime
}
```

#### 数据收集更新
- 在 `processArtworkDirectory` 中获取目录创建时间
- 在创建/更新 Artwork 记录时设置 `directoryCreatedAt`
- 同时更新 `imageCount` 和 `descriptionLength` 字段

## 验收标准

### 功能验收
1. **排序功能**
   - ✅ 所有8种排序选项都能正常工作
   - ✅ 默认排序为"最新添加"（基于目录创建时间）
   - ✅ 排序状态通过URL参数正确管理
   - ✅ 排序与搜索、过滤功能兼容

2. **数据准确性**
   - ✅ 目录创建时间正确获取和存储
   - ✅ 图片数量统计准确
   - ✅ 描述长度计算正确
   - ✅ 现有数据正确迁移

3. **性能要求**
   - ✅ 排序查询响应时间 < 500ms（1000条记录内）
   - ✅ 数据库索引正确创建
   - ✅ 冗余字段有效提升查询性能

4. **用户体验**
   - ✅ 排序控件UI直观易用
   - ✅ 排序变更即时生效
   - ✅ 页面刷新后排序状态保持
   - ✅ 移动端适配良好

### 技术验收
1. **代码质量**
   - ✅ 遵循现有代码规范
   - ✅ TypeScript类型定义完整
   - ✅ 错误处理完善
   - ✅ 日志记录适当

2. **兼容性**
   - ✅ API向后兼容（默认排序行为）
   - ✅ 现有功能不受影响
   - ✅ 数据库迁移安全可靠

3. **测试覆盖**
   - ✅ 单元测试覆盖排序逻辑
   - ✅ 集成测试覆盖API接口
   - ✅ E2E测试覆盖用户交互

## 技术约束和风险

### 技术约束
1. **数据库约束**
   - 必须保持现有数据完整性
   - 迁移过程不能影响服务可用性
   - 索引创建需要考虑性能影响

2. **API约束**
   - 保持现有API的向后兼容性
   - 新参数为可选参数
   - 错误处理保持一致

3. **前端约束**
   - 与现有UI风格保持一致
   - 响应式设计要求
   - 浏览器兼容性要求

### 风险评估
1. **低风险**
   - UI组件开发
   - URL状态管理
   - 基础排序逻辑

2. **中风险**
   - 数据库迁移
   - 扫描逻辑修改
   - 性能优化

3. **缓解策略**
   - 分阶段部署
   - 充分测试
   - 回滚方案准备

## 集成方案

### 模块集成点
1. **数据库层**
   - Prisma schema 更新
   - 数据库迁移脚本
   - 索引创建脚本

2. **API层**
   - artworks.ts 路由更新
   - 查询逻辑扩展
   - 响应格式保持

3. **类型层**
   - shared 包类型定义更新
   - API接口类型扩展

4. **前端层**
   - Gallery.tsx 组件更新
   - 排序控件组件开发
   - 状态管理逻辑

5. **扫描层**
   - scanner.ts 逻辑更新
   - 文件系统时间获取
   - 数据收集增强

### 部署策略
1. **阶段1**: 数据库结构更新和数据迁移
2. **阶段2**: 后端API功能实现
3. **阶段3**: 前端UI和交互实现
4. **阶段4**: 扫描逻辑更新
5. **阶段5**: 全面测试和优化

## 最终确认

所有关键决策已确认，技术方案已明确，验收标准已定义。可以进入下一阶段的详细设计和任务分解。