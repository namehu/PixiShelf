import os from 'os';

/**
 * 并发任务控制器
 * 用于控制文件系统操作的并发数量，防止资源耗尽
 */
export class ConcurrencyController {
  private readonly maxConcurrency: number;
  private running: number = 0;
  private queue: Array<{
    task: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  /**
   * 创建并发控制器
   * @param maxConcurrency 最大并发数，默认为 CPU 核心数 * 2
   */
  constructor(maxConcurrency: number = os.cpus().length * 2) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  /**
   * 执行异步任务，受并发数量限制
   * @param task 要执行的异步任务
   * @returns 任务执行结果
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  /**
   * 批量执行多个任务
   * @param tasks 任务数组
   * @returns 所有任务的执行结果
   */
  async executeAll<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    const promises = tasks.map(task => this.execute(task));
    return Promise.all(promises);
  }

  /**
   * 批量执行多个任务，允许部分失败
   * @param tasks 任务数组
   * @returns 所有任务的执行结果（包含成功和失败）
   */
  async executeAllSettled<T>(tasks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
    const promises = tasks.map(task => this.execute(task));
    return Promise.allSettled(promises);
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      maxConcurrency: this.maxConcurrency,
      running: this.running,
      queued: this.queue.length,
      total: this.running + this.queue.length,
    };
  }

  /**
   * 等待所有任务完成
   */
  async waitForCompletion(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * 处理任务队列
   */
  private processQueue(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;

      // 执行任务
      item.task()
        .then(result => {
          item.resolve(result);
        })
        .catch(error => {
          item.reject(error);
        })
        .finally(() => {
          this.running--;
          // 继续处理队列中的下一个任务
          this.processQueue();
        });
    }
  }

  /**
   * 清空队列并取消所有等待的任务
   */
  clear(): void {
    const cancelledTasks = this.queue.splice(0);
    cancelledTasks.forEach(item => {
      item.reject(new Error('Task cancelled'));
    });
  }

  /**
   * 动态调整最大并发数
   * @param newMaxConcurrency 新的最大并发数
   */
  setMaxConcurrency(newMaxConcurrency: number): void {
    const oldMax = this.maxConcurrency;
    (this as any).maxConcurrency = Math.max(1, newMaxConcurrency);
    
    // 如果增加了并发数，立即处理队列
    if (newMaxConcurrency > oldMax) {
      this.processQueue();
    }
  }
}

/**
 * 创建默认的并发控制器实例
 */
export function createDefaultConcurrencyController(): ConcurrencyController {
  return new ConcurrencyController();
}

/**
 * 并发控制器配置选项
 */
export interface ConcurrencyOptions {
  maxConcurrency?: number;
  adaptiveScaling?: boolean;
  memoryThreshold?: number;
}

/**
 * 自适应并发控制器
 * 根据系统负载动态调整并发数
 */
export class AdaptiveConcurrencyController extends ConcurrencyController {
  private memoryThreshold: number;
  private monitoringInterval?: NodeJS.Timeout;
  private adaptiveScaling: boolean;

  constructor(options: ConcurrencyOptions = {}) {
    super(options.maxConcurrency);
    this.adaptiveScaling = options.adaptiveScaling ?? false;
    this.memoryThreshold = options.memoryThreshold ?? 500 * 1024 * 1024; // 500MB

    if (this.adaptiveScaling) {
      this.startMonitoring();
    }
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const currentMax = this.getStatus().maxConcurrency;

      if (memUsage.heapUsed > this.memoryThreshold) {
        // 内存使用过高，减少并发数
        const newMax = Math.max(1, Math.floor(currentMax * 0.8));
        this.setMaxConcurrency(newMax);
      } else if (memUsage.heapUsed < this.memoryThreshold * 0.5) {
        // 内存使用较低，可以增加并发数
        const newMax = Math.min(os.cpus().length * 4, Math.floor(currentMax * 1.2));
        this.setMaxConcurrency(newMax);
      }
    }, 5000); // 每5秒检查一次
  }

  /**
   * 停止监控并清理资源
   */
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.clear();
  }
}