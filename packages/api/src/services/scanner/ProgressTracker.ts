import { FastifyInstance } from 'fastify';

/**
 * 详细进度信息
 */
export interface DetailedProgress {
  scanning: {
    processed: number;
    total: number;
    percentage: number;
    rate?: number; // files per second
  };
  batching: {
    artists: EntityProgress;
    artworks: EntityProgress;
    images: EntityProgress;
    tags: EntityProgress;
    artworkTags: EntityProgress;
  };
  overall: {
    phase: 'scanning' | 'batching' | 'finalizing';
    percentage: number;
    estimatedRemaining?: number;
  };
}

/**
 * 实体处理进度
 */
export interface EntityProgress {
  processed: number;
  total: number;
  inQueue: number;
  processing: number;
}

/**
 * 传统进度信息（保持兼容）
 */
export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'creating' | 'cleanup' | 'complete';
  message: string;
  current?: number;
  total?: number;
  percentage?: number;
  estimatedSecondsRemaining?: number;
}

/**
 * 阻塞检测器
 */
class BlockingDetector {
  private lastProgressTime: number = Date.now();
  private blockingThreshold: number = 5000; // 5秒阈值
  private onBlockingDetected?: (duration: number) => void;
  private monitoringInterval?: NodeJS.Timeout;
  private logger: FastifyInstance['log'];
  
  constructor(
    logger: FastifyInstance['log'],
    blockingThreshold: number = 5000,
    onBlockingDetected?: (duration: number) => void
  ) {
    this.logger = logger;
    this.blockingThreshold = blockingThreshold;
    this.onBlockingDetected = onBlockingDetected;
  }
  
  updateProgress(): void {
    this.lastProgressTime = Date.now();
  }
  
  startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const now = Date.now();
      const duration = now - this.lastProgressTime;
      
      if (duration > this.blockingThreshold) {
        this.logger.warn(
          { blockingDuration: duration, threshold: this.blockingThreshold },
          'Blocking detected in scan progress'
        );
        this.onBlockingDetected?.(duration);
      }
    }, 1000);
  }
  
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
}

/**
 * 实时进度计算器
 */
class RealTimeProgressCalculator {
  private scanningWeight = 0.7;   // 扫描占70%
  private batchingWeight = 0.25;  // 批量处理占25%
  private finalizingWeight = 0.05; // 最终化占5%
  
  calculateOverallProgress(detailed: DetailedProgress): number {
    const scanProgress = detailed.scanning.percentage * this.scanningWeight;
    const batchProgress = this.calculateBatchProgress(detailed.batching) * this.batchingWeight;
    const finalProgress = detailed.overall.phase === 'finalizing' ? this.finalizingWeight * 100 : 0;
    
    return Math.min(100, scanProgress + batchProgress + finalProgress);
  }
  
  private calculateBatchProgress(batching: DetailedProgress['batching']): number {
    const weights = {
      artists: 0.1,
      artworks: 0.2,
      images: 0.6,
      tags: 0.05,
      artworkTags: 0.05,
    };
    
    let totalProgress = 0;
    
    for (const [type, weight] of Object.entries(weights)) {
      const progress = batching[type as keyof typeof batching];
      const typeProgress = progress.total > 0 ? progress.processed / progress.total : 0;
      totalProgress += typeProgress * weight;
    }
    
    return totalProgress * 100;
  }
  
  estimateRemainingTime(
    detailed: DetailedProgress,
    startTime: number
  ): number | undefined {
    const elapsed = (Date.now() - startTime) / 1000;
    const overallProgress = this.calculateOverallProgress(detailed);
    
    if (overallProgress <= 0 || elapsed <= 0) {
      return undefined;
    }
    
    const rate = overallProgress / elapsed;
    const remaining = (100 - overallProgress) / rate;
    
    return Math.ceil(remaining);
  }
}

/**
 * 进度跟踪器
 * 负责统一管理扫描和批量处理的进度信息
 */
export class ProgressTracker {
  private logger: FastifyInstance['log'];
  private blockingDetector: BlockingDetector;
  private progressCalculator: RealTimeProgressCalculator;
  
  // 进度状态
  private scanningProgress: DetailedProgress['scanning'] = {
    processed: 0,
    total: 0,
    percentage: 0,
    rate: 0,
  };
  
  private batchingProgress: DetailedProgress['batching'] = {
    artists: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    artworks: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    images: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    tags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    artworkTags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
  };
  
  private currentPhase: DetailedProgress['overall']['phase'] = 'scanning';
  private startTime: number = Date.now();
  private unifiedMode: boolean = false;
  private unifiedProgress: { processed: number; total: number } = { processed: 0, total: 0 };

  // 回调函数
  private onProgressUpdate?: (progress: ScanProgress) => void;
  private onDetailedProgressUpdate?: (progress: DetailedProgress) => void;
  
  // 速率计算
  private lastScanUpdate: number = Date.now();
  private lastScanProcessed: number = 0;
  
  constructor(
    logger: FastifyInstance['log'],
    onProgressUpdate?: (progress: ScanProgress) => void,
    onDetailedProgressUpdate?: (progress: DetailedProgress) => void
  ) {
    this.logger = logger;
    this.onProgressUpdate = onProgressUpdate;
    this.onDetailedProgressUpdate = onDetailedProgressUpdate;
    
    this.progressCalculator = new RealTimeProgressCalculator();
    this.blockingDetector = new BlockingDetector(
      logger,
      5000,
      (duration) => this.handleBlockingDetected(duration)
    );
    
    // 不在构造函数中自动启动监控，需要手动调用start方法
  }
  
  /**
   * 更新扫描进度
   */
  updateScanningProgress(processed: number, total: number): void {
    const now = Date.now();
    const timeDiff = (now - this.lastScanUpdate) / 1000;
    const processedDiff = processed - this.lastScanProcessed;
    
    // 计算处理速率
    if (timeDiff > 0) {
      this.scanningProgress.rate = processedDiff / timeDiff;
    }
    
    this.scanningProgress.processed = processed;
    this.scanningProgress.total = total;
    this.scanningProgress.percentage = total > 0 ? (processed / total) * 100 : 0;
    
    this.lastScanUpdate = now;
    this.lastScanProcessed = processed;
    
    this.blockingDetector.updateProgress();
    this.emitProgress();
  }
  
  /**
   * 更新批量处理进度
   */
  updateBatchingProgress(batchingProgress: DetailedProgress['batching']): void {
    this.batchingProgress = { ...batchingProgress };
    this.currentPhase = 'batching';
    
    this.blockingDetector.updateProgress();
    this.emitProgress();
  }
  
  /**
   * 设置当前阶段
   */
  setPhase(phase: DetailedProgress['overall']['phase']): void {
    this.currentPhase = phase;
    this.blockingDetector.updateProgress();
    this.emitProgress();
  }
  
  /**
   * 发送进度更新
   */
  private emitProgress(): void {
    const detailedProgress: DetailedProgress = {
      scanning: { ...this.scanningProgress },
      batching: { ...this.batchingProgress },
      overall: {
        phase: this.currentPhase,
        percentage: this.progressCalculator.calculateOverallProgress({
          scanning: this.scanningProgress,
          batching: this.batchingProgress,
          overall: { phase: this.currentPhase, percentage: 0 },
        }),
        estimatedRemaining: this.progressCalculator.estimateRemainingTime(
          {
            scanning: this.scanningProgress,
            batching: this.batchingProgress,
            overall: { phase: this.currentPhase, percentage: 0 },
          },
          this.startTime
        ),
      },
    };
    
    // 发送详细进度
    this.onDetailedProgressUpdate?.(detailedProgress);
    
    // 转换为传统进度格式并发送
    const traditionalProgress = this.convertToTraditionalProgress(detailedProgress);
    this.onProgressUpdate?.(traditionalProgress);
  }
  
  /**
   * 转换为传统进度格式（保持兼容性）
   */
  private convertToTraditionalProgress(detailed: DetailedProgress): ScanProgress {
    let phase: ScanProgress['phase'];
    let message: string;
    
    switch (detailed.overall.phase) {
      case 'scanning':
        phase = 'scanning';
        message = `已处理 ${detailed.scanning.processed}/${detailed.scanning.total} 个任务`;
        if (detailed.scanning.rate && detailed.scanning.rate > 0) {
          message += ` (${detailed.scanning.rate.toFixed(1)} 文件/秒)`;
        }
        break;
        
      case 'batching':
        phase = 'creating';
        const totalBatchItems = Object.values(detailed.batching).reduce(
          (sum, progress) => sum + progress.processed,
          0
        );
        const totalBatchTarget = Object.values(detailed.batching).reduce(
          (sum, progress) => sum + progress.total,
          0
        );
        message = `批量插入数据... (${totalBatchItems}/${totalBatchTarget})`;
        break;
        
      case 'finalizing':
        phase = 'cleanup';
        message = '完成最终处理...';
        break;
        
      default:
        phase = 'scanning';
        message = '处理中...';
    }
    
    return {
      phase,
      message,
      current: detailed.scanning.processed,
      total: detailed.scanning.total,
      percentage: detailed.overall.percentage,
      estimatedSecondsRemaining: detailed.overall.estimatedRemaining,
    };
  }
  
  /**
   * 处理阻塞检测
   */
  private handleBlockingDetected(duration: number): void {
    this.logger.warn(
      {
        blockingDuration: duration,
        currentPhase: this.currentPhase,
        scanningProgress: this.scanningProgress,
        batchingProgress: this.batchingProgress,
      },
      'Progress blocking detected'
    );
    
    // 可以在这里添加自动恢复逻辑或告警
  }
  
  /**
   * 获取当前详细进度
   */
  getCurrentProgress(): DetailedProgress {
    return {
      scanning: { ...this.scanningProgress },
      batching: { ...this.batchingProgress },
      overall: {
        phase: this.currentPhase,
        percentage: this.progressCalculator.calculateOverallProgress({
          scanning: this.scanningProgress,
          batching: this.batchingProgress,
          overall: { phase: this.currentPhase, percentage: 0 },
        }),
        estimatedRemaining: this.progressCalculator.estimateRemainingTime(
          {
            scanning: this.scanningProgress,
            batching: this.batchingProgress,
            overall: { phase: this.currentPhase, percentage: 0 },
          },
          this.startTime
        ),
      },
    };
  }
  
  /**
   * 重置进度
   */
  reset(): void {
    this.scanningProgress = {
      processed: 0,
      total: 0,
      percentage: 0,
      rate: 0,
    };
    
    this.batchingProgress = {
      artists: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      artworks: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      images: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      tags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      artworkTags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    };
    
    this.currentPhase = 'scanning';
    this.startTime = Date.now();
    this.lastScanUpdate = Date.now();
    this.lastScanProcessed = 0;
  }
  
  /**
   * 停止监控
   */
  /**
   * 启动进度跟踪和阻塞检测
   */
  start(): void {
    this.blockingDetector.startMonitoring();
    this.logger.debug('Progress tracking started');
  }

  /**
   * 停止进度跟踪和阻塞检测
   */
  stop(): void {
    this.blockingDetector.stopMonitoring();
    this.logger.debug('Progress tracking stopped');
  }
  
  /**
   * 启用统一进度模式
   * 用于统一扫描策略的连续进度跟踪
   */
  enableUnifiedMode(): void {
    this.unifiedMode = true;
    this.currentPhase = 'scanning';
    this.logger.debug('Unified progress mode enabled');
  }

  /**
   * 跟踪统一进度
   * @param processed 已处理数量
   * @param total 总数量
   */
  trackUnifiedProgress(processed: number, total: number): void {
    if (!this.unifiedMode) {
      this.logger.warn('Unified progress tracking called but unified mode is not enabled');
      return;
    }

    this.unifiedProgress.processed = processed;
    this.unifiedProgress.total = total;

    // 更新扫描进度
    this.updateScanningProgress(processed, total);

    // 在统一模式下，进度是连续的
    this.emitUnifiedProgress();
  }

  /**
   * 更新连续进度
   * @param progress 进度信息
   */
  updateContinuousProgress(progress: { processed: number; total: number; message?: string }): void {
    if (this.unifiedMode) {
      this.trackUnifiedProgress(progress.processed, progress.total);
    } else {
      this.updateScanningProgress(progress.processed, progress.total);
    }
  }

  /**
   * 计算平滑进度
   * 避免进度跳跃，提供平滑的用户体验
   */
  calculateSmoothProgress(current: number, total: number): { percentage: number; message: string } {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const message = this.unifiedMode 
      ? `Processing artworks: ${current}/${total}`
      : `Scanning files: ${current}/${total}`;
    
    return { percentage, message };
  }

  /**
   * 发送统一进度更新
   */
  private emitUnifiedProgress(): void {
    const { percentage, message } = this.calculateSmoothProgress(
      this.unifiedProgress.processed,
      this.unifiedProgress.total
    );

    // 发送传统进度格式
    const traditionalProgress: ScanProgress = {
      phase: 'scanning',
      message,
      current: this.unifiedProgress.processed,
      total: this.unifiedProgress.total,
      percentage,
      estimatedSecondsRemaining: this.estimateRemainingTime()
    };

    this.onProgressUpdate?.(traditionalProgress);

    // 发送详细进度格式
    const detailedProgress: DetailedProgress = {
      scanning: {
        processed: this.unifiedProgress.processed,
        total: this.unifiedProgress.total,
        percentage,
        rate: this.calculateProcessingRate()
      },
      batching: this.batchingProgress,
      overall: {
        phase: 'scanning',
        percentage,
        estimatedRemaining: this.estimateRemainingTime()
      }
    };

    this.onDetailedProgressUpdate?.(detailedProgress);
    this.blockingDetector.updateProgress();
  }

  /**
   * 计算处理速率
   */
  private calculateProcessingRate(): number {
    const now = Date.now();
    const timeDiff = now - this.lastScanUpdate;
    const processedDiff = this.unifiedProgress.processed - this.lastScanProcessed;
    
    if (timeDiff > 0) {
      const rate = (processedDiff / timeDiff) * 1000; // per second
      this.lastScanUpdate = now;
      this.lastScanProcessed = this.unifiedProgress.processed;
      return Math.round(rate * 100) / 100;
    }
    
    return 0;
  }

  /**
   * 估算剩余时间（统一模式）
   */
  private estimateRemainingTime(): number | undefined {
    if (this.unifiedProgress.total === 0 || this.unifiedProgress.processed === 0) {
      return undefined;
    }

    const elapsed = Date.now() - this.startTime;
    const rate = this.unifiedProgress.processed / elapsed;
    const remaining = this.unifiedProgress.total - this.unifiedProgress.processed;
    
    return remaining > 0 ? Math.round(remaining / rate / 1000) : 0;
  }
  
  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    
    return {
      elapsed,
      scanningRate: this.scanningProgress.rate || 0,
      overallProgress: this.progressCalculator.calculateOverallProgress({
        scanning: this.scanningProgress,
        batching: this.batchingProgress,
        overall: { phase: this.currentPhase, percentage: 0 },
      }),
      estimatedRemaining: this.progressCalculator.estimateRemainingTime(
        {
          scanning: this.scanningProgress,
          batching: this.batchingProgress,
          overall: { phase: this.currentPhase, percentage: 0 },
        },
        this.startTime
      ),
    };
  }
}