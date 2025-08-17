import path from 'path';
import { CacheStats } from './types';

/**
 * 缓存管理器
 * 用于缓存预编译的正则表达式、路径解析结果等，减少重复计算
 */
export class CacheManager {
  private regexCache: Map<string, RegExp> = new Map();
  private pathCache: Map<string, string> = new Map();
  private extensionCache: Set<string>;
  private nameValidationRegex!: RegExp;
  private stats: CacheStats;

  constructor(supportedExtensions: string[]) {
    this.extensionCache = new Set(supportedExtensions.map(ext => ext.toLowerCase()));
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      cacheSize: 0,
      memoryUsage: 0,
    };
    this.precompileRegexes();
  }

  /**
   * 预编译常用的正则表达式
   */
  private precompileRegexes(): void {
    // 文件名验证正则表达式 - 更严格的验证
    // 只允许：字母、数字、空格、下划线、连字符、点、括号、中文、日文假名
    this.nameValidationRegex = /^[a-zA-Z0-9\s_\-.()\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]+$/;
    this.regexCache.set('nameValidation', this.nameValidationRegex);

    // 艺术家名称解析正则表达式
    this.regexCache.set('artistNameWithId', /^(.+?)\s*\((\d+)\)$/);
    this.regexCache.set('artistNameWithDash', /^(.+?)-(\d+|[a-zA-Z0-9]+)$/);

    // 元数据文件匹配正则表达式
    this.regexCache.set('metadataFile', /(-|_)?meta\.txt$/);
    this.regexCache.set('metadataFileEnding', /_metadata\.txt$|_metadata\.txt$/);

    // 隐藏文件和系统文件正则表达式
    this.regexCache.set('hiddenFile', /^[.$]/);

    // 标签格式正则表达式
    this.regexCache.set('tagPrefix', /^[#-]\s*/);
  }

  /**
   * 获取文件名验证正则表达式
   */
  getNameValidationRegex(): RegExp {
    this.stats.hits++;
    return this.nameValidationRegex;
  }

  /**
   * 验证文件名是否有效
   */
  isValidName(name: string): boolean {
    return this.nameValidationRegex.test(name);
  }

  /**
   * 检查文件扩展名是否支持
   */
  isValidExtension(ext: string): boolean {
    const lowerExt = ext.toLowerCase();
    const isValid = this.extensionCache.has(lowerExt);
    
    if (isValid) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    this.updateHitRate();
    return isValid;
  }

  /**
   * 规范化路径
   */
  normalizePath(inputPath: string): string {
    if (this.pathCache.has(inputPath)) {
      this.stats.hits++;
      return this.pathCache.get(inputPath)!;
    }

    this.stats.misses++;
    const normalized = path.normalize(inputPath).replace(/\\/g, '/');
    
    // 限制缓存大小
    if (this.pathCache.size < 10000) {
      this.pathCache.set(inputPath, normalized);
    }
    
    this.updateHitRate();
    this.updateCacheSize();
    return normalized;
  }

  /**
   * 获取相对路径
   */
  getRelativePath(fullPath: string, basePath: string): string {
    const cacheKey = `${fullPath}|${basePath}`;
    
    if (this.pathCache.has(cacheKey)) {
      this.stats.hits++;
      return this.pathCache.get(cacheKey)!;
    }

    this.stats.misses++;
    const relativePath = path.relative(basePath, fullPath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    // 限制缓存大小
    if (this.pathCache.size < 10000) {
      this.pathCache.set(cacheKey, normalizedPath);
    }
    
    this.updateHitRate();
    this.updateCacheSize();
    return normalizedPath;
  }

  /**
   * 获取预编译的正则表达式
   */
  getRegex(name: string): RegExp | undefined {
    const regex = this.regexCache.get(name);
    
    if (regex) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    this.updateHitRate();
    return regex;
  }

  /**
   * 解析艺术家名称
   */
  parseArtistName(artistName: string): {
    displayName: string;
    username: string | null;
    userId: string | null;
  } {
    const cacheKey = `artist:${artistName}`;
    
    if (this.pathCache.has(cacheKey)) {
      this.stats.hits++;
      const cached = this.pathCache.get(cacheKey)!;
      return JSON.parse(cached);
    }

    this.stats.misses++;
    
    // 优先匹配 "用户名 (用户ID)" 格式
    const withIdRegex = this.regexCache.get('artistNameWithId')!;
    let match = artistName.match(withIdRegex);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      if (username.length > 0 && userId.length >= 1) {
        const result = {
          displayName: username,
          username: username,
          userId: userId,
        };
        
        // 缓存结果
        if (this.pathCache.size < 10000) {
          this.pathCache.set(cacheKey, JSON.stringify(result));
        }
        
        this.updateHitRate();
        this.updateCacheSize();
        return result;
      }
    }

    // 次优匹配 "用户名-数字ID" 或 "用户名-字母数字ID" 格式
    const withDashRegex = this.regexCache.get('artistNameWithDash')!;
    match = artistName.match(withDashRegex);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      if (username.length > 0 && userId.length >= 1) {
        const result = {
          displayName: username,
          username: username,
          userId: userId,
        };
        
        // 缓存结果
        if (this.pathCache.size < 10000) {
          this.pathCache.set(cacheKey, JSON.stringify(result));
        }
        
        this.updateHitRate();
        this.updateCacheSize();
        return result;
      }
    }

    // 如果解析失败，返回原始名称
    const result = {
      displayName: artistName,
      username: null,
      userId: null,
    };
    
    // 缓存结果
    if (this.pathCache.size < 10000) {
      this.pathCache.set(cacheKey, JSON.stringify(result));
    }
    
    this.updateHitRate();
    this.updateCacheSize();
    return result;
  }

  /**
   * 检查是否是元数据文件
   */
  isMetadataFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    
    // 检查简单的 meta.txt 格式
    const metaRegex = this.regexCache.get('metadataFile')!;
    if (metaRegex.test(lower)) {
      this.stats.hits++;
      this.updateHitRate();
      return true;
    }

    // 检查其他格式
    const isMetadata = lower.endsWith('_metadata.txt') ||
                      lower.endsWith('-metadata.txt') ||
                      lower === 'metadata.txt';
    
    if (isMetadata) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    this.updateHitRate();
    return isMetadata;
  }

  /**
   * 检查是否是隐藏文件或系统文件
   */
  isHiddenOrSystemFile(fileName: string): boolean {
    const hiddenRegex = this.regexCache.get('hiddenFile')!;
    const isHidden = hiddenRegex.test(fileName);
    
    if (isHidden) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    this.updateHitRate();
    return isHidden;
  }

  /**
   * 清理标签前缀
   */
  cleanTagPrefix(tag: string): string {
    const cacheKey = `tag:${tag}`;
    
    if (this.pathCache.has(cacheKey)) {
      this.stats.hits++;
      return this.pathCache.get(cacheKey)!;
    }

    this.stats.misses++;
    
    let cleaned = tag.trim();
    const tagPrefixRegex = this.regexCache.get('tagPrefix')!;
    
    if (cleaned.startsWith('#')) {
      cleaned = cleaned.slice(1);
    } else if (cleaned.startsWith('- ')) {
      cleaned = cleaned.slice(2);
    }
    
    cleaned = cleaned.trim();
    
    // 缓存结果
    if (this.pathCache.size < 10000) {
      this.pathCache.set(cacheKey, cleaned);
    }
    
    this.updateHitRate();
    this.updateCacheSize();
    return cleaned;
  }

  /**
   * 批量检查文件扩展名
   */
  filterValidExtensions(fileNames: string[]): string[] {
    return fileNames.filter(fileName => {
      const ext = path.extname(fileName).toLowerCase();
      return this.isValidExtension(ext);
    });
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 清空所有缓存
   */
  clearCache(): void {
    this.pathCache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      cacheSize: 0,
      memoryUsage: 0,
    };
    this.updateCacheSize();
  }

  /**
   * 清空路径缓存（保留正则表达式缓存）
   */
  clearPathCache(): void {
    this.pathCache.clear();
    this.updateCacheSize();
  }

  /**
   * 设置缓存大小限制
   */
  setCacheLimit(limit: number): void {
    if (this.pathCache.size > limit) {
      // 清理最旧的缓存项
      const entries = Array.from(this.pathCache.entries());
      const toKeep = entries.slice(-limit);
      this.pathCache.clear();
      toKeep.forEach(([key, value]) => {
        this.pathCache.set(key, value);
      });
    }
    this.updateCacheSize();
  }

  /**
   * 预热缓存
   */
  warmupCache(commonPaths: string[], commonNames: string[]): void {
    // 预热路径缓存
    commonPaths.forEach(p => {
      this.normalizePath(p);
    });

    // 预热名称解析缓存
    commonNames.forEach(name => {
      this.parseArtistName(name);
      this.isValidName(name);
    });
  }

  /**
   * 更新命中率
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * 更新缓存大小统计
   */
  private updateCacheSize(): void {
    this.stats.cacheSize = this.pathCache.size + this.regexCache.size;
    
    // 估算内存使用（粗略计算）
    let memoryUsage = 0;
    
    // 路径缓存内存使用
    for (const [key, value] of this.pathCache) {
      memoryUsage += (key.length + value.length) * 2; // Unicode 字符占用 2 字节
    }
    
    // 正则表达式缓存内存使用（估算）
    memoryUsage += this.regexCache.size * 100; // 每个正则表达式大约 100 字节
    
    // 扩展名缓存内存使用
    for (const ext of this.extensionCache) {
      memoryUsage += ext.length * 2;
    }
    
    this.stats.memoryUsage = memoryUsage;
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage(): {
    pathCache: number;
    regexCache: number;
    extensionCache: number;
    total: number;
  } {
    let pathCacheMemory = 0;
    for (const [key, value] of this.pathCache) {
      pathCacheMemory += (key.length + value.length) * 2;
    }

    const regexCacheMemory = this.regexCache.size * 100;
    
    let extensionCacheMemory = 0;
    for (const ext of this.extensionCache) {
      extensionCacheMemory += ext.length * 2;
    }

    return {
      pathCache: pathCacheMemory,
      regexCache: regexCacheMemory,
      extensionCache: extensionCacheMemory,
      total: pathCacheMemory + regexCacheMemory + extensionCacheMemory,
    };
  }
}

/**
 * 创建默认的缓存管理器
 */
export function createDefaultCacheManager(supportedExtensions: string[]): CacheManager {
  return new CacheManager(supportedExtensions);
}

/**
 * 缓存配置选项
 */
export interface CacheOptions {
  maxPathCacheSize?: number;
  enableWarmup?: boolean;
  commonPaths?: string[];
  commonNames?: string[];
}

/**
 * 高级缓存管理器
 * 支持更多配置选项和优化策略
 */
export class AdvancedCacheManager extends CacheManager {
  private maxPathCacheSize: number;
  private enableWarmup: boolean;

  constructor(supportedExtensions: string[], options: CacheOptions = {}) {
    super(supportedExtensions);
    this.maxPathCacheSize = options.maxPathCacheSize ?? 10000;
    this.enableWarmup = options.enableWarmup ?? false;

    if (this.enableWarmup && options.commonPaths && options.commonNames) {
      this.warmupCache(options.commonPaths, options.commonNames);
    }
  }

  /**
   * 智能缓存清理
   * 根据使用频率清理缓存
   */
  smartCleanup(): void {
    if (this.getStats().cacheSize > this.maxPathCacheSize) {
      // 这里可以实现更智能的清理策略
      // 比如基于 LRU 算法清理最少使用的缓存项
      this.setCacheLimit(Math.floor(this.maxPathCacheSize * 0.8));
    }
  }

  /**
   * 获取缓存效率报告
   */
  getEfficiencyReport(): {
    hitRate: number;
    memoryEfficiency: number;
    recommendedActions: string[];
  } {
    const stats = this.getStats();
    const memoryUsage = this.getMemoryUsage();
    const recommendations: string[] = [];

    if (stats.hitRate < 0.7) {
      recommendations.push('Consider warming up cache with common paths');
    }

    if (memoryUsage.total > 10 * 1024 * 1024) { // 10MB
      recommendations.push('Cache memory usage is high, consider reducing cache size');
    }

    if (stats.cacheSize > this.maxPathCacheSize * 0.9) {
      recommendations.push('Cache is near capacity, consider cleanup');
    }

    return {
      hitRate: stats.hitRate,
      memoryEfficiency: stats.hits / (memoryUsage.total / 1024), // hits per KB
      recommendedActions: recommendations,
    };
  }
}