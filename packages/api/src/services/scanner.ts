import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ScannerService, SimpleScanOptions, SimpleScanResult } from './scanner/ScannerInterface'
import { ScanProgress } from '@pixishelf/shared'

/**
 * 向后兼容的扫描选项接口
 */
export interface ScanOptions {
  scanPath: string
  supportedExtensions?: string[] // 已废弃，新扫描器自动检测媒体文件
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
}

/**
 * 向后兼容的扫描结果接口
 */
export interface ScanResult {
  foundImages: number // 映射到 totalArtworks * 平均图片数
  newArtworks: number
  newImages: number
  removedArtworks: number // 已废弃，新扫描器不删除作品
  errors: string[]
}

// 重新导出新接口供外部使用
export type { ScanProgress, SimpleScanOptions, SimpleScanResult }

/**
 * 文件扫描器
 * 基于新的简化扫描器实现，提供向后兼容的接口
 */
export class FileScanner {
  private scannerService: ScannerService
  private logger: FastifyInstance['log']

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.logger = logger
    this.scannerService = new ScannerService(prisma, logger)
  }

  /**
   * 主要扫描方法
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    this.logger.info({ scanPath: options.scanPath }, 'Starting scan with scanner')

    try {
      // 转换为新扫描器选项
      const simpleScanOptions: SimpleScanOptions = {
        scanPath: options.scanPath,
        forceUpdate: options.forceUpdate,
        onProgress: options.onProgress
      }

      // 执行新扫描器
      const simpleScanResult = await this.scannerService.scan(simpleScanOptions)

      // 转换结果为向后兼容格式
      const result: ScanResult = this.convertToLegacyResult(simpleScanResult)

      this.logger.info({ result }, 'Scan completed successfully')
      return result
    } catch (error) {
      this.logger.error({ error, options }, 'Scan failed')
      throw error
    }
  }

  /**
   * 扩展扫描方法（已废弃，重定向到新扫描器）
   * @param options 扩展扫描选项
   * @returns 扫描结果
   */
  async scanWithMetadata(options: any): Promise<any> {
    this.logger.warn('scanWithMetadata is deprecated, redirecting to simplified scan')

    // 转换为标准扫描选项
    const scanOptions: ScanOptions = {
      scanPath: options.scanPath,
      forceUpdate: options.forceUpdate,
      onProgress: options.onProgress
    }

    const result = await this.scan(scanOptions)

    // 转换为扩展结果格式
    return {
      ...result,
      strategy: 'unified', // 固定返回unified策略
      metadata: {
        totalArtworks: result.newArtworks,
        totalImages: result.newImages,
        processingTime: 0 // 新扫描器不提供此信息
      }
    }
  }

  /**
   * 转换新扫描结果为向后兼容格式
   * @param simpleScanResult 新扫描结果
   * @returns 向后兼容的扫描结果
   */
  private convertToLegacyResult(simpleScanResult: SimpleScanResult): ScanResult {
    // 估算平均每个作品的图片数量
    const avgImagesPerArtwork =
      simpleScanResult.totalArtworks > 0
        ? Math.ceil(simpleScanResult.newImages / Math.max(simpleScanResult.newArtworks, 1))
        : 1

    return {
      foundImages: simpleScanResult.totalArtworks * avgImagesPerArtwork,
      newArtworks: simpleScanResult.newArtworks,
      newImages: simpleScanResult.newImages,
      removedArtworks: 0, // 新扫描器不删除作品
      errors: simpleScanResult.errors
    }
  }
}
