import { FastifyInstance } from 'fastify';
import { EventEmitter } from 'events';
import { DatabaseOptimizer } from './DatabaseOptimizer';
import { ProgressTracker } from './ProgressTracker';
import { ConcurrencyController } from './ConcurrencyController';
import { StreamingBatchProcessor } from './StreamingBatchProcessor';

/**
 * 性能监控配置
 */
interface PerformanceMonitorConfig {
  monitoringInterval: number;        // 监控间隔(ms)
  alertThresholds: AlertThresholds;  // 告警阈值
  enableRealTimeAlerts: boolean;     // 启用实时告警
  enableMetricsCollection: boolean;  // 启用指标收集
  maxMetricsHistory: number;         // 最大历史记录数
}

/**
 * 告警阈值配置
 */
interface AlertThresholds {
  blockingDuration: number;          // 阻塞时间阈值(ms)
  memoryUsage: number;               // 内存使用率阈值(%)
  databaseFailureRate: number;       // 数据库失败率阈值(%)
  averageQueryTime: number;          // 平均查询时间阈值(ms)
  connectionPoolUsage: number;       // 连接池使用率阈值(%)
  queueLength: number;               // 队列长度阈值
  throughputDrop: number;            // 吞吐量下降阈值(%)
}

/**
 * 性能指标
 */
interface PerformanceMetrics {
  timestamp: number;
  
  // 系统指标
  system: {
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      external: number;
      rss: number;
    };
    cpuUsage: {
      user: number;
      system: number;
    };
  };
  
  // 扫描指标
  scanning: {
    processed: number;
    total: number;
    rate: number; // files per second
    percentage: number;
  };
  
  // 批量处理指标
  batching: {
    queueLength: number;
    processing: number;
    completed: number;
    failureRate: number;
  };
  
  // 数据库指标
  database: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageQueryTime: number;
    connectionPoolUsage: number;
    batchOperations: number;
  };
  
  // 并发指标
  concurrency: {
    active: number;
    queued: number;
    maxConcurrency: number;
    utilization: number;
  };
}

/**
 * 性能告警
 */
interface PerformanceAlert {
  id: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  type: 'blocking' | 'memory' | 'database' | 'throughput' | 'queue';
  message: string;
  metrics: Partial<PerformanceMetrics>;
  resolved?: boolean;
  resolvedAt?: number;
}

/**
 * 性能趋势分析
 */
interface PerformanceTrend {
  metric: string;
  direction: 'improving' | 'stable' | 'degrading';
  changeRate: number; // percentage change
  confidence: number; // 0-1
}

/**
 * 阻塞检测器
 */
class BlockingDetector extends EventEmitter {
  private lastProgressTime: number = Date.now();
  private blockingThreshold: number;
  private monitoringInterval?: NodeJS.Timeout;
  private currentBlockingDuration: number = 0;
  private blockingStartTime?: number;
  
  constructor(blockingThreshold: number = 5000) {
    super();
    this.blockingThreshold = blockingThreshold;
  }
  
  updateProgress(): void {
    const now = Date.now();
    
    if (this.blockingStartTime) {
      // 阻塞已解除
      const blockingDuration = now - this.blockingStartTime;
      this.emit('blockingResolved', {
        duration: blockingDuration,
        resolvedAt: now
      });
      this.blockingStartTime = undefined;
    }
    
    this.lastProgressTime = now;
    this.currentBlockingDuration = 0;
  }
  
  startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const now = Date.now();
      const duration = now - this.lastProgressTime;
      
      if (duration > this.blockingThreshold) {
        if (!this.blockingStartTime) {
          this.blockingStartTime = this.lastProgressTime + this.blockingThreshold;
          this.emit('blockingDetected', {
            duration,
            startTime: this.blockingStartTime,
            threshold: this.blockingThreshold
          });
        }
        
        this.currentBlockingDuration = duration;
        this.emit('blockingContinues', {
          duration,
          startTime: this.blockingStartTime
        });
      }
    }, 1000);
  }
  
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
  
  getCurrentBlockingDuration(): number {
    return this.currentBlockingDuration;
  }
  
  isBlocked(): boolean {
    return this.currentBlockingDuration > this.blockingThreshold;
  }
}

/**
 * 趋势分析器
 */
class TrendAnalyzer {
  private metricsHistory: PerformanceMetrics[] = [];
  private maxHistory: number;
  
  constructor(maxHistory: number = 100) {
    this.maxHistory = maxHistory;
  }
  
  addMetrics(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);
    
    if (this.metricsHistory.length > this.maxHistory) {
      this.metricsHistory.shift();
    }
  }
  
  analyzeTrends(): PerformanceTrend[] {
    if (this.metricsHistory.length < 10) {
      return []; // 需要足够的数据点
    }
    
    const trends: PerformanceTrend[] = [];
    
    // 分析扫描速率趋势
    trends.push(this.analyzeTrend(
      'scanning.rate',
      this.metricsHistory.map(m => m.scanning.rate)
    ));
    
    // 分析数据库查询时间趋势
    trends.push(this.analyzeTrend(
      'database.averageQueryTime',
      this.metricsHistory.map(m => m.database.averageQueryTime)
    ));
    
    // 分析内存使用趋势
    trends.push(this.analyzeTrend(
      'system.memoryUsage.heapUsed',
      this.metricsHistory.map(m => m.system.memoryUsage.heapUsed)
    ));
    
    // 分析队列长度趋势
    trends.push(this.analyzeTrend(
      'batching.queueLength',
      this.metricsHistory.map(m => m.batching.queueLength)
    ));
    
    return trends;
  }
  
  private analyzeTrend(metricName: string, values: number[]): PerformanceTrend {
    const recentValues = values.slice(-10); // 最近10个数据点
    const olderValues = values.slice(-20, -10); // 之前10个数据点
    
    if (olderValues.length === 0) {
      return {
        metric: metricName,
        direction: 'stable',
        changeRate: 0,
        confidence: 0
      };
    }
    
    const recentAvg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    const olderAvg = olderValues.reduce((a, b) => a + b, 0) / olderValues.length;
    
    const changeRate = olderAvg !== 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    const confidence = Math.min(recentValues.length / 10, 1);
    
    let direction: PerformanceTrend['direction'];
    if (Math.abs(changeRate) < 5) {
      direction = 'stable';
    } else if (changeRate > 0) {
      // 对于某些指标，增长是好的（如扫描速率），对于其他指标是坏的（如查询时间）
      direction = this.isPositiveTrend(metricName) ? 'improving' : 'degrading';
    } else {
      direction = this.isPositiveTrend(metricName) ? 'degrading' : 'improving';
    }
    
    return {
      metric: metricName,
      direction,
      changeRate: Math.abs(changeRate),
      confidence
    };
  }
  
  private isPositiveTrend(metricName: string): boolean {
    // 定义哪些指标的增长是积极的
    const positiveMetrics = [
      'scanning.rate',
      'concurrency.utilization'
    ];
    
    return positiveMetrics.some(metric => metricName.includes(metric));
  }
}

/**
 * 性能监控器
 * 统一监控所有组件的性能指标
 */
export class PerformanceMonitor extends EventEmitter {
  private logger: FastifyInstance['log'];
  private config: PerformanceMonitorConfig;
  
  // 组件引用
  private dbOptimizer?: DatabaseOptimizer;
  private progressTracker?: ProgressTracker;
  private concurrencyController?: ConcurrencyController;
  private streamingBatchProcessor?: StreamingBatchProcessor;
  
  // 监控组件
  private blockingDetector: BlockingDetector;
  private trendAnalyzer: TrendAnalyzer;
  
  // 状态
  private monitoringInterval?: NodeJS.Timeout;
  private metricsHistory: PerformanceMetrics[] = [];
  private activeAlerts: Map<string, PerformanceAlert> = new Map();
  private isMonitoring: boolean = false;
  
  constructor(
    logger: FastifyInstance['log'],
    config: Partial<PerformanceMonitorConfig> = {}
  ) {
    super();
    this.logger = logger;
    
    this.config = {
      monitoringInterval: 2000,
      enableRealTimeAlerts: true,
      enableMetricsCollection: true,
      maxMetricsHistory: 1000,
      alertThresholds: {
        blockingDuration: 5000,
        memoryUsage: 85,
        databaseFailureRate: 5,
        averageQueryTime: 3000,
        connectionPoolUsage: 80,
        queueLength: 1000,
        throughputDrop: 50,
      },
      ...config,
    };
    
    this.blockingDetector = new BlockingDetector(this.config.alertThresholds.blockingDuration);
    this.trendAnalyzer = new TrendAnalyzer(this.config.maxMetricsHistory);
    
    this.setupEventListeners();
  }
  
  /**
   * 注册组件
   */
  registerComponents(components: {
    dbOptimizer?: DatabaseOptimizer;
    progressTracker?: ProgressTracker;
    concurrencyController?: ConcurrencyController;
    streamingBatchProcessor?: StreamingBatchProcessor;
  }): void {
    this.dbOptimizer = components.dbOptimizer;
    this.progressTracker = components.progressTracker;
    this.concurrencyController = components.concurrencyController;
    this.streamingBatchProcessor = components.streamingBatchProcessor;
  }
  
  /**
   * 开始监控
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.blockingDetector.startMonitoring();
    
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoringInterval);
    
    this.logger.info('Performance monitoring started');
    this.emit('monitoringStarted');
  }
  
  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    this.blockingDetector.stopMonitoring();
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    this.logger.info('Performance monitoring stopped');
    this.emit('monitoringStopped');
  }
  
  /**
   * 收集性能指标
   */
  private collectMetrics(): void {
    if (!this.config.enableMetricsCollection) return;
    
    const metrics: PerformanceMetrics = {
      timestamp: Date.now(),
      system: this.collectSystemMetrics(),
      scanning: this.collectScanningMetrics(),
      batching: this.collectBatchingMetrics(),
      database: this.collectDatabaseMetrics(),
      concurrency: this.collectConcurrencyMetrics(),
    };
    
    this.metricsHistory.push(metrics);
    
    if (this.metricsHistory.length > this.config.maxMetricsHistory) {
      this.metricsHistory.shift();
    }
    
    this.trendAnalyzer.addMetrics(metrics);
    
    // 检查告警条件
    if (this.config.enableRealTimeAlerts) {
      this.checkAlerts(metrics);
    }
    
    this.emit('metricsCollected', metrics);
  }
  
  /**
   * 收集系统指标
   */
  private collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    };
  }
  
  /**
   * 收集扫描指标
   */
  private collectScanningMetrics() {
    if (this.progressTracker) {
      const progress = this.progressTracker.getCurrentProgress();
      const stats = this.progressTracker.getPerformanceStats();
      
      return {
        processed: progress.scanning.processed,
        total: progress.scanning.total,
        rate: progress.scanning.rate || 0,
        percentage: progress.scanning.percentage,
      };
    }
    
    return {
      processed: 0,
      total: 0,
      rate: 0,
      percentage: 0,
    };
  }
  
  /**
   * 收集批量处理指标
   */
  private collectBatchingMetrics() {
    if (this.streamingBatchProcessor) {
      const stats = this.streamingBatchProcessor.getStats();
      
      const totalItems = Object.values(stats.batches).reduce((sum, count) => sum + count, 0);
      const totalProcessed = Object.values(stats.progress).reduce(
        (sum, progress) => sum + progress.processed, 0
      );
      const totalFailed = stats.result.errors.length;
      
      return {
        queueLength: stats.queue.queued,
        processing: stats.queue.processing,
        completed: totalProcessed,
        failureRate: totalProcessed > 0 ? (totalFailed / totalProcessed) * 100 : 0,
      };
    }
    
    return {
      queueLength: 0,
      processing: 0,
      completed: 0,
      failureRate: 0,
    };
  }
  
  /**
   * 收集数据库指标
   */
  private collectDatabaseMetrics() {
    if (this.dbOptimizer) {
      const stats = this.dbOptimizer.getStats();
      
      return {
        totalQueries: stats.totalQueries,
        successfulQueries: stats.successfulQueries,
        failedQueries: stats.failedQueries,
        averageQueryTime: stats.averageQueryTime,
        connectionPoolUsage: stats.connectionPoolUsage,
        batchOperations: stats.batchOperations,
      };
    }
    
    return {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      averageQueryTime: 0,
      connectionPoolUsage: 0,
      batchOperations: 0,
    };
  }
  
  /**
   * 收集并发指标
   */
  private collectConcurrencyMetrics() {
    if (this.concurrencyController) {
      const status = this.concurrencyController.getStatus();
      
      return {
        active: status.running,
        queued: status.queued,
        maxConcurrency: status.maxConcurrency,
        utilization: (status.running / status.maxConcurrency) * 100,
      };
    }
    
    return {
      active: 0,
      queued: 0,
      maxConcurrency: 0,
      utilization: 0,
    };
  }
  
  /**
   * 检查告警条件
   */
  private checkAlerts(metrics: PerformanceMetrics): void {
    const alerts: PerformanceAlert[] = [];
    
    // 检查阻塞
    if (this.blockingDetector.isBlocked()) {
      alerts.push({
        id: 'blocking',
        timestamp: metrics.timestamp,
        severity: 'critical',
        type: 'blocking',
        message: `System blocked for ${this.blockingDetector.getCurrentBlockingDuration()}ms`,
        metrics: { scanning: metrics.scanning },
      });
    }
    
    // 检查内存使用
    const memoryUsagePercent = (metrics.system.memoryUsage.heapUsed / metrics.system.memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        id: 'memory',
        timestamp: metrics.timestamp,
        severity: memoryUsagePercent > 95 ? 'critical' : 'warning',
        type: 'memory',
        message: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`,
        metrics: { system: metrics.system },
      });
    }
    
    // 检查数据库性能
    if (metrics.database.averageQueryTime > this.config.alertThresholds.averageQueryTime) {
      alerts.push({
        id: 'database_slow',
        timestamp: metrics.timestamp,
        severity: 'warning',
        type: 'database',
        message: `Slow database queries: ${metrics.database.averageQueryTime.toFixed(0)}ms average`,
        metrics: { database: metrics.database },
      });
    }
    
    // 检查队列长度
    if (metrics.batching.queueLength > this.config.alertThresholds.queueLength) {
      alerts.push({
        id: 'queue_length',
        timestamp: metrics.timestamp,
        severity: 'warning',
        type: 'queue',
        message: `High queue length: ${metrics.batching.queueLength} items`,
        metrics: { batching: metrics.batching },
      });
    }
    
    // 处理新告警
    for (const alert of alerts) {
      if (!this.activeAlerts.has(alert.id)) {
        this.activeAlerts.set(alert.id, alert);
        this.logger.warn({ alert }, `Performance alert: ${alert.message}`);
        this.emit('alert', alert);
      }
    }
    
    // 检查已解决的告警
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      if (!alerts.some(a => a.id === alertId)) {
        alert.resolved = true;
        alert.resolvedAt = metrics.timestamp;
        this.logger.info({ alert }, `Performance alert resolved: ${alert.message}`);
        this.emit('alertResolved', alert);
        this.activeAlerts.delete(alertId);
      }
    }
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    this.blockingDetector.on('blockingDetected', (data) => {
      this.logger.warn(data, 'Blocking detected');
      this.emit('blockingDetected', data);
    });
    
    this.blockingDetector.on('blockingResolved', (data) => {
      this.logger.info(data, 'Blocking resolved');
      this.emit('blockingResolved', data);
    });
  }
  
  /**
   * 更新进度（用于阻塞检测）
   */
  updateProgress(): void {
    this.blockingDetector.updateProgress();
  }
  
  /**
   * 获取当前性能指标
   */
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metricsHistory.length > 0 
      ? this.metricsHistory[this.metricsHistory.length - 1] 
      : null;
  }
  
  /**
   * 获取性能趋势
   */
  getPerformanceTrends(): PerformanceTrend[] {
    return this.trendAnalyzer.analyzeTrends();
  }
  
  /**
   * 获取活跃告警
   */
  getActiveAlerts(): PerformanceAlert[] {
    return Array.from(this.activeAlerts.values());
  }
  
  /**
   * 获取性能报告
   */
  getPerformanceReport(): {
    currentMetrics: PerformanceMetrics | null;
    trends: PerformanceTrend[];
    activeAlerts: PerformanceAlert[];
    summary: {
      isHealthy: boolean;
      issues: string[];
      recommendations: string[];
    };
  } {
    const currentMetrics = this.getCurrentMetrics();
    const trends = this.getPerformanceTrends();
    const activeAlerts = this.getActiveAlerts();
    
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // 分析问题和建议
    if (activeAlerts.length > 0) {
      issues.push(`${activeAlerts.length} active performance alerts`);
    }
    
    const degradingTrends = trends.filter(t => t.direction === 'degrading' && t.confidence > 0.7);
    if (degradingTrends.length > 0) {
      issues.push(`${degradingTrends.length} performance metrics are degrading`);
      recommendations.push('Consider optimizing the degrading components');
    }
    
    if (currentMetrics) {
      if (currentMetrics.batching.queueLength > 500) {
        recommendations.push('Consider increasing batch processing concurrency');
      }
      
      if (currentMetrics.database.averageQueryTime > 1000) {
        recommendations.push('Consider optimizing database queries or increasing connection pool');
      }
    }
    
    return {
      currentMetrics,
      trends,
      activeAlerts,
      summary: {
        isHealthy: activeAlerts.length === 0 && degradingTrends.length === 0,
        issues,
        recommendations,
      },
    };
  }
}