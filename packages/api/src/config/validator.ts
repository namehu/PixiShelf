import { AppConfig, ConfigValidationResult } from './types';

/**
 * 配置验证器
 * 验证配置的完整性和有效性
 */
export function validateConfig(config: AppConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 验证应用基础配置
  validateAppConfig(config, errors, warnings);
  
  // 验证扫描器配置
  validateScannerConfig(config.scanner, errors, warnings);
  
  // 验证数据库配置
  validateDatabaseConfig(config.database, errors, warnings);
  
  // 验证服务器配置
  validateServerConfig(config.server, errors, warnings);
  
  // 验证认证配置
  validateAuthConfig(config.auth, errors, warnings);
  
  // 验证日志配置
  validateLogConfig(config.log, errors, warnings);
  
  // 验证监控配置
  validateMonitoringConfig(config.monitoring, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证应用基础配置
 */
function validateAppConfig(config: AppConfig, errors: string[], warnings: string[]): void {
  if (!config.env) {
    errors.push('env is required');
  } else if (!['development', 'production', 'test'].includes(config.env)) {
    errors.push('env must be one of: development, production, test');
  }

  if (!config.appName || config.appName.trim().length === 0) {
    errors.push('appName is required and cannot be empty');
  }

  if (!config.version || config.version.trim().length === 0) {
    errors.push('version is required and cannot be empty');
  }

  // 生产环境特殊检查
  if (config.env === 'production') {
    if (config.appName === 'PixiShelf API') {
      warnings.push('Consider customizing appName for production environment');
    }
  }
}

/**
 * 验证扫描器配置
 */
function validateScannerConfig(config: AppConfig['scanner'], errors: string[], warnings: string[]): void {
  if (typeof config.enableOptimizations !== 'boolean') {
    errors.push('scanner.enableOptimizations must be a boolean');
  }

  if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency <= 0) {
    errors.push('scanner.maxConcurrency must be a positive integer');
  } else if (config.maxConcurrency > 100) {
    warnings.push('scanner.maxConcurrency is very high (>100), this may cause resource exhaustion');
  } else if (config.maxConcurrency === 1) {
    warnings.push('scanner.maxConcurrency is 1, consider increasing for better performance');
  }

  if (!Number.isInteger(config.batchSize) || config.batchSize <= 0) {
    errors.push('scanner.batchSize must be a positive integer');
  } else if (config.batchSize > 10000) {
    warnings.push('scanner.batchSize is very large (>10000), this may cause memory issues');
  } else if (config.batchSize < 10) {
    warnings.push('scanner.batchSize is very small (<10), this may reduce performance');
  }

  if (!Number.isInteger(config.cacheSizeLimit) || config.cacheSizeLimit <= 0) {
    errors.push('scanner.cacheSizeLimit must be a positive integer');
  } else if (config.cacheSizeLimit > 100000) {
    warnings.push('scanner.cacheSizeLimit is very large (>100000), this may cause memory issues');
  }

  if (typeof config.enablePerformanceLogging !== 'boolean') {
    errors.push('scanner.enablePerformanceLogging must be a boolean');
  }

  if (!Number.isInteger(config.performanceLogInterval) || config.performanceLogInterval < 1000) {
    errors.push('scanner.performanceLogInterval must be an integer >= 1000ms');
  }
}

/**
 * 验证数据库配置
 */
function validateDatabaseConfig(config: AppConfig['database'], errors: string[], warnings: string[]): void {
  if (!config.url || config.url.trim().length === 0) {
    errors.push('database.url is required and cannot be empty');
  } else {
    // 基本的数据库URL格式检查
    const urlPattern = /^(postgresql|postgres|mysql|sqlite):\/\//;
    if (!urlPattern.test(config.url)) {
      errors.push('database.url must be a valid database connection string');
    }
  }

  if (!Number.isInteger(config.connectionLimit) || config.connectionLimit <= 0) {
    errors.push('database.connectionLimit must be a positive integer');
  } else if (config.connectionLimit > 200) {
    warnings.push('database.connectionLimit is very high (>200), ensure your database can handle this');
  } else if (config.connectionLimit < 5) {
    warnings.push('database.connectionLimit is very low (<5), this may cause performance issues');
  }

  if (!Number.isInteger(config.connectionTimeout) || config.connectionTimeout < 5000) {
    errors.push('database.connectionTimeout must be an integer >= 5000ms');
  }

  if (!Number.isInteger(config.queryTimeout) || config.queryTimeout < 5000) {
    errors.push('database.queryTimeout must be an integer >= 5000ms');
  }

  if (typeof config.enableQueryLogging !== 'boolean') {
    errors.push('database.enableQueryLogging must be a boolean');
  }
}

/**
 * 验证服务器配置
 */
function validateServerConfig(config: AppConfig['server'], errors: string[], warnings: string[]): void {
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    errors.push('server.port must be an integer between 1 and 65535');
  } else if (config.port < 1024) {
    warnings.push('server.port is below 1024, ensure you have proper permissions');
  }

  if (!config.host || config.host.trim().length === 0) {
    errors.push('server.host is required and cannot be empty');
  }

  if (typeof config.enableCors !== 'boolean') {
    errors.push('server.enableCors must be a boolean');
  }

  if (!config.bodyLimit || config.bodyLimit.trim().length === 0) {
    errors.push('server.bodyLimit is required and cannot be empty');
  } else {
    // 基本的大小格式检查
    const sizePattern = /^\d+[kmg]?b?$/i;
    if (!sizePattern.test(config.bodyLimit)) {
      errors.push('server.bodyLimit must be a valid size string (e.g., "10mb", "1gb")');
    }
  }

  if (typeof config.enableRequestLogging !== 'boolean') {
    errors.push('server.enableRequestLogging must be a boolean');
  }
}

/**
 * 验证认证配置
 */
function validateAuthConfig(config: AppConfig['auth'], errors: string[], warnings: string[]): void {
  if (!config.jwtSecret || config.jwtSecret.trim().length === 0) {
    errors.push('auth.jwtSecret is required and cannot be empty');
  } else if (config.jwtSecret.length < 32) {
    errors.push('auth.jwtSecret must be at least 32 characters long');
  } else if (config.jwtSecret === 'your-secret-key-change-in-production') {
    warnings.push('auth.jwtSecret is using the default value, change it for production');
  }

  if (!config.jwtExpiresIn || config.jwtExpiresIn.trim().length === 0) {
    errors.push('auth.jwtExpiresIn is required and cannot be empty');
  } else {
    // 基本的时间格式检查
    const timePattern = /^\d+[smhdw]$/;
    if (!timePattern.test(config.jwtExpiresIn)) {
      errors.push('auth.jwtExpiresIn must be a valid time string (e.g., "7d", "24h", "60m")');
    }
  }

  if (typeof config.enableAuth !== 'boolean') {
    errors.push('auth.enableAuth must be a boolean');
  }

  if (!Number.isInteger(config.bcryptRounds) || config.bcryptRounds < 10 || config.bcryptRounds > 15) {
    errors.push('auth.bcryptRounds must be an integer between 10 and 15');
  } else if (config.bcryptRounds < 12) {
    warnings.push('auth.bcryptRounds is below 12, consider increasing for better security');
  }
}

/**
 * 验证日志配置
 */
function validateLogConfig(config: AppConfig['log'], errors: string[], warnings: string[]): void {
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(config.level)) {
    errors.push(`log.level must be one of: ${validLevels.join(', ')}`);
  }

  if (typeof config.enableFileLogging !== 'boolean') {
    errors.push('log.enableFileLogging must be a boolean');
  }

  if (config.enableFileLogging && (!config.logFilePath || config.logFilePath.trim().length === 0)) {
    errors.push('log.logFilePath is required when enableFileLogging is true');
  }

  if (typeof config.enableStructuredLogging !== 'boolean') {
    errors.push('log.enableStructuredLogging must be a boolean');
  }

  const validFormats = ['json', 'pretty'];
  if (!validFormats.includes(config.format)) {
    errors.push(`log.format must be one of: ${validFormats.join(', ')}`);
  }
}

/**
 * 验证监控配置
 */
function validateMonitoringConfig(config: AppConfig['monitoring'], errors: string[], warnings: string[]): void {
  if (typeof config.enabled !== 'boolean') {
    errors.push('monitoring.enabled must be a boolean');
  }

  if (config.metricsPort !== undefined) {
    if (!Number.isInteger(config.metricsPort) || config.metricsPort <= 0 || config.metricsPort > 65535) {
      errors.push('monitoring.metricsPort must be an integer between 1 and 65535');
    }
  }

  if (!Number.isInteger(config.healthCheckInterval) || config.healthCheckInterval < 5000) {
    errors.push('monitoring.healthCheckInterval must be an integer >= 5000ms');
  }

  // 验证告警阈值
  const thresholds = config.alertThresholds;
  
  if (!Number.isInteger(thresholds.scanTimeMs) || thresholds.scanTimeMs <= 0) {
    errors.push('monitoring.alertThresholds.scanTimeMs must be a positive integer');
  }

  if (!Number.isInteger(thresholds.memoryUsageMB) || thresholds.memoryUsageMB <= 0) {
    errors.push('monitoring.alertThresholds.memoryUsageMB must be a positive integer');
  }

  if (typeof thresholds.errorRate !== 'number' || thresholds.errorRate < 0 || thresholds.errorRate > 1) {
    errors.push('monitoring.alertThresholds.errorRate must be a number between 0 and 1');
  }

  if (typeof thresholds.cacheHitRate !== 'number' || thresholds.cacheHitRate < 0 || thresholds.cacheHitRate > 1) {
    errors.push('monitoring.alertThresholds.cacheHitRate must be a number between 0 and 1');
  }

  if (typeof thresholds.concurrencyUtilization !== 'number' || thresholds.concurrencyUtilization < 0 || thresholds.concurrencyUtilization > 1) {
    errors.push('monitoring.alertThresholds.concurrencyUtilization must be a number between 0 and 1');
  }
}

/**
 * 验证配置的环境一致性
 */
export function validateEnvironmentConsistency(config: AppConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.env === 'production') {
    // 生产环境特殊检查
    if (config.log.level === 'debug') {
      warnings.push('Debug logging is enabled in production environment');
    }
    
    if (config.database.enableQueryLogging) {
      warnings.push('Database query logging is enabled in production environment');
    }
    
    if (config.auth.jwtSecret === 'your-secret-key-change-in-production') {
      errors.push('Default JWT secret is being used in production environment');
    }
    
    if (!config.monitoring.enabled) {
      warnings.push('Monitoring is disabled in production environment');
    }
  }

  if (config.env === 'development') {
    // 开发环境建议
    if (!config.scanner.enablePerformanceLogging) {
      warnings.push('Performance logging is disabled in development environment');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 快速验证配置的关键字段
 */
export function quickValidate(config: Partial<AppConfig>): boolean {
  try {
    // 检查必需字段
    if (!config.database?.url) return false;
    if (!config.auth?.jwtSecret) return false;
    if (!config.server?.port) return false;
    
    // 检查基本类型
    if (typeof config.scanner?.maxConcurrency !== 'number') return false;
    if (typeof config.scanner?.batchSize !== 'number') return false;
    
    return true;
  } catch {
    return false;
  }
}