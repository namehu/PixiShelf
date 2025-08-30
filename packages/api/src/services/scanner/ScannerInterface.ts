import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { SimpleScanner, SimpleScanOptions, SimpleScanResult } from './SimpleScanner'
import { ScanProgress } from '@pixishelf/shared'

/**
 * 扫描器接口
 * 提供统一的扫描功能接口
 */
export interface IScannerService {
  /**
   * 执行扫描
   * @param options 扫描选项
   * @returns 扫描结果
   */
  scan(options: SimpleScanOptions): Promise<SimpleScanResult>
}

/**
 * 扫描器状态
 */
export interface ScannerStatus {
  isScanning: boolean
  currentScanPath?: string
  progress?: ScanProgress
  lastScanResult?: SimpleScanResult
  lastScanTime?: Date
}

/**
 * 扫描器服务实现
 * 基于新的简化扫描器的服务封装
 */
export class ScannerService implements IScannerService {
  private scanner: SimpleScanner
  private status: ScannerStatus
  private logger: FastifyInstance['log']

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.scanner = new SimpleScanner(prisma, logger)
    this.logger = logger
    this.status = {
      isScanning: false
    }
  }

  /**
   * 执行扫描
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: SimpleScanOptions): Promise<SimpleScanResult> {
    if (this.status.isScanning) {
      throw new Error('Scanner is already running')
    }

    this.status.isScanning = true
    this.status.currentScanPath = options.scanPath
    this.status.progress = undefined
    this.status.lastScanResult = undefined

    try {
      this.logger.info({ scanPath: options.scanPath }, 'Starting scan service')

      // 包装进度回调
      const wrappedOptions: SimpleScanOptions = {
        ...options,
        onProgress: (progress: ScanProgress) => {
          this.status.progress = progress
          options.onProgress?.(progress)
        }
      }

      const result = await this.scanner.scan(wrappedOptions)

      this.status.lastScanResult = result
      this.status.lastScanTime = new Date()

      this.logger.info({ result }, 'Scan service completed')

      return result
    } catch (error) {
      this.logger.error({ error, options }, 'Scan service failed')
      throw error
    } finally {
      this.status.isScanning = false
      this.status.currentScanPath = undefined
      this.status.progress = undefined
    }
  }
}

// 导出类型
export type { SimpleScanOptions, SimpleScanResult } from './SimpleScanner'
