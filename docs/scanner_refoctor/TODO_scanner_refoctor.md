# 扫描器重构 - TODO 清单

## 🚨 立即需要处理的事项

### 1. 环境配置

#### 启用元数据扫描功能
```bash
# 在 .env 文件中添加或调整：
SCANNER_ENABLE_METADATA_SCANNING=true
SCANNER_DEFAULT_STRATEGY=full
SCANNER_MAX_CONCURRENCY=4
```

#### 数据库迁移验证
```bash
# 验证数据库迁移是否成功
cd packages/api
npx prisma db pull

# 检查新增字段是否存在
npx prisma studio
# 查看 Artwork 表是否包含新字段：
# - externalId
# - sourceUrl
# - originalUrl
# - thumbnailUrl
# - xRestrict
# - isAiGenerated
# - size
# - bookmarkCount
# - sourceDate
```

### 2. 测试新功能

#### 准备测试数据
```bash
# 创建测试目录结构
mkdir -p /test/scan/path/Artist-123456/Artwork-Title/

# 创建示例元数据文件
cat > /test/scan/path/Artist-123456/Artwork-Title/131278560-meta.txt << 'EOF'
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
这是一个测试描述

Tags
#AI生成 #R-18 #崩壊3rd #崩坏星穹铁道 #爱莉希雅

Size
1160 x 1432

Bookmark
334

Date
2025-06-07T07:29:00+00:00
EOF

# 创建对应的媒体文件（可以是空文件用于测试）
touch /test/scan/path/Artist-123456/Artwork-Title/131278560_p0.png
touch /test/scan/path/Artist-123456/Artwork-Title/131278560_p1.jpg
```

#### API测试
```bash
# 测试策略信息接口
curl "http://localhost:3001/api/v1/scan/strategies"

# 测试元数据扫描
curl -X POST "http://localhost:3001/api/v1/scan/stream?scanType=metadata&force=true"

# 测试完整扫描
curl -X POST "http://localhost:3001/api/v1/scan/stream?scanType=full&force=true"

# 测试传统扫描（向后兼容）
curl -X POST "http://localhost:3001/api/v1/scan/stream?force=true"
```

### 3. 服务重启

```bash
# 重启后端服务以加载新功能
cd packages/api
npm run dev

# 或者如果使用 Docker
docker-compose restart api
```

## 📋 短期内需要完成的事项

### 1. 图片处理库集成

**问题**: MediaScanStrategy 中的图片尺寸获取功能暂未实现

**解决方案**:
```bash
# 安装 sharp 图片处理库
cd packages/api
npm install sharp
npm install --save-dev @types/sharp
```

**代码修改**:
```typescript
// 在 MediaScanStrategy.ts 中更新 getImageDimensions 方法
import sharp from 'sharp'

private async getImageDimensions(imagePath: string): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(imagePath).metadata()
    return {
      width: metadata.width,
      height: metadata.height
    }
  } catch (error) {
    this.logger.warn({ imagePath, error }, 'Failed to get image dimensions')
    return { width: undefined, height: undefined }
  }
}
```

### 2. 单元测试添加

**需要添加的测试文件**:
```bash
# 创建测试目录
mkdir -p packages/api/src/services/scanner/__tests__

# 需要创建的测试文件：
# - MetadataParser.test.ts
# - PathParser.test.ts
# - FileAssociator.test.ts
# - MetadataScanStrategy.test.ts
# - MediaScanStrategy.test.ts
# - FullScanStrategy.test.ts
# - ScanOrchestrator.test.ts
```

**测试示例**:
```typescript
// MetadataParser.test.ts 示例
import { MetadataParser } from '../MetadataParser'

describe('MetadataParser', () => {
  let parser: MetadataParser
  
  beforeEach(() => {
    parser = new MetadataParser()
  })
  
  it('should parse valid metadata file', async () => {
    // 测试用例实现
  })
  
  it('should validate required fields', () => {
    // 测试用例实现
  })
})
```

### 3. 性能基准测试

**创建性能测试脚本**:
```bash
# 创建性能测试文件
touch benchmarks/scanner-refactor-performance.js
```

**测试内容**:
- 元数据解析性能对比
- 文件关联性能测试
- 内存使用情况监控
- 并发处理能力测试

### 4. 文档更新

**需要更新的文档**:
- `README.md` - 添加新功能说明
- `docs/config-usage-examples.md` - 添加新配置示例
- API文档 - 更新扫描接口说明

## 🔧 配置优化建议

### 1. 生产环境配置

```bash
# 生产环境推荐配置
SCANNER_ENABLE_METADATA_SCANNING=true
SCANNER_DEFAULT_STRATEGY=auto  # 自动选择最佳策略
SCANNER_MAX_CONCURRENCY=8      # 根据服务器性能调整
SCANNER_BATCH_SIZE=1000        # 批量处理大小
SCANNER_ENABLE_CACHE=true      # 启用缓存
```

### 2. 开发环境配置

```bash
# 开发环境推荐配置
SCANNER_ENABLE_METADATA_SCANNING=true
SCANNER_DEFAULT_STRATEGY=full
SCANNER_MAX_CONCURRENCY=4
SCANNER_ENABLE_DEBUG_LOGS=true
```

### 3. 数据库优化

```sql
-- 为新字段添加额外索引（如果需要）
CREATE INDEX CONCURRENTLY "Artwork_sourceDate_idx" ON "Artwork"("sourceDate");
CREATE INDEX CONCURRENTLY "Artwork_isAiGenerated_idx" ON "Artwork"("isAiGenerated");
CREATE INDEX CONCURRENTLY "Artwork_xRestrict_idx" ON "Artwork"("xRestrict");

-- 分析表统计信息
ANALYZE "Artwork";
```

## 🐛 已知问题和解决方案

### 1. 元数据文件编码问题

**问题**: 某些元数据文件可能使用非UTF-8编码

**解决方案**:
```typescript
// 在 MetadataParser.ts 中添加编码检测
import { detect } from 'chardet'
import iconv from 'iconv-lite'

async parse(filePath: string): Promise<ArtworkMetadata> {
  const buffer = await fs.readFile(filePath)
  const encoding = detect(buffer) || 'utf8'
  const content = iconv.decode(buffer, encoding)
  // ... 继续解析
}
```

### 2. 大文件处理性能

**问题**: 处理大量元数据文件时可能出现内存压力

**解决方案**:
- 调整并发数量：`SCANNER_MAX_CONCURRENCY=2`
- 减少批处理大小：`SCANNER_BATCH_SIZE=500`
- 启用流式处理：`SCANNER_USE_STREAMING=true`

### 3. 文件路径特殊字符

**问题**: 文件路径包含特殊字符可能导致解析失败

**解决方案**:
```typescript
// 在 PathParser.ts 中添加路径清理
private sanitizePath(path: string): string {
  return path
    .replace(/[<>:"|?*]/g, '_')  // 替换Windows不支持的字符
    .replace(/\s+/g, ' ')        // 合并多个空格
    .trim()
}
```

## 📊 监控和告警

### 1. 关键指标监控

```typescript
// 添加到日志监控中
const metrics = {
  metadataFilesProcessed: 0,
  mediaFilesAssociated: 0,
  errorRate: 0,
  averageProcessingTime: 0,
  memoryUsage: process.memoryUsage()
}

// 定期输出监控指标
setInterval(() => {
  logger.info({ metrics }, 'Scanner performance metrics')
}, 60000) // 每分钟输出一次
```

### 2. 告警阈值设置

```bash
# 建议的告警阈值
ERROR_RATE_THRESHOLD=5%          # 错误率超过5%告警
MEMORY_USAGE_THRESHOLD=85%       # 内存使用超过85%告警
PROCESSING_TIME_THRESHOLD=30s    # 单个文件处理超过30秒告警
QUEUE_LENGTH_THRESHOLD=1000      # 队列长度超过1000告警
```

## 🚀 性能优化建议

### 1. 缓存策略

```typescript
// 实现元数据解析缓存
class MetadataCache {
  private cache = new Map<string, ArtworkMetadata>()
  private maxSize = 1000
  
  get(filePath: string, mtime: Date): ArtworkMetadata | null {
    const key = `${filePath}:${mtime.getTime()}`
    return this.cache.get(key) || null
  }
  
  set(filePath: string, mtime: Date, metadata: ArtworkMetadata): void {
    const key = `${filePath}:${mtime.getTime()}`
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, metadata)
  }
}
```

### 2. 批处理优化

```typescript
// 动态调整批处理大小
class DynamicBatchProcessor {
  private adjustBatchSize(currentSize: number, processingTime: number): number {
    const targetTime = 5000 // 目标处理时间5秒
    if (processingTime > targetTime) {
      return Math.max(100, Math.floor(currentSize * 0.8))
    } else if (processingTime < targetTime * 0.5) {
      return Math.min(2000, Math.floor(currentSize * 1.2))
    }
    return currentSize
  }
}
```

## 📚 学习资源

### 1. 相关文档
- [Prisma 数据库迁移指南](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [TypeScript 策略模式](https://refactoring.guru/design-patterns/strategy/typescript/example)
- [Node.js 性能优化](https://nodejs.org/en/docs/guides/simple-profiling/)

### 2. 代码示例
- 查看 `docs/scanner_refoctor/DESIGN_scanner_refoctor.md` 了解架构设计
- 查看 `docs/scanner_refoctor/FINAL_scanner_refoctor.md` 了解使用指南
- 参考现有的 `scanner/BatchProcessor.ts` 了解批量处理模式

## 🔍 故障排除

### 1. 常见错误

**错误**: "Metadata scanning is not enabled"
```bash
# 解决方案：检查构造函数参数
const scanner = new FileScanner(prisma, logger, {
  enableMetadataScanning: true  // 确保启用元数据扫描
})
```

**错误**: "Required field 'ID' is missing"
```bash
# 解决方案：检查元数据文件格式
# 确保文件包含必填字段：ID, User, UserID, Title
```

**错误**: "No media files found for artwork"
```bash
# 解决方案：检查文件命名格式
# 确保媒体文件名包含作品ID，如：131278560_p0.png
```

### 2. 调试技巧

```bash
# 启用详细日志
export LOG_LEVEL=debug

# 检查数据库连接
npx prisma db pull

# 验证文件权限
ls -la /path/to/scan/directory

# 检查文件编码
file -i /path/to/metadata/file.txt
```

## 📞 获取支持

### 1. 问题报告
如果遇到问题，请提供以下信息：
- 错误日志
- 元数据文件示例
- 系统环境信息
- 复现步骤

### 2. 功能请求
如果需要新功能，请描述：
- 使用场景
- 期望行为
- 优先级

---

**注意**: 请按优先级处理上述事项，🚨 标记的事项需要立即处理，📋 标记的事项建议在短期内完成。

**提示**: 在生产环境部署前，建议先在测试环境验证所有功能正常工作。