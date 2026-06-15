import { prisma } from '@/lib/prisma'
import fs from 'fs/promises'
import path from 'path'
import { getScanPath } from '@/services/setting.service'
import { syncMediaDerivedTagForArtwork } from '@/services/media-derived-tag-service'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'

export interface ArtworkImageTransactionClient {
  image: {
    deleteMany(args: any): Promise<any>
    createMany(args: any): Promise<any>
    findMany(args: any): Promise<any>
  }
  tag: {
    findMany(args: any): Promise<any>
    findFirst(args: any): Promise<any>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
  }
  artworkTag: {
    createMany(args: any): Promise<any>
    deleteMany(args: any): Promise<any>
  }
}

/**
 * 图片元数据接口
 */
export interface ImageMeta {
  fileName: string
  order: number
  width: number
  height: number
  size: number
  path: string // 存储在数据库中的相对路径
}

export interface ChapterMetaInput {
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}

export interface ReplaceChapterMetaInput extends ChapterMetaInput {
  videoFileName: string
  chaptersFileName: string
}

/**
 * 全量替换作品图片事务
 * 执行逻辑：
 * 1. 删除该作品关联的所有旧 Image 记录
 * 2. 批量插入新的 Image 记录
 *
 * @param artworkId 作品ID
 * @param files 图片元数据列表
 */
export async function updateArtworkImagesTransaction(
  artworkId: number,
  files: ImageMeta[],
  chaptersMeta: ReplaceChapterMetaInput[] = [],
  options: { appendTagIds?: number[] } = {}
) {
  return await prisma.$transaction((tx) =>
    updateArtworkImagesWithTransactionClient(tx, artworkId, files, chaptersMeta, options)
  )
}

export async function updateArtworkImagesWithTransactionClient(
  tx: ArtworkImageTransactionClient,
  artworkId: number,
  files: ImageMeta[],
  chaptersMeta: ReplaceChapterMetaInput[] = [],
  options: { appendTagIds?: number[] } = {}
) {
  // 1. 删除旧图片记录
  await tx.image.deleteMany({
    where: { artworkId }
  })

  const chaptersMetaMap = new Map(chaptersMeta.map((item) => [item.videoFileName, item]))

  // 2. 准备新图片数据
  const newImages = files.map((file) => ({
    ...(chaptersMetaMap.get(file.fileName)
      ? {
          chaptersPath: chaptersMetaMap.get(file.fileName)!.chaptersPath,
          chaptersCount: chaptersMetaMap.get(file.fileName)!.chaptersCount,
          chaptersDuration: chaptersMetaMap.get(file.fileName)!.chaptersDuration,
          chaptersUpdatedAt: new Date(),
          chaptersHash: chaptersMetaMap.get(file.fileName)!.chaptersHash
        }
      : {}),
    artworkId,
    path: file.path,
    sortOrder: file.order,
    width: file.width,
    height: file.height,
    size: file.size
  }))

  // 3. 批量创建新图片
  if (newImages.length > 0) {
    await tx.image.createMany({
      data: newImages
    })
  }

  await syncMediaDerivedTagForArtwork(tx, artworkId)

  const appendTagIds = Array.from(new Set((options.appendTagIds ?? []).filter((id) => Number.isInteger(id) && id > 0)))
  if (appendTagIds.length > 0) {
    const existingTags = await tx.tag.findMany({
      where: { id: { in: appendTagIds } },
      select: { id: true }
    })

    if (existingTags.length > 0) {
      await tx.artworkTag.createMany({
        data: existingTags.map((tag: { id: number }) => ({
          artworkId,
          tagId: tag.id
        })),
        skipDuplicates: true
      })
    }
  }
}

/**
 * 删除单个图片
 * @param imageId 图片ID
 * @param deleteFile 是否同时删除物理文件
 */
export async function deleteImage(imageId: number, deleteFile: boolean) {
  // 1. 获取图片信息
  const image = await prisma.image.findUnique({
    where: { id: imageId }
  })

  if (!image) {
    throw new Error('Image not found')
  }

  // 2. 如果需要删除文件，执行物理删除
  if (deleteFile) {
    const scanPath = await getScanPath()
    if (scanPath) {
      const pathsToDelete = [image.path]

      if (image.chaptersPath && isChapterManifestFileName(path.basename(image.chaptersPath))) {
        pathsToDelete.push(image.chaptersPath)
      }

      for (const relativePath of pathsToDelete) {
        const fullPath = resolvePathWithinScanRoot(scanPath, relativePath)

        try {
          await fs.unlink(fullPath)
        } catch (error: any) {
          // 如果是文件不存在，可以忽略错误继续删除数据库记录
          if (error.code !== 'ENOENT') {
            console.error(`Failed to delete file: ${fullPath}`, error)
            throw new Error(`Failed to delete physical file: ${error.message}`)
          }
        }
      }
    }
  }

  // 3. 删除数据库记录并同步媒体派生标签
  await prisma.$transaction(async (tx) => {
    await tx.image.delete({
      where: { id: imageId }
    })

    if (image.artworkId) {
      await syncMediaDerivedTagForArtwork(tx, image.artworkId!)
    }
  })

  return true
}

/**
 * 新增单张图片
 * @param artworkId 作品ID
 * @param file 图片元数据
 */
export async function addImage(artworkId: number, file: ImageMeta) {
  return await prisma.$transaction(async (tx) => {
    const image = await tx.image.create({
      data: {
        artworkId,
        path: file.path,
        sortOrder: file.order,
        width: file.width,
        height: file.height,
        size: file.size
      }
    })

    await syncMediaDerivedTagForArtwork(tx, artworkId)

    return image
  })
}

/**
 * 新增单张图片并可附带章节元信息
 * @param artworkId 作品ID
 * @param file 图片元数据
 * @param chaptersMeta 章节元信息
 */
export async function addImageWithChapters(artworkId: number, file: ImageMeta, chaptersMeta?: ChapterMetaInput) {
  return await prisma.$transaction(async (tx) => {
    const image = await tx.image.create({
      data: {
        artworkId,
        path: file.path,
        sortOrder: file.order,
        width: file.width,
        height: file.height,
        size: file.size,
        ...(chaptersMeta
          ? {
              chaptersPath: chaptersMeta.chaptersPath,
              chaptersCount: chaptersMeta.chaptersCount,
              chaptersDuration: chaptersMeta.chaptersDuration,
              chaptersUpdatedAt: new Date(),
              chaptersHash: chaptersMeta.chaptersHash
            }
          : {})
      }
    })

    await syncMediaDerivedTagForArtwork(tx, artworkId)

    return image
  })
}

/**
 * 为图片关联章节元信息
 * @param input 关联入参
 */
export async function associateChaptersToImage(input: { imageId: number } & ChapterMetaInput) {
  return prisma.image.update({
    where: { id: input.imageId },
    data: {
      chaptersPath: input.chaptersPath,
      chaptersCount: input.chaptersCount,
      chaptersDuration: input.chaptersDuration,
      chaptersUpdatedAt: new Date(),
      chaptersHash: input.chaptersHash
    }
  })
}

/**
 * 清空图片章节信息
 * @param input 清空入参
 */
export async function clearChaptersForImage(input: { imageId: number; deleteFile?: boolean }) {
  const image = await prisma.image.findUnique({
    where: { id: input.imageId },
    select: {
      id: true,
      chaptersPath: true
    }
  })

  if (!image) {
    throw new Error('Image not found')
  }

  if (input.deleteFile && image.chaptersPath) {
    if (!isChapterManifestFileName(path.basename(image.chaptersPath))) {
      throw new Error('Invalid chapter file path')
    }

    const scanPath = await getScanPath()
    if (scanPath) {
      const fullPath = resolvePathWithinScanRoot(scanPath, image.chaptersPath)

      try {
        await fs.unlink(fullPath)
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to delete chapter file: ${error.message}`)
        }
      }
    }
  }

  return prisma.image.update({
    where: { id: input.imageId },
    data: {
      chaptersPath: null,
      chaptersCount: 0,
      chaptersDuration: null,
      chaptersUpdatedAt: null,
      chaptersHash: null
    }
  })
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
