import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'

export interface ScanOptions {
  scanPath: string
  supportedExtensions?: string[]
}

export interface ScanResult {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
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
      errors: []
    }

    try {
      const scanPath = options.scanPath
      const extensions = options.supportedExtensions || this.supportedExtensions

      // 记录规范化后的扫描根目录，供相对路径换算
      this.scanRootAbs = path.resolve(scanPath)

      this.logger.info(`Starting scan of: ${scanPath}`)

      // 检查扫描路径是否存在
      try {
        await fs.access(scanPath)
      } catch (error) {
        throw new Error(`Scan path does not exist: ${scanPath}`)
      }

      // 递归扫描目录
      await this.scanDirectory(scanPath, extensions, result)

      this.logger.info('Scan completed', result)
      return result

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(errorMsg)
      this.logger.error({ error }, 'Scan failed')
      return result
    }
  }

  private async scanDirectory(dirPath: string, extensions: string[], result: ScanResult): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      result.scannedDirectories++

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
        await this.createArtworkFromDirectory(dirPath, images, result)
      }

      // 递归扫描子目录
      for (const subDir of subdirectories) {
        await this.scanDirectory(subDir, extensions, result)
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
      if (parentDir && parentDir !== path.basename(process.env.SCAN_PATH || '')) {
        artist = await this.findOrCreateArtist(parentDir)
      }

      // 检查是否已存在相同路径的 Artwork
      const existingArtwork = await this.prisma.artwork.findFirst({
        where: {
          title: dirName,
          // 可以添加更精确的路径检查
        }
      })

      let artwork
      if (existingArtwork) {
        artwork = existingArtwork
        this.logger.info(`Using existing artwork: ${dirName}`)
      } else {
        // 创建新的 Artwork
        artwork = await this.prisma.artwork.create({
          data: {
            title: dirName,
            description: `Images from ${dirPath}`,
            tags: [parentDir].filter(Boolean),
            artistId: artist?.id
          }
        })
        result.newArtworks++
        this.logger.info(`Created new artwork: ${dirName}`)
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
      // 查找现有艺术家
      let artist = await this.prisma.artist.findFirst({
        where: { name: artistName }
      })

      if (!artist) {
        // 创建新艺术家
        artist = await this.prisma.artist.create({
          data: {
            name: artistName,
            bio: `Artist discovered from directory: ${artistName}`
          }
        })
        this.logger.info(`Created new artist: ${artistName}`)
      }

      return artist
    } catch (error) {
      this.logger.error({ error, artistName }, 'Failed to find or create artist')
      return null
    }
  }

  private async createImageRecord(imagePath: string, artworkId: number, result: ScanResult): Promise<void> {
    try {
      // 计算相对扫描根目录的相对路径（用于容器挂载路径统一）
      let relPath = imagePath
      const root = this.scanRootAbs || (process.env.SCAN_PATH ? path.resolve(process.env.SCAN_PATH) : null)
      if (root) {
        const maybeRel = path.relative(root, imagePath)
        // 当无法求出合理相对路径时，path.relative 可能返回包含 '..' 的路径，此时仍保留原路径
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