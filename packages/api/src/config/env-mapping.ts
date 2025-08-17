import { EnvVarMapping } from './types';

/**
 * 环境变量到配置路径的映射
 * 定义如何从环境变量加载配置值
 */
export const envVarMapping: EnvVarMapping = {
  // 应用基础配置
  'env': {
    envVar: 'NODE_ENV',
    type: 'string',
    defaultValue: 'development',
    validate: (value) => ['development', 'production', 'test'].includes(value),
  },
  'appName': {
    envVar: 'APP_NAME',
    type: 'string',
    defaultValue: 'PixiShelf API',
  },
  'version': {
    envVar: 'APP_VERSION',
    type: 'string',
    defaultValue: '1.0.0',
  },

  // 扫描器配置
  'scanner.enableOptimizations': {
    envVar: 'SCANNER_ENABLE_OPTIMIZATIONS',
    type: 'boolean',
    defaultValue: true,
  },
  'scanner.maxConcurrency': {
    envVar: 'SCANNER_MAX_CONCURRENCY',
    type: 'number',
    defaultValue: 8,
    validate: (value) => value > 0 && value <= 100,
  },
  'scanner.batchSize': {
    envVar: 'SCANNER_BATCH_SIZE',
    type: 'number',
    defaultValue: 500,
    validate: (value) => value > 0 && value <= 10000,
  },
  'scanner.cacheSizeLimit': {
    envVar: 'SCANNER_CACHE_SIZE_LIMIT',
    type: 'number',
    defaultValue: 10000,
    validate: (value) => value > 0,
  },
  'scanner.enablePerformanceLogging': {
    envVar: 'SCANNER_ENABLE_PERFORMANCE_LOGGING',
    type: 'boolean',
    defaultValue: false,
  },
  'scanner.performanceLogInterval': {
    envVar: 'SCANNER_PERFORMANCE_LOG_INTERVAL',
    type: 'number',
    defaultValue: 5000,
    validate: (value) => value >= 1000,
  },

  // 数据库配置
  'database.url': {
    envVar: 'DATABASE_URL',
    type: 'string',
    required: true,
  },
  'database.connectionLimit': {
    envVar: 'DATABASE_CONNECTION_LIMIT',
    type: 'number',
    defaultValue: 20,
    validate: (value) => value > 0 && value <= 200,
  },
  'database.connectionTimeout': {
    envVar: 'DATABASE_CONNECTION_TIMEOUT',
    type: 'number',
    defaultValue: 30000,
    validate: (value) => value >= 5000,
  },
  'database.queryTimeout': {
    envVar: 'DATABASE_QUERY_TIMEOUT',
    type: 'number',
    defaultValue: 60000,
    validate: (value) => value >= 5000,
  },
  'database.enableQueryLogging': {
    envVar: 'DATABASE_ENABLE_QUERY_LOGGING',
    type: 'boolean',
    defaultValue: false,
  },

  // 服务器配置
  'server.port': {
    envVar: 'PORT',
    type: 'number',
    defaultValue: 3001,
    validate: (value) => value > 0 && value <= 65535,
  },
  'server.host': {
    envVar: 'HOST',
    type: 'string',
    defaultValue: '0.0.0.0',
  },
  'server.enableCors': {
    envVar: 'ENABLE_CORS',
    type: 'boolean',
    defaultValue: true,
  },
  'server.bodyLimit': {
    envVar: 'BODY_LIMIT',
    type: 'string',
    defaultValue: '10mb',
  },
  'server.enableRequestLogging': {
    envVar: 'ENABLE_REQUEST_LOGGING',
    type: 'boolean',
    defaultValue: true,
  },

  // 认证配置
  'auth.jwtSecret': {
    envVar: 'JWT_SECRET',
    type: 'string',
    required: true,
    validate: (value) => value.length >= 32,
  },
  'auth.jwtExpiresIn': {
    envVar: 'JWT_EXPIRES_IN',
    type: 'string',
    defaultValue: '7d',
  },
  'auth.enableAuth': {
    envVar: 'ENABLE_AUTH',
    type: 'boolean',
    defaultValue: false,
  },
  'auth.bcryptRounds': {
    envVar: 'BCRYPT_ROUNDS',
    type: 'number',
    defaultValue: 12,
    validate: (value) => value >= 10 && value <= 15,
  },

  // 日志配置
  'log.level': {
    envVar: 'LOG_LEVEL',
    type: 'string',
    defaultValue: 'info',
    validate: (value) => ['debug', 'info', 'warn', 'error'].includes(value),
  },
  'log.enableFileLogging': {
    envVar: 'LOG_ENABLE_FILE_LOGGING',
    type: 'boolean',
    defaultValue: false,
  },
  'log.logFilePath': {
    envVar: 'LOG_FILE_PATH',
    type: 'string',
  },
  'log.enableStructuredLogging': {
    envVar: 'LOG_ENABLE_STRUCTURED_LOGGING',
    type: 'boolean',
    defaultValue: true,
  },
  'log.format': {
    envVar: 'LOG_FORMAT',
    type: 'string',
    defaultValue: 'pretty',
    validate: (value) => ['json', 'pretty'].includes(value),
  },

  // 监控配置
  'monitoring.enabled': {
    envVar: 'MONITORING_ENABLED',
    type: 'boolean',
    defaultValue: false,
  },
  'monitoring.metricsPort': {
    envVar: 'MONITORING_METRICS_PORT',
    type: 'number',
    validate: (value) => value > 0 && value <= 65535,
  },
  'monitoring.healthCheckInterval': {
    envVar: 'MONITORING_HEALTH_CHECK_INTERVAL',
    type: 'number',
    defaultValue: 30000,
    validate: (value) => value >= 5000,
  },

  // 监控告警阈值
  'monitoring.alertThresholds.scanTimeMs': {
    envVar: 'ALERT_THRESHOLD_SCAN_TIME_MS',
    type: 'number',
    defaultValue: 300000,
    validate: (value) => value > 0,
  },
  'monitoring.alertThresholds.memoryUsageMB': {
    envVar: 'ALERT_THRESHOLD_MEMORY_USAGE_MB',
    type: 'number',
    defaultValue: 1024,
    validate: (value) => value > 0,
  },
  'monitoring.alertThresholds.errorRate': {
    envVar: 'ALERT_THRESHOLD_ERROR_RATE',
    type: 'number',
    defaultValue: 0.05,
    validate: (value) => value >= 0 && value <= 1,
  },
  'monitoring.alertThresholds.cacheHitRate': {
    envVar: 'ALERT_THRESHOLD_CACHE_HIT_RATE',
    type: 'number',
    defaultValue: 0.7,
    validate: (value) => value >= 0 && value <= 1,
  },
  'monitoring.alertThresholds.concurrencyUtilization': {
    envVar: 'ALERT_THRESHOLD_CONCURRENCY_UTILIZATION',
    type: 'number',
    defaultValue: 0.8,
    validate: (value) => value >= 0 && value <= 1,
  },
};

/**
 * 获取所有环境变量名称
 */
export function getAllEnvVarNames(): string[] {
  return Object.values(envVarMapping).map(mapping => mapping.envVar);
}

/**
 * 获取必需的环境变量
 */
export function getRequiredEnvVars(): string[] {
  return Object.values(envVarMapping)
    .filter(mapping => mapping.required)
    .map(mapping => mapping.envVar);
}

/**
 * 检查必需的环境变量是否已设置
 */
export function checkRequiredEnvVars(): { missing: string[]; isValid: boolean } {
  const required = getRequiredEnvVars();
  const missing = required.filter(envVar => !process.env[envVar]);
  
  return {
    missing,
    isValid: missing.length === 0,
  };
}

/**
 * 生成环境变量示例文件内容
 */
export function generateEnvExample(): string {
  const lines: string[] = [
    '# PixiShelf API 环境变量配置示例',
    '# 复制此文件为 .env 并根据需要修改配置值',
    '',
  ];

  const sections = {
    '应用基础配置': ['NODE_ENV', 'APP_NAME', 'APP_VERSION'],
    '数据库配置': ['DATABASE_URL', 'DATABASE_CONNECTION_LIMIT', 'DATABASE_CONNECTION_TIMEOUT', 'DATABASE_QUERY_TIMEOUT', 'DATABASE_ENABLE_QUERY_LOGGING'],
    '服务器配置': ['PORT', 'HOST', 'ENABLE_CORS', 'BODY_LIMIT', 'ENABLE_REQUEST_LOGGING'],
    '认证配置': ['JWT_SECRET', 'JWT_EXPIRES_IN', 'ENABLE_AUTH', 'BCRYPT_ROUNDS'],
    '扫描器配置': ['SCANNER_ENABLE_OPTIMIZATIONS', 'SCANNER_MAX_CONCURRENCY', 'SCANNER_BATCH_SIZE', 'SCANNER_CACHE_SIZE_LIMIT', 'SCANNER_ENABLE_PERFORMANCE_LOGGING', 'SCANNER_PERFORMANCE_LOG_INTERVAL'],
    '日志配置': ['LOG_LEVEL', 'LOG_ENABLE_FILE_LOGGING', 'LOG_FILE_PATH', 'LOG_ENABLE_STRUCTURED_LOGGING', 'LOG_FORMAT'],
    '监控配置': ['MONITORING_ENABLED', 'MONITORING_METRICS_PORT', 'MONITORING_HEALTH_CHECK_INTERVAL'],
    '告警阈值配置': ['ALERT_THRESHOLD_SCAN_TIME_MS', 'ALERT_THRESHOLD_MEMORY_USAGE_MB', 'ALERT_THRESHOLD_ERROR_RATE', 'ALERT_THRESHOLD_CACHE_HIT_RATE', 'ALERT_THRESHOLD_CONCURRENCY_UTILIZATION'],
  };

  for (const [sectionName, envVars] of Object.entries(sections)) {
    lines.push(`# ${sectionName}`);
    
    for (const envVar of envVars) {
      const mapping = Object.values(envVarMapping).find(m => m.envVar === envVar);
      if (mapping) {
        const isRequired = mapping.required ? ' (必需)' : '';
        const defaultValue = mapping.defaultValue !== undefined ? mapping.defaultValue : '';
        lines.push(`${envVar}=${defaultValue}${isRequired}`);
      }
    }
    
    lines.push('');
  }

  return lines.join('\n');
}