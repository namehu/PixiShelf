import { PrismaClient, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';

/**
 * 数据库优化配置
 */
interface DatabaseOptimizerConfig {
  connectionPoolSize: number;     // 连接池大小
  queryTimeout: number;           // 查询超时时间(ms)
  batchTimeout: number;           // 批量操作超时时间(ms)
  retryAttempts: number;          // 重试次数
  retryDelay: number;             // 重试延迟(ms)
  enableQueryOptimization: boolean; // 启用查询优化
  enableTransactionBatching: boolean; // 启用事务批处理
}

/**
 * 数据库操作统计
 */
interface DatabaseStats {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  connectionPoolUsage: number;
  transactionCount: number;
  batchOperations: number;
}

/**
 * 优化的数据库操作结果
 */
interface OptimizedOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime: number;
  retryCount: number;
}

/**
 * 批量操作任务
 */
interface BatchOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  table: string;
  data: any[];
  options?: any;
  priority: 'high' | 'medium' | 'low';
  timestamp: number;
}

/**
 * 数据库连接池管理器
 */
class ConnectionPoolManager {
  private activeConnections: number = 0;
  private maxConnections: number;
  private waitingQueue: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  
  constructor(maxConnections: number) {
    this.maxConnections = maxConnections;
  }
  
  async acquireConnection(): Promise<void> {
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      this.waitingQueue.push({ resolve, reject });
    });
  }
  
  releaseConnection(): void {
    this.activeConnections--;
    
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      this.activeConnections++;
      next.resolve(undefined);
    }
  }
  
  getStats() {
    return {
      active: this.activeConnections,
      max: this.maxConnections,
      waiting: this.waitingQueue.length,
      usage: (this.activeConnections / this.maxConnections) * 100
    };
  }
}

/**
 * 查询优化器
 */
class QueryOptimizer {
  private queryCache: Map<string, any> = new Map();
  private queryStats: Map<string, { count: number; totalTime: number }> = new Map();
  
  /**
   * 优化查询参数
   */
  optimizeQuery(query: string, params: any): { query: string; params: any } {
    // 添加查询提示和优化
    let optimizedQuery = query;
    
    // 为大批量操作添加批量提示
    if (params?.data && Array.isArray(params.data) && params.data.length > 100) {
      optimizedQuery = `/* BATCH_SIZE:${params.data.length} */ ${query}`;
    }
    
    // 为频繁查询添加索引提示
    if (this.isFrequentQuery(query)) {
      optimizedQuery = `/* USE_INDEX */ ${optimizedQuery}`;
    }
    
    return { query: optimizedQuery, params };
  }
  
  /**
   * 记录查询统计
   */
  recordQuery(query: string, executionTime: number): void {
    const stats = this.queryStats.get(query) || { count: 0, totalTime: 0 };
    stats.count++;
    stats.totalTime += executionTime;
    this.queryStats.set(query, stats);
  }
  
  /**
   * 检查是否为频繁查询
   */
  private isFrequentQuery(query: string): boolean {
    const stats = this.queryStats.get(query);
    return stats ? stats.count > 10 : false;
  }
  
  /**
   * 获取查询统计
   */
  getQueryStats() {
    const stats: any[] = [];
    
    for (const [query, stat] of this.queryStats.entries()) {
      stats.push({
        query: query.substring(0, 100) + '...',
        count: stat.count,
        averageTime: stat.totalTime / stat.count,
        totalTime: stat.totalTime
      });
    }
    
    return stats.sort((a, b) => b.totalTime - a.totalTime);
  }
}

/**
 * 事务批处理管理器
 */
class TransactionBatchManager {
  private pendingOperations: BatchOperation[] = [];
  private processingTimer?: NodeJS.Timeout;
  private readonly batchTimeout: number;
  private readonly maxBatchSize: number = 1000;
  
  constructor(
    private prisma: PrismaClient,
    private logger: FastifyInstance['log'],
    batchTimeout: number = 5000
  ) {
    this.batchTimeout = batchTimeout;
    this.startBatchProcessor();
  }
  
  /**
   * 添加操作到批处理队列
   */
  addOperation(operation: BatchOperation): void {
    this.pendingOperations.push(operation);
    
    // 如果达到最大批量大小，立即处理
    if (this.pendingOperations.length >= this.maxBatchSize) {
      this.processBatch();
    }
  }
  
  /**
   * 启动批处理器
   */
  private startBatchProcessor(): void {
    this.processingTimer = setInterval(() => {
      if (this.pendingOperations.length > 0) {
        this.processBatch();
      }
    }, this.batchTimeout);
  }
  
  /**
   * 处理批量操作
   */
  private async processBatch(): Promise<void> {
    if (this.pendingOperations.length === 0) return;
    
    const operations = this.pendingOperations.splice(0, this.maxBatchSize);
    
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const operation of operations) {
          await this.executeOperation(tx, operation);
        }
      });
      
      this.logger.debug(
        { operationCount: operations.length },
        'Batch transaction completed successfully'
      );
    } catch (error) {
      this.logger.error(
        { error, operationCount: operations.length },
        'Batch transaction failed'
      );
      
      // 重新添加失败的操作到队列（降低优先级）
      for (const operation of operations) {
        operation.priority = 'low';
        this.pendingOperations.push(operation);
      }
    }
  }
  
  /**
   * 执行单个操作
   */
  private async executeOperation(tx: any, operation: BatchOperation): Promise<void> {
    switch (operation.type) {
      case 'create':
        await tx[operation.table].createMany({
          data: operation.data,
          skipDuplicates: true,
          ...operation.options
        });
        break;
        
      case 'update':
        for (const item of operation.data) {
          await tx[operation.table].update({
            where: item.where,
            data: item.data,
            ...operation.options
          });
        }
        break;
        
      case 'delete':
        await tx[operation.table].deleteMany({
          where: { id: { in: operation.data.map((item: any) => item.id) } },
          ...operation.options
        });
        break;
    }
  }
  
  /**
   * 停止批处理器
   */
  stop(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
    
    // 处理剩余操作
    if (this.pendingOperations.length > 0) {
      this.processBatch();
    }
  }
}

/**
 * 数据库优化器
 * 提供高性能的数据库操作和连接管理
 */
export class DatabaseOptimizer {
  private prisma: PrismaClient;
  private logger: FastifyInstance['log'];
  private config: DatabaseOptimizerConfig;
  
  private connectionPool: ConnectionPoolManager;
  private queryOptimizer: QueryOptimizer;
  private transactionBatchManager: TransactionBatchManager;
  
  private stats: DatabaseStats = {
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    averageQueryTime: 0,
    connectionPoolUsage: 0,
    transactionCount: 0,
    batchOperations: 0
  };
  
  constructor(
    prisma: PrismaClient,
    logger: FastifyInstance['log'],
    config: Partial<DatabaseOptimizerConfig> = {}
  ) {
    this.prisma = prisma;
    this.logger = logger;
    
    this.config = {
      connectionPoolSize: 10,
      queryTimeout: 30000,
      batchTimeout: 5000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableQueryOptimization: true,
      enableTransactionBatching: true,
      ...config
    };
    
    this.connectionPool = new ConnectionPoolManager(this.config.connectionPoolSize);
    this.queryOptimizer = new QueryOptimizer();
    this.transactionBatchManager = new TransactionBatchManager(
      this.prisma,
      this.logger,
      this.config.batchTimeout
    );
  }
  
  /**
   * 执行优化的数据库操作
   */
  async executeOptimized<T>(
    operation: () => Promise<T>,
    operationName: string = 'unknown'
  ): Promise<OptimizedOperationResult<T>> {
    const startTime = Date.now();
    let retryCount = 0;
    
    while (retryCount <= this.config.retryAttempts) {
      try {
        // 获取连接
        await this.connectionPool.acquireConnection();
        
        // 执行操作
        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise(this.config.queryTimeout)
        ]);
        
        const executionTime = Date.now() - startTime;
        
        // 更新统计
        this.updateStats(true, executionTime);
        this.queryOptimizer.recordQuery(operationName, executionTime);
        
        return {
          success: true,
          data: result,
          executionTime,
          retryCount
        };
        
      } catch (error) {
        retryCount++;
        const executionTime = Date.now() - startTime;
        
        this.logger.warn(
          {
            error,
            operationName,
            retryCount,
            executionTime
          },
          'Database operation failed, retrying...'
        );
        
        if (retryCount <= this.config.retryAttempts) {
          await this.delay(this.config.retryDelay * retryCount);
        } else {
          this.updateStats(false, executionTime);
          
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            executionTime,
            retryCount: retryCount - 1
          };
        }
      } finally {
        this.connectionPool.releaseConnection();
      }
    }
    
    // 这里不应该到达，但为了类型安全
    return {
      success: false,
      error: 'Maximum retry attempts exceeded',
      executionTime: Date.now() - startTime,
      retryCount: this.config.retryAttempts
    };
  }
  
  /**
   * 批量创建记录（优化版本）
   */
  async batchCreate<T>(
    table: string,
    data: any[],
    options: any = {}
  ): Promise<OptimizedOperationResult<T>> {
    if (this.config.enableTransactionBatching && data.length > 50) {
      // 使用事务批处理
      const operation: BatchOperation = {
        id: `batch_create_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'create',
        table,
        data,
        options,
        priority: 'medium',
        timestamp: Date.now()
      };
      
      this.transactionBatchManager.addOperation(operation);
      this.stats.batchOperations++;
      
      return {
        success: true,
        data: { count: data.length } as T,
        executionTime: 0,
        retryCount: 0
      };
    } else {
      // 直接执行
      return this.executeOptimized(async () => {
        return await (this.prisma as any)[table].createMany({
          data,
          skipDuplicates: true,
          ...options
        });
      }, `batchCreate_${table}`);
    }
  }
  
  /**
   * 批量创建并返回记录（优化版本）
   */
  async batchCreateAndReturn<T>(
    table: string,
    data: any[],
    options: any = {}
  ): Promise<OptimizedOperationResult<T[]>> {
    return this.executeOptimized(async () => {
      // 分批处理大量数据
      if (data.length > 1000) {
        const results: T[] = [];
        const batchSize = 500;
        
        for (let i = 0; i < data.length; i += batchSize) {
          const batch = data.slice(i, i + batchSize);
          const batchResult = await (this.prisma as any)[table].createManyAndReturn({
            data: batch,
            skipDuplicates: true,
            ...options
          });
          results.push(...batchResult);
        }
        
        return results;
      } else {
        return await (this.prisma as any)[table].createManyAndReturn({
          data,
          skipDuplicates: true,
          ...options
        });
      }
    }, `batchCreateAndReturn_${table}`);
  }
  
  /**
   * 优化的查询操作
   */
  async findMany<T>(
    table: string,
    query: any = {}
  ): Promise<OptimizedOperationResult<T[]>> {
    return this.executeOptimized(async () => {
      const optimized = this.config.enableQueryOptimization
        ? this.queryOptimizer.optimizeQuery(`findMany_${table}`, query)
        : { query: `findMany_${table}`, params: query };
      
      return await (this.prisma as any)[table].findMany(query);
    }, `findMany_${table}`);
  }
  
  /**
   * 创建超时Promise
   */
  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
    });
  }
  
  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 更新统计信息
   */
  private updateStats(success: boolean, executionTime: number): void {
    this.stats.totalQueries++;
    
    if (success) {
      this.stats.successfulQueries++;
    } else {
      this.stats.failedQueries++;
    }
    
    // 更新平均查询时间
    this.stats.averageQueryTime = 
      (this.stats.averageQueryTime * (this.stats.totalQueries - 1) + executionTime) / 
      this.stats.totalQueries;
    
    // 更新连接池使用率
    this.stats.connectionPoolUsage = this.connectionPool.getStats().usage;
  }
  
  /**
   * 获取性能统计
   */
  getStats(): DatabaseStats & {
    connectionPool: any;
    queryStats: any[];
  } {
    return {
      ...this.stats,
      connectionPool: this.connectionPool.getStats(),
      queryStats: this.queryOptimizer.getQueryStats()
    };
  }
  
  /**
   * 获取健康状态
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
  } {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    // 检查失败率
    const failureRate = this.stats.totalQueries > 0 
      ? (this.stats.failedQueries / this.stats.totalQueries) * 100 
      : 0;
    
    if (failureRate > 10) {
      status = 'critical';
      issues.push(`High failure rate: ${failureRate.toFixed(2)}%`);
    } else if (failureRate > 5) {
      status = 'warning';
      issues.push(`Elevated failure rate: ${failureRate.toFixed(2)}%`);
    }
    
    // 检查平均查询时间
    if (this.stats.averageQueryTime > 5000) {
      status = 'critical';
      issues.push(`Slow queries: ${this.stats.averageQueryTime.toFixed(0)}ms average`);
    } else if (this.stats.averageQueryTime > 2000) {
      if (status !== 'critical') status = 'warning';
      issues.push(`Slow queries: ${this.stats.averageQueryTime.toFixed(0)}ms average`);
    }
    
    // 检查连接池使用率
    if (this.stats.connectionPoolUsage > 90) {
      status = 'critical';
      issues.push(`High connection pool usage: ${this.stats.connectionPoolUsage.toFixed(1)}%`);
    } else if (this.stats.connectionPoolUsage > 75) {
      if (status !== 'critical') status = 'warning';
      issues.push(`High connection pool usage: ${this.stats.connectionPoolUsage.toFixed(1)}%`);
    }
    
    return { status, issues };
  }
  
  /**
   * 清理资源
   */
  cleanup(): void {
    this.transactionBatchManager.stop();
  }
}