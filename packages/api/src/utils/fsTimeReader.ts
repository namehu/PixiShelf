import { promises as fs } from 'fs'
import path from 'path'

/**
 * 文件系统时间读取器
 * 负责获取目录的创建时间，支持跨平台兼容性
 */
export class FileSystemTimeReader {
  /**
   * 获取目录的创建时间
   * @param dirPath 目录路径
   * @returns 目录创建时间
   */
  async getDirectoryCreatedTime(dirPath: string): Promise<Date> {
    try {
      // 验证路径是否存在
      await this.validatePath(dirPath)
      
      const stats = await fs.stat(dirPath)
      
      // 验证是否为目录
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`)
      }
      
      // 获取创建时间
      const createdTime = this.extractCreatedTime(stats)
      
      // 验证时间有效性
      return this.validateTime(createdTime, dirPath)
    } catch (error) {
      // 记录错误并返回回退时间
      console.warn(`Failed to get directory created time for ${dirPath}:`, error)
      return this.getFallbackTime()
    }
  }
  
  /**
   * 批量获取多个目录的创建时间
   * @param dirPaths 目录路径数组
   * @returns 目录路径到创建时间的映射
   */
  async getDirectoryCreatedTimes(dirPaths: string[]): Promise<Map<string, Date>> {
    const results = new Map<string, Date>()
    
    // 并行处理多个目录，但限制并发数量
    const batchSize = 10
    for (let i = 0; i < dirPaths.length; i += batchSize) {
      const batch = dirPaths.slice(i, i + batchSize)
      const batchPromises = batch.map(async (dirPath) => {
        const time = await this.getDirectoryCreatedTime(dirPath)
        return { dirPath, time }
      })
      
      const batchResults = await Promise.all(batchPromises)
      batchResults.forEach(({ dirPath, time }) => {
        results.set(dirPath, time)
      })
    }
    
    return results
  }
  
  /**
   * 验证路径是否存在且可访问
   * @param dirPath 目录路径
   */
  private async validatePath(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath)
    } catch (error) {
      throw new Error(`Directory not accessible: ${dirPath}`)
    }
  }
  
  /**
   * 从文件统计信息中提取创建时间
   * @param stats 文件统计信息
   * @returns 创建时间
   */
  private extractCreatedTime(stats: any): Date {
    // 优先使用 birthtime（创建时间）
    if (stats.birthtime && stats.birthtime.getTime() > 0) {
      return stats.birthtime
    }
    
    // 回退到 ctime（状态变更时间）
    if (stats.ctime && stats.ctime.getTime() > 0) {
      return stats.ctime
    }
    
    // 最后回退到 mtime（修改时间）
    if (stats.mtime && stats.mtime.getTime() > 0) {
      return stats.mtime
    }
    
    // 如果所有时间都无效，抛出错误
    throw new Error('No valid timestamp found in file stats')
  }
  
  /**
   * 验证时间的有效性
   * @param time 时间对象
   * @param dirPath 目录路径（用于错误信息）
   * @returns 验证后的时间
   */
  private validateTime(time: Date, dirPath: string): Date {
    const now = new Date()
    const timeValue = time.getTime()
    
    // 检查时间是否为有效数值
    if (isNaN(timeValue)) {
      throw new Error(`Invalid timestamp for directory: ${dirPath}`)
    }
    
    // 检查时间是否在合理范围内（不能是未来时间）
    if (timeValue > now.getTime()) {
      console.warn(`Directory created time is in the future for ${dirPath}, using current time`)
      return now
    }
    
    // 检查时间是否过于久远（Unix时间戳开始之前）
    const unixEpoch = new Date('1970-01-01').getTime()
    if (timeValue < unixEpoch) {
      console.warn(`Directory created time is before Unix epoch for ${dirPath}, using current time`)
      return now
    }
    
    return time
  }
  
  /**
   * 获取回退时间（当无法获取真实创建时间时使用）
   * @returns 当前时间
   */
  private getFallbackTime(): Date {
    return new Date()
  }
  
  /**
   * 检查文件系统是否支持创建时间
   * @param testPath 测试路径（可选）
   * @returns 是否支持创建时间
   */
  async supportsCreatedTime(testPath?: string): Promise<boolean> {
    try {
      const pathToTest = testPath || process.cwd()
      const stats = await fs.stat(pathToTest)
      
      // 检查是否有有效的 birthtime
      return stats.birthtime && stats.birthtime.getTime() > 0
    } catch (error) {
      return false
    }
  }
  
  /**
   * 获取文件系统信息（用于调试）
   * @param dirPath 目录路径
   * @returns 文件系统信息
   */
  async getFileSystemInfo(dirPath: string): Promise<{
    birthtime: Date | null
    ctime: Date | null
    mtime: Date | null
    atime: Date | null
    isDirectory: boolean
    platform: string
  }> {
    try {
      const stats = await fs.stat(dirPath)
      
      return {
        birthtime: stats.birthtime || null,
        ctime: stats.ctime || null,
        mtime: stats.mtime || null,
        atime: stats.atime || null,
        isDirectory: stats.isDirectory(),
        platform: process.platform
      }
    } catch (error) {
      throw new Error(`Failed to get file system info for ${dirPath}: ${error}`)
    }
  }
}

/**
 * 默认的文件系统时间读取器实例
 */
export const fsTimeReader = new FileSystemTimeReader()

/**
 * 便捷函数：获取目录创建时间
 * @param dirPath 目录路径
 * @returns 目录创建时间
 */
export async function getDirectoryCreatedTime(dirPath: string): Promise<Date> {
  return fsTimeReader.getDirectoryCreatedTime(dirPath)
}

/**
 * 便捷函数：批量获取目录创建时间
 * @param dirPaths 目录路径数组
 * @returns 目录路径到创建时间的映射
 */
export async function getDirectoryCreatedTimes(dirPaths: string[]): Promise<Map<string, Date>> {
  return fsTimeReader.getDirectoryCreatedTimes(dirPaths)
}