# 文件扫描器性能优化 - 共识文档

## 明确的需求描述

### 核心目标
优化 FileScanner 类的性能，显著提升大型目录结构的扫描速度，同时保持数据准确性和完整性。

### 验收标准
1. **性能提升**: 扫描速度提升至少 3-5 倍
2. **内存控制**: 内存使用不超过原来的 2 倍
3. **数据一致性**: 扫描结果与原版本完全一致
4. **API兼容性**: 保持 ScanOptions、ScanProgress、ScanResult 接口不变
5. **错误处理**: 保持原有的错误处理和日志记录能力

## 技术实现方案

### 1. 并发文件系统操作

#### 策略
- 使用 Promise.all 和 Promise.allSettled 进行并发处理
- 实现可配置的并发控制（默认 CPU 核心数 * 2）
- 分批处理避免文件描述符耗尽

#### 实现要点
```typescript
// 并发控制器
class ConcurrencyController {
  private semaphore: number
  private queue: Array<() => Promise<any>> = []
  
  async execute<T>(task: () => Promise<T>): Promise<T>
}

// 并发扫描目录
async function scanDirectoriesConcurrently(
  directories: string[], 
  concurrency: number = os.cpus().length * 2
): Promise<ScanResult[]>
```

### 2. 批量数据库操作

#### 策略
- 收集所有需要创建的实体，然后批量插入
- 使用 Prisma 的 createMany 和事务处理
- 预查询已存在的艺术家，避免重复查询

#### 实现要点
```typescript
// 批量数据结构
interface BatchData {
  artists: Array<{ name: string; username?: string; userId?: string }>
  artworks: Array<{ title: string; description?: string; artistId: number }>
  images: Array<{ path: string; size: number; artworkId: number }>
  tags: Array<{ name: string }>
  artworkTags: Array<{ artworkId: number; tagId: number }>
}

// 批量插入方法
async function batchInsert(batchData: BatchData): Promise<void>
```

### 3. 单次遍历优化

#### 策略
- 合并统计和扫描阶段，避免重复遍历
- 使用流式处理，边扫描边统计
- 实现增量进度更新

#### 实现要点
```typescript
// 统一的扫描方法
async function scanAndProcess(
  rootPath: string,
  options: ScanOptions
): Promise<ScanResult> {
  // 单次遍历，同时完成统计和数据收集
}
```

### 4. 内存优化

#### 策略
- 使用对象池减少GC压力
- 及时释放不需要的引用
- 分批处理大型数据集

#### 实现要点
```typescript
// 对象池
class ObjectPool<T> {
  private pool: T[] = []
  constructor(private factory: () => T, private reset: (obj: T) => void) {}
  
  acquire(): T
  release(obj: T): void
}
```

### 5. 缓存和预编译优化

#### 策略
- 预编译正则表达式
- 缓存文件扩展名检查
- 缓存路径解析结果

## 技术约束

### 兼容性约束
- 保持现有的接口签名不变
- 保持现有的错误类型和消息格式
- 保持现有的日志输出格式

### 性能约束
- 并发数不超过系统文件描述符限制
- 批量操作大小不超过数据库限制
- 内存使用增长控制在合理范围内

### 业务约束
- 保持扫描结果的完整性和准确性
- 支持扫描过程的取消机制
- 保持进度反馈的实时性

## 集成方案

### 渐进式重构
1. **第一阶段**: 实现并发文件系统操作
2. **第二阶段**: 优化数据库批量操作
3. **第三阶段**: 合并遍历过程
4. **第四阶段**: 内存和缓存优化

### 测试策略
- 使用现有测试数据验证结果一致性
- 性能基准测试对比
- 内存使用监控
- 并发安全性测试

## 任务边界限制

### 包含范围
- FileScanner 类的性能优化
- 相关辅助类和方法的实现
- 性能测试和验证

### 排除范围
- 数据库 schema 修改
- API 路由层的修改
- 前端界面的修改
- 其他服务的性能优化

## 验收标准

### 功能验收
- [ ] 扫描结果与原版本完全一致
- [ ] 支持所有原有的扫描选项
- [ ] 错误处理机制正常工作
- [ ] 进度回调正常触发
- [ ] 取消机制正常工作

### 性能验收
- [ ] 扫描速度提升 3-5 倍
- [ ] 内存使用控制在 2 倍以内
- [ ] 并发处理稳定可靠
- [ ] 大型目录结构处理正常

### 质量验收
- [ ] 代码质量保持现有标准
- [ ] 类型定义完整准确
- [ ] 错误处理覆盖全面
- [ ] 日志记录详细有用