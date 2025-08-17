import { AppConfig, ConfigOverrides } from './types';
import os from 'os';

/**
 * 获取默认配置
 * 提供所有配置项的合理默认值
 */
export function getDefaultConfig(): AppConfig {
  return {
    env: (process.env.NODE_ENV as any) || 'development',
    appName: 'PixiShelf API',
    version: '1.0.0',
    
    scanner: {
      enableOptimizations: true,
      maxConcurrency: Math.max(2, os.cpus().length * 2),
      batchSize: 500,
      cacheSizeLimit: 10000,
      enablePerformanceLogging: false,
      performanceLogInterval: 5000,
    },
    
    database: {
      url: process.env.DATABASE_URL || 'postgresql://localhost:5432/pixishelf',
      connectionLimit: 20,
      connectionTimeout: 30000,
      queryTimeout: 60000,
      enableQueryLogging: false,
    },
    
    server: {
      port: 3001,
      host: '0.0.0.0',
      enableCors: true,
      bodyLimit: '10mb',
      enableRequestLogging: true,
    },
    
    auth: {
      jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      jwtExpiresIn: '7d',
      enableAuth: false,
      bcryptRounds: 12,
    },
    
    log: {
      level: 'info',
      enableFileLogging: false,
      enableStructuredLogging: true,
      format: 'pretty',
    },
    
    monitoring: {
      enabled: false,
      healthCheckInterval: 30000,
      alertThresholds: {
        scanTimeMs: 300000,        // 5分钟
        memoryUsageMB: 1024,       // 1GB
        errorRate: 0.05,           // 5%
        cacheHitRate: 0.7,         // 70%
        concurrencyUtilization: 0.8, // 80%
      },
    },
  };
}

/**
 * 获取生产环境配置覆盖
 */
export function getProductionOverrides(): ConfigOverrides {
  return {
    log: {
      level: 'warn',
      enableFileLogging: true,
      logFilePath: '/var/log/pixishelf/app.log',
      enableStructuredLogging: true,
      format: 'json',
    },
    
    monitoring: {
      enabled: true,
      metricsPort: 9090,
      healthCheckInterval: 30000,
      alertThresholds: {
        scanTimeMs: 180000,        // 3分钟（生产环境更严格）
        memoryUsageMB: 2048,       // 2GB
        errorRate: 0.02,           // 2%
        cacheHitRate: 0.8,         // 80%
        concurrencyUtilization: 0.9, // 90%
      },
    },
    
    scanner: {
      enableOptimizations: true,
      enablePerformanceLogging: true,
      performanceLogInterval: 10000,
    },
    
    database: {
      connectionLimit: 50,
      enableQueryLogging: false, // 生产环境关闭查询日志
    },
    
    server: {
      enableRequestLogging: false, // 生产环境可能关闭请求日志
    },
  };
}

/**
 * 获取开发环境配置覆盖
 */
export function getDevelopmentOverrides(): ConfigOverrides {
  return {
    log: {
      level: 'debug',
      enableFileLogging: false,
      enableStructuredLogging: false,
      format: 'pretty',
    },
    
    scanner: {
      enablePerformanceLogging: true,
      performanceLogInterval: 3000,
    },
    
    database: {
      enableQueryLogging: true,
    },
    
    monitoring: {
      enabled: true,
      healthCheckInterval: 10000, // 开发环境更频繁的健康检查
    },
  };
}

/**
 * 获取测试环境配置覆盖
 */
export function getTestOverrides(): ConfigOverrides {
  return {
    log: {
      level: 'error', // 测试时只显示错误
      enableFileLogging: false,
      enableStructuredLogging: false,
      format: 'pretty',
    },
    
    scanner: {
      maxConcurrency: 2, // 测试环境限制并发
      batchSize: 10,     // 小批量测试
      enablePerformanceLogging: false,
    },
    
    database: {
      connectionLimit: 5,
      enableQueryLogging: false,
    },
    
    server: {
      port: 0, // 随机端口
      enableRequestLogging: false,
    },
    
    monitoring: {
      enabled: false,
    },
  };
}

/**
 * 根据环境获取配置覆盖
 */
export function getEnvironmentOverrides(env: string): ConfigOverrides {
  switch (env) {
    case 'production':
      return getProductionOverrides();
    case 'development':
      return getDevelopmentOverrides();
    case 'test':
      return getTestOverrides();
    default:
      return {};
  }
}