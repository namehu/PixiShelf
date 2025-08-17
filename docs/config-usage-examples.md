# 配置系统使用指南

本文档展示如何在 PixiShelf API 中使用全局配置系统。

## 基本使用

### 1. 初始化配置

在应用启动时初始化配置系统：

```typescript
import { initializeConfig } from './config';

// 应用启动时调用
await initializeConfig({
  useEnvVars: true,    // 从环境变量加载配置
  validate: true,      // 验证配置有效性
  configPath: './config.json' // 可选：从文件加载配置
});
```

### 2. 获取配置

```typescript
import { config, getConfig, getConfigSection, getConfigValue } from './config';

// 方式1: 使用便捷访问器（推荐）
const serverConfig = config.server;
const isProduction = config.isProduction;
const scannerEnabled = config.scanner.enableOptimizations;

// 方式2: 获取完整配置
const fullConfig = getConfig();

// 方式3: 获取特定配置节
const databaseConfig = getConfigSection('database');

// 方式4: 使用路径获取嵌套值
const maxConcurrency = getConfigValue<number>('scanner.maxConcurrency');
const jwtSecret = getConfigValue<string>('auth.jwtSecret');
```

### 3. 类型安全的配置访问

```typescript
import { useConfig } from './config';

// 获取完整配置（带类型提示）
const config = useConfig();

// 获取特定配置节（带类型提示）
const serverConfig = useConfig('server');

// 获取嵌套配置值（需要指定类型）
const batchSize = useConfig<number>('scanner.batchSize');
```

## 高级使用

### 1. 监听配置变化

```typescript
import { watchConfig } from './config';

// 监听配置变化
const unwatch = watchConfig((newConfig) => {
  console.log('Configuration updated:', newConfig);
  // 重新初始化依赖配置的组件
});

// 取消监听
unwatch();
```

### 2. 动态更新配置

```typescript
import { updateConfig, setConfigValue } from './config';

// 更新整个配置节
await updateConfig({
  scanner: {
    enableOptimizations: false,
    maxConcurrency: 4,
  }
}, {
  validate: true,    // 验证更新后的配置
  persist: true,     // 持久化到文件
});

// 更新单个配置值
await setConfigValue('scanner.batchSize', 1000, {
  validate: true
});
```

### 3. 配置装饰器

```typescript
import { ConfigInject } from './config';

class ScannerService {
  @ConfigInject('scanner')
  async performScan(scannerConfig: ScannerConfig) {
    // scannerConfig 自动注入当前的扫描器配置
    const scanner = new FileScanner(this.prisma, this.logger, {
      enableOptimizations: scannerConfig.enableOptimizations,
      maxConcurrency: scannerConfig.maxConcurrency
    });
    
    return await scanner.scan(options);
  }
}
```

## 实际应用场景

### 1. 在服务中使用配置

```typescript
// services/scanner.ts
import { config } from '../config';

export class FileScanner {
  constructor(
    private prisma: PrismaClient,
    private logger: FastifyInstance['log'],
    options?: Partial<ScannerOptions>
  ) {
    // 使用配置系统的默认值，允许选项覆盖
    this.options = {
      enableOptimizations: config.scanner.enableOptimizations,
      maxConcurrency: config.scanner.maxConcurrency,
      batchSize: config.scanner.batchSize,
      ...options
    };
  }
}
```

### 2. 在路由中使用配置

```typescript
// routes/scan.ts
import { config } from '../config';

export default async function scanRoutes(server: FastifyInstance) {
  server.post('/scan', async (req, reply) => {
    // 使用配置系统的扫描器配置
    const scanner = new FileScanner(server.prisma, server.log, {
      enableOptimizations: config.scanner.enableOptimizations,
      maxConcurrency: config.scanner.maxConcurrency
    });
    
    const result = await scanner.scan({
      scanPath: config.getValue('scanPath'),
      onProgress: (progress) => {
        // 处理进度
      }
    });
    
    return result;
  });
}
```

### 3. 在中间件中使用配置

```typescript
// plugins/auth.ts
import { config } from '../config';

export default async function authPlugin(server: FastifyInstance) {
  if (!config.auth.enableAuth) {
    // 如果认证被禁用，跳过认证中间件
    return;
  }
  
  server.register(require('@fastify/jwt'), {
    secret: config.auth.jwtSecret,
    expiresIn: config.auth.jwtExpiresIn
  });
  
  server.addHook('preHandler', async (request, reply) => {
    // 认证逻辑
  });
}
```

### 4. 环境特定配置

```typescript
// 根据环境调整行为
if (config.isProduction) {
  // 生产环境特定逻辑
  logger.level = 'warn';
  enableDetailedLogging = false;
} else if (config.isDevelopment) {
  // 开发环境特定逻辑
  logger.level = 'debug';
  enableDetailedLogging = true;
}

// 使用监控配置
if (config.monitoring.enabled) {
  // 启用监控
  const metricsServer = createMetricsServer({
    port: config.monitoring.metricsPort,
    interval: config.monitoring.healthCheckInterval
  });
}
```

## 配置验证和健康检查

### 1. 验证配置

```typescript
import { validateCurrentConfig, checkConfigHealth } from './config';

// 验证当前配置
const validation = validateCurrentConfig();
if (!validation.isValid) {
  console.error('Configuration errors:', validation.errors);
}

// 检查配置健康状态
const health = checkConfigHealth();
if (!health.isHealthy) {
  console.error('Configuration issues:', health.issues);
}
if (health.recommendations.length > 0) {
  console.warn('Recommendations:', health.recommendations);
}
```

### 2. 配置摘要

```typescript
import { getConfigSummary } from './config';

// 获取配置摘要信息
const summary = getConfigSummary();
console.log('Configuration Summary:', {
  environment: summary.env,
  initialized: summary.initialized,
  configPath: summary.configPath,
  validation: summary.validation
});
```

## 最佳实践

### 1. 配置分层

```typescript
// 推荐的配置使用模式
class DatabaseService {
  private config = config.database;
  
  async connect() {
    return await createConnection({
      url: this.config.url,
      connectionLimit: this.config.connectionLimit,
      timeout: this.config.connectionTimeout
    });
  }
}
```

### 2. 配置缓存

```typescript
// 对于频繁访问的配置，可以缓存
class PerformanceService {
  private readonly scannerConfig = config.scanner;
  private readonly isOptimized = this.scannerConfig.enableOptimizations;
  
  processData() {
    if (this.isOptimized) {
      // 优化路径
    } else {
      // 标准路径
    }
  }
}
```

### 3. 配置验证

```typescript
// 在关键操作前验证配置
class CriticalService {
  async performCriticalOperation() {
    const health = checkConfigHealth();
    if (!health.isHealthy) {
      throw new Error(`Cannot perform operation: ${health.issues.join(', ')}`);
    }
    
    // 执行关键操作
  }
}
```

## 故障排除

### 1. 常见错误

```typescript
// 错误：配置未初始化
try {
  const config = getConfig();
} catch (error) {
  // Error: Configuration is not initialized. Call initializeConfig() first.
  await initializeConfig();
}

// 错误：必需的环境变量未设置
try {
  await initializeConfig();
} catch (error) {
  // Error: Missing required environment variables: DATABASE_URL, JWT_SECRET
  console.log('Please set the required environment variables');
}
```

### 2. 调试配置

```typescript
// 输出当前配置（开发环境）
if (config.isDevelopment) {
  console.log('Current configuration:', JSON.stringify(getConfig(), null, 2));
}

// 导出配置到文件进行调试
await exportConfig('./debug-config.json');
```

### 3. 配置重载

```typescript
// 重新加载配置（例如在配置文件更改后）
try {
  await reloadConfig();
  console.log('Configuration reloaded successfully');
} catch (error) {
  console.error('Failed to reload configuration:', error);
}
```

这个配置系统提供了完整的类型安全、环境变量支持、验证机制和便捷的访问接口，让你可以在应用的任何地方轻松使用配置。