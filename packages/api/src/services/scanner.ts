import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient, Prisma } from '@prisma/client'
import { FastifyInstance } from 'fastify'

export interface ScanOptions {
  scanPath: string
  supportedExtensions?: string[]
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
}

export interface ScanProgress {
  phase: 'scanning' | 'creating' | 'cleanup' | 'complete'
  message: string
  current?: number
  total?: number
  percentage?: number
}

export interface ScanResult {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  removedArtworks: number
  errors: string[]
}

export class FileScanner {
  private prisma: PrismaClient
  private logger: FastifyInstance['log']
  private supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']
  private scanRootAbs: string | null = null

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.prisma = prisma
    this.logger = logger
  }

  async scan(options: ScanOptions): Promise<ScanResult> {
    const result: ScanResult = {
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      removedArtworks: 0,
      errors: []
    }

    try {
      const scanPath = options.scanPath
      const extensions = options.supportedExtensions || this.supportedExtensions
      const forceUpdate = options.forceUpdate || false
      const onProgress = options.onProgress

      // 记录规范化后的扫描根目录，供相对路径换算
      this.scanRootAbs = path.resolve(scanPath)

      this.logger.info({ scanPath, forceUpdate }, `Starting scan of: ${scanPath}`)
      onProgress?.({ phase: 'scanning', message: '开始扫描目录...', percentage: 0 })

      // 检查扫描路径是否存在
      try {
        await fs.access(scanPath)
      } catch (error) {
        throw new Error(`Scan path does not exist: ${scanPath}`)
      }

      // 如果强制更新，先清理所有相关数据
      if (forceUpdate) {
        onProgress?.({ phase: 'cleanup', message: '强制更新：清理现有数据...', percentage: 10 })
        await this.cleanupExistingData()
      }

      // 递归扫描目录
      onProgress?.({ phase: 'scanning', message: '扫描文件中...', percentage: 20 })
      await this.scanDirectory(scanPath, extensions, result, onProgress)

      // 扫描完成后清理无图片的作品
      onProgress?.({ phase: 'cleanup', message: '清理无图片的作品...', percentage: 90 })
      const removedCount = await this.cleanupEmptyArtworks()
      result.removedArtworks = removedCount

      onProgress?.({ phase: 'complete', message: '扫描完成', percentage: 100 })
      this.logger.info({ result }, 'Scan completed')
      return result

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(errorMsg)
      this.logger.error({ error }, 'Scan failed')
      return result
    }
  }

  private async cleanupExistingData(): Promise<void> {
    try {
      // 使用事务确保原子性：先删 Image，再删 Artwork，最后删 Artist
      await this.prisma.$transaction([
        this.prisma.image.deleteMany({}),
        this.prisma.artwork.deleteMany({}),
        this.prisma.artist.deleteMany({})
      ])
      this.logger.info('Cleaned up existing data for force update')
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup existing data')
      throw error
    }
  }

  private async cleanupEmptyArtworks(): Promise<number> {
    try {
      // 查找没有图片的作品
      const emptyArtworks = await this.prisma.artwork.findMany({
        where: {
          images: {
            none: {}
          }
        },
        select: { id: true, title: true }
      })

      if (emptyArtworks.length > 0) {
        // 删除这些作品
        const artworkIds = emptyArtworks.map(a => a.id)
        await this.prisma.artwork.deleteMany({
          where: { id: { in: artworkIds } }
        })
        
        this.logger.info(`Removed ${emptyArtworks.length} artworks without images`)
        return emptyArtworks.length
      }

      return 0
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup empty artworks')
      return 0
    }
  }

  private async scanDirectory(
    dirPath: string, 
    extensions: string[], 
    result: ScanResult, 
    onProgress?: (progress: ScanProgress) => void
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      result.scannedDirectories++

      onProgress?.({ 
        phase: 'scanning', 
        message: `扫描目录: ${path.relative(this.scanRootAbs || '', dirPath)}`,
        current: result.scannedDirectories
      })

      const images: string[] = []
      const subdirectories: string[] = []

      // 分类文件和目录
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (extensions.includes(ext)) {
            images.push(fullPath)
            result.foundImages++
          }
        } else if (entry.isDirectory()) {
          // 跳过隐藏目录和系统目录
          if (!entry.name.startsWith('.') && !entry.name.startsWith('$')) {
            subdirectories.push(fullPath)
          }
        }
      }

      // 如果当前目录有图片，创建 Artwork
      if (images.length > 0) {
        onProgress?.({ 
          phase: 'creating', 
          message: `创建作品: ${path.basename(dirPath)} (${images.length}张图片)`
        })
        await this.createArtworkFromDirectory(dirPath, images, result)
      }

      // 递归扫描子目录
      for (const subDir of subdirectories) {
        await this.scanDirectory(subDir, extensions, result, onProgress)
      }

    } catch (error) {
      const errorMsg = `Failed to scan directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.warn({ error, dirPath }, 'Directory scan failed')
    }
  }

  private async createArtworkFromDirectory(dirPath: string, imagePaths: string[], result: ScanResult): Promise<void> {
    try {
      const dirName = path.basename(dirPath)
      const parentDir = path.basename(path.dirname(dirPath))

      // 尝试提取艺术家信息（父目录作为艺术家名）
      let artist = null
      if (parentDir && this.scanRootAbs && parentDir !== path.basename(this.scanRootAbs)) {
        artist = await this.findOrCreateArtist(parentDir)
      }

      // 检查是否已存在相同路径的 Artwork（并发安全：create + catch P2002）
      let artwork
      try {
        artwork = await this.prisma.artwork.create({
          data: {
            title: dirName,
            description: `Images from ${dirPath}`,
            tags: [parentDir].filter(Boolean),
            artistId: artist?.id ?? null
          }
        })
        result.newArtworks++
        this.logger.info(`Created new artwork: ${dirName}`)
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // 命中唯一约束 (artistId, title) 冲突，查找既有记录
          const existingArtwork = await this.prisma.artwork.findFirst({
            where: { title: dirName, artistId: artist?.id ?? null }
          })
          if (existingArtwork) {
            artwork = existingArtwork
            this.logger.info(`Using existing artwork after conflict: ${dirName}`)
          } else {
            throw e
          }
        } else {
          throw e
        }
      }

      // 处理图片
      for (const imagePath of imagePaths) {
        await this.createImageRecord(imagePath, artwork.id, result)
      }

    } catch (error) {
      const errorMsg = `Failed to create artwork for ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.error({ error, dirPath }, 'Artwork creation failed')
    }
  }

  private async findOrCreateArtist(artistName: string) {
    try {
      // 解析艺术家名称，尝试拆分为用户名和用户ID
      const { displayName, username, userId } = this.parseArtistName(artistName)

      // 如果解析出了 username + userId，使用 upsert 基于复合唯一键避免竞态
      if (username && userId) {
        // 某些 Prisma 版本可能不会在 WhereUniqueInput 暴露复合唯一字段名，
        // 我们降级为 tryCreate + catch P2002 再 find 的方式以保证类型安全与并发安全
        try {
          const created = await this.prisma.artist.create({
            data: {
              name: displayName,
              username,
              userId,
              bio: `Artist: ${username} (ID: ${userId})`
            }
          })
          return created
        } catch (e) {
          // 如果是重复键错误，则查询并返回已有记录
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const existing = await this.prisma.artist.findUnique({
              where: {
                // 在 d.ts 中该字段名通常生成为复合唯一约束的别名：unique_username_userid
                unique_username_userid: { username, userId }
              } as any // 兼容类型不暴露的情况
            })
            if (existing) return existing
          }
          throw e
        }
      }

      // 否则按原始名称兜底（name 非唯一，无法使用 upsert）
      let artist = await this.prisma.artist.findFirst({
        where: { name: artistName }
      })

      if (!artist) {
        artist = await this.prisma.artist.create({
          data: {
            name: displayName,
            username: null,
            userId: null,
            bio: `Artist discovered from directory: ${artistName}`
          }
        })
        this.logger.info(`Created new artist: ${displayName}`)
      }

      return artist
    } catch (error) {
      this.logger.error({ error, artistName }, 'Failed to find or create artist')
      return null
    }
  }

  /**
   * 解析艺术家名称，尝试从"用户名-用户ID"格式中提取信息
   * @param artistName 原始艺术家名称
   * @returns 解析结果：显示名称、用户名、用户ID
   */
  private parseArtistName(artistName: string): { displayName: string; username: string | null; userId: string | null } {
    // 匹配 "用户名-数字ID" 或 "用户名-字母数字ID" 格式
    const match = artistName.match(/^(.+?)-(\d+|[a-zA-Z0-9]+)$/)
    
    if (match) {
      const username = match[1].trim()
      const userId = match[2].trim()
      
      // 确保用户名不为空，用户ID看起来合理（至少2位）
      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username, // 使用用户名作为显示名称
          username: username,
          userId: userId
        }
      }
    }
    
    // 如果解析失败，返回原始名称
    return {
      displayName: artistName,
      username: null,
      userId: null
    }
  }

  private async createImageRecord(imagePath: string, artworkId: number, result: ScanResult): Promise<void> {
    try {
      // 计算相对扫描根目录的相对路径（用于容器挂载路径统一）
      let relPath = imagePath
      const root = this.scanRootAbs
      if (root) {
        const maybeRel = path.relative(root, imagePath)
        if (!maybeRel.startsWith('..')) {
          relPath = maybeRel.replace(/\\/g, '/')
        }
      }

      // 去重：兼容历史绝对路径与新的相对路径
      const existingImage = await this.prisma.image.findFirst({
        where: { OR: [ { path: relPath }, { path: imagePath } ] }
      })

      if (existingImage) {
        this.logger.debug(`Image already exists: ${relPath}`)
        return
      }

      // 获取图片文件信息
      const stats = await fs.stat(imagePath)

      // 创建图片记录（统一保存相对路径）
      await this.prisma.image.create({
        data: {
          path: relPath,
          size: stats.size,
          artworkId: artworkId
          // width 和 height 将在后续版本中通过 sharp 获取
        }
      })

      result.newImages++
      this.logger.debug(`Created image record: ${path.basename(imagePath)}`)

    } catch (error) {
      const errorMsg = `Failed to create image record for ${imagePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.warn({ error, imagePath }, 'Image record creation failed')
    }
  }
}