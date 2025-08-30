import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { SimpleScanner, SimpleScanOptions, SimpleScanResult } from './scanner/SimpleScanner'
import { ScanProgress } from '@pixishelf/shared'

/**
 * 扫描选项接口
 */
export interface ScanOptions {
  scanPath: string
  supportedExtensions?: string[] // 已废弃，新扫描器自动检测媒体文件
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
  scanType?: 'unified' // 兼容旧接口
}

/**
 * 扫描结果接口
 */
export interface ScanResult {
  foundImages: number // 映射到 totalArtworks * 平均图片数
  newArtworks: number
  newImages: number
  removedArtworks: number // 已废弃，新扫描器不删除作品
  errors: string[]
  strategy?: 'unified' // 兼容旧接口
  metadata?: {
    totalArtworks: number
    totalImages: number
    processingTime: number
  }
}

// 重新导出新接口供外部使用
export type { ScanProgress, SimpleScanOptions, SimpleScanResult }

/**
 * 文件扫描器
 * 基于新的简化扫描器实现
 */
export class ScannerService {
  private scanner: SimpleScanner
  private logger: FastifyInstance['log']

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.logger = logger
    this.scanner = new SimpleScanner(prisma, logger)
  }

  /**
   * 扫描方法
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    this.logger.info({ scanPath: options.scanPath }, 'Starting scan with scanner')

    try {
      // 执行扫描器
      const simpleScanResult = await this.scanner.scan(options)

      // 转换结果格式
      const result: ScanResult = this.convertToLegacyResult(simpleScanResult)

      if (options.scanType === 'unified') {
        result.strategy = 'unified'
        result.metadata = {
          totalArtworks: result.newArtworks,
          totalImages: result.newImages,
          processingTime: 0 // 新扫描器不提供此信息
        }
      }

      this.logger.info({ result }, 'Scan completed successfully')
      return result
    } catch (error) {
      this.logger.error({ error, options }, 'Scan failed')
      throw error
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
