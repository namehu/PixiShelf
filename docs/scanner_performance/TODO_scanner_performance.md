# 文件扫描器性能优化 - TODO 清单

## 🚨 立即需要处理的事项

### 1. 环境配置

#### 数据库配置优化
```sql
-- 建议的数据库连接池配置
-- 在 .env 文件中添加或调整：
DATABASE_URL="postgresql://user:password@localhost:5432/database?connection_limit=20&pool_timeout=20"
```

#### Node.js 运行时配置
```bash
# 建议的 Node.js 启动参数（在 package.json 或启动脚本中）
node --max-old-space-size=2048 --optimize-for-size dist/index.js
```

### 2. 监控配置

#### 添加性能监控日志
```typescript
// 在 src/routes/scan.ts 中添加性能日志
const result = await scanner.scan({
  scanPath,
  forceUpdate,
  onProgress: (progress) => {
    // 现有进度处理...
    
    // 添加性能监控
    const metrics = scanner.getPerformanceMetrics();
    server.log.debug({ 
      progress, 
      metrics: {
        throughput: metrics.throughput,
        memoryUsage: metrics.memoryUsage.heapUsed,
        concurrency: scanner.getConcurrencyStatus()
      }
    }, 'Scan progress with metrics');
  }
});

// 扫描完成后记录完整性能报告
const finalMetrics = scanner.getPerformanceMetrics();
const cacheStats = scanner.getCacheStats();
server.log.info({ 
  result, 
  performanceMetrics: finalMetrics,
  cacheStats 
}, 'Scan completed with performance report');
```

### 3. 配置文件更新

#### 环境变量配置
```bash
# 在 .env 文件中添加扫描器配置

# 扫描器性能配置
SCANNER_ENABLE_OPTIMIZATIONS=true
SCANNER_MAX_CONCURRENCY=8
SCANNER_BATCH_SIZE=500
SCANNER_CACHE_SIZE_LIMIT=10000

# 性能监控配置
SCANNER_ENABLE_PERFORMANCE_LOGGING=true
SCANNER_PERFORMANCE_LOG_INTERVAL=5000
```

## 📋 短期任务 (1-2周内完成)

### 1. 生产环境部署准备

#### 渐进式部署计划
- [ ] **第一阶段**: 在测试环境启用优化模式
- [ ] **第二阶段**: 在生产环境以兼容模式部署
- [ ] **第三阶段**: 逐步启用优化功能
- [ ] **第四阶段**: 全面启用优化模式

#### 部署检查清单
- [ ] 确认数据库连接池配置
- [ ] 确认服务器内存和CPU资源
- [ ] 设置性能监控告警
- [ ] 准备回滚方案

### 2. 性能基准测试

#### 运行基准测试
```bash
# 在项目根目录运行
cd d:/code/artisan-shelf
node benchmarks/scanner-performance.js
```

#### 建立性能基线
- [ ] 记录当前扫描性能数据
- [ ] 建立性能监控仪表板
- [ ] 设置性能回归告警

### 3. 监控和告警设置

#### 关键指标监控
- [ ] 扫描时间监控
- [ ] 内存使用监控
- [ ] 错误率监控
- [ ] 数据库连接数监控

#### 告警阈值设置
```typescript
// 建议的告警阈值
const ALERT_THRESHOLDS = {
  scanTimeMs: 300000,        // 扫描时间超过5分钟
  memoryUsageMB: 1024,       // 内存使用超过1GB
  errorRate: 0.05,           // 错误率超过5%
  cacheHitRate: 0.7,         // 缓存命中率低于70%
  concurrencyUtilization: 0.8 // 并发利用率超过80%
};
```

## 📊 中期任务 (1-2个月内完成)

### 1. 测试套件完善

#### 单元测试
- [ ] 为 ConcurrencyController 添加测试
- [ ] 为 BatchProcessor 添加测试
- [ ] 为 CacheManager 添加测试
- [ ] 为优化后的 FileScanner 添加测试

#### 集成测试
- [ ] 端到端扫描测试
- [ ] 性能回归测试
- [ ] 并发安全性测试
- [ ] 内存泄漏测试

#### 测试配置
```json
// 在 packages/api/package.json 中添加测试脚本
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:performance": "node benchmarks/scanner-performance.js"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

### 2. 配置管理优化

#### 动态配置支持
```typescript
// 创建配置管理器
class ScannerConfigManager {
  private config: ScannerConfig;
  
  constructor() {
    this.loadConfig();
  }
  
  private loadConfig() {
    this.config = {
      enableOptimizations: process.env.SCANNER_ENABLE_OPTIMIZATIONS === 'true',
      maxConcurrency: parseInt(process.env.SCANNER_MAX_CONCURRENCY || '8'),
      batchSize: parseInt(process.env.SCANNER_BATCH_SIZE || '500'),
      cacheSizeLimit: parseInt(process.env.SCANNER_CACHE_SIZE_LIMIT || '10000')
    };
  }
  
  getConfig(): ScannerConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<ScannerConfig>) {
    this.config = { ...this.config, ...updates };
  }
}
```

### 3. 性能优化微调

#### 自适应并发控制
- [ ] 实现基于系统负载的动态并发调整
- [ ] 添加内存压力感知
- [ ] 实现智能批量大小调整

#### 缓存策略优化
- [ ] 实现 LRU 缓存替换策略
- [ ] 添加缓存预热功能
- [ ] 实现缓存持久化（可选）

## 🔧 技术债务和改进

### 1. 代码质量提升

#### 类型安全改进
- [ ] 添加更严格的 TypeScript 配置
- [ ] 完善错误类型定义
- [ ] 添加运行时类型检查

#### 代码规范
- [ ] 统一错误处理模式
- [ ] 添加 JSDoc 文档
- [ ] 代码审查和重构

### 2. 可观测性增强

#### 日志改进
```typescript
// 结构化日志格式
interface ScanLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: 'scanner' | 'concurrency' | 'batch' | 'cache';
  operation: string;
  metrics?: PerformanceMetrics;
  error?: Error;
  metadata?: Record<string, any>;
}
```

#### 指标收集
- [ ] 添加 Prometheus 指标导出
- [ ] 实现自定义指标收集
- [ ] 添加分布式追踪支持

### 3. 错误处理增强

#### 错误分类和恢复
```typescript
// 错误分类枚举
enum ScanErrorType {
  FILE_SYSTEM_ERROR = 'file_system_error',
  DATABASE_ERROR = 'database_error',
  MEMORY_ERROR = 'memory_error',
  CONCURRENCY_ERROR = 'concurrency_error',
  VALIDATION_ERROR = 'validation_error'
}

// 错误恢复策略
interface ErrorRecoveryStrategy {
  maxRetries: number;
  backoffMs: number;
  shouldRetry: (error: Error) => boolean;
  onRetry: (attempt: number, error: Error) => void;
}
```

## 🚀 长期规划 (3-6个月)

### 1. 高级功能

#### 增量扫描
- [ ] 实现文件系统变更检测
- [ ] 添加增量扫描模式
- [ ] 优化增量更新性能

#### 分布式扫描
- [ ] 设计分布式扫描架构
- [ ] 实现任务分片和调度
- [ ] 添加节点协调机制

### 2. 机器学习优化

#### 智能参数调优
- [ ] 收集历史性能数据
- [ ] 训练参数优化模型
- [ ] 实现自动参数调整

#### 预测性优化
- [ ] 实现扫描时间预测
- [ ] 添加资源需求预测
- [ ] 实现智能调度

## 🔍 需要用户决策的问题

### 1. 部署策略选择

**问题**: 选择部署策略

**选项**:
- **保守策略**: 先在测试环境验证，然后渐进式生产部署
- **激进策略**: 直接在生产环境启用优化模式
- **混合策略**: 部分功能启用优化，部分保持原有模式

**建议**: 选择保守策略，确保稳定性

### 2. 资源配置决策

**问题**: 服务器资源配置

**需要确认**:
- 当前服务器 CPU 核心数
- 可用内存大小
- 数据库连接池限制
- 磁盘 I/O 性能

**建议配置**:
```bash
# 根据服务器配置调整
# 4核心服务器
SCANNER_MAX_CONCURRENCY=8

# 8核心服务器
SCANNER_MAX_CONCURRENCY=16

# 16核心服务器
SCANNER_MAX_CONCURRENCY=32
```

### 3. 监控工具选择

**问题**: 选择性能监控工具

**选项**:
- **内置监控**: 使用项目内置的性能指标
- **Prometheus + Grafana**: 专业监控解决方案
- **云服务监控**: 使用云平台提供的监控服务

**建议**: 先使用内置监控，后续可扩展到专业监控工具

## 📞 支持和联系

### 技术支持

如果在部署或使用过程中遇到问题，请提供以下信息：

1. **环境信息**:
   - Node.js 版本
   - 数据库类型和版本
   - 服务器配置（CPU、内存）

2. **错误信息**:
   - 完整的错误日志
   - 性能指标数据
   - 复现步骤

3. **配置信息**:
   - 扫描器配置参数
   - 环境变量设置
   - 数据库连接配置

### 文档参考

- **架构文档**: `docs/scanner_performance/DESIGN_scanner_performance.md`
- **使用指南**: `docs/scanner_performance/FINAL_scanner_performance.md`
- **验收报告**: `docs/scanner_performance/ACCEPTANCE_scanner_performance.md`

### 快速开始

```typescript
// 最简单的启用方式
const scanner = new FileScanner(prisma, logger, {
  enableOptimizations: true
});

// 监控性能
const result = await scanner.scan(options);
const metrics = scanner.getPerformanceMetrics();
console.log('性能报告:', metrics);
```

---

**注意**: 请按优先级处理上述事项，🚨 标记的事项需要立即处理，📋 标记的事项建议在短期内完成。