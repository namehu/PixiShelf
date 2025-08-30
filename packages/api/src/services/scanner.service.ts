import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { SimpleScanner, SimpleScanOptions, SimpleScanResult } from './scanner/SimpleScanner'
import { ScanProgress, ScanResult } from '@pixishelf/shared'

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
      const result = await this.scanner.scan(options)
      this.logger.info({ result }, 'Scan completed successfully')
      return result
    } catch (error) {
      this.logger.error({ error, options }, 'Scan failed')
      throw error
    }
  }
}
