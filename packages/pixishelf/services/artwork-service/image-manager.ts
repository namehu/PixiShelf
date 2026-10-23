import { assertContentScan } from './content-source-guard'
import { createHash, randomUUID } from 'node:crypto'
import { MediaDeleteConfirmationSchema, type MediaDeleteConfirmation } from '@/schemas/artwork-delete.dto'
import { deletionMembers, executeDeletion, readDeletionIntent, type DeletionKind } from './deletion-content-guard'
import { normalizeDeletePath } from './delete-artwork-files'
import type { MediaContentDirectorySnapshot } from '@pixishelf/db'
import {
  ContentWriteConflict,
  finishLegacyContentGuards,
  publishContentOwner,
  retireContentPathMarks,
  verifyUploadReceipt
} from './content-source-guard'
import type { MediaUploadReceipt } from '@/schemas/media-content.dto'
import { prisma } from '@/lib/prisma'
import path from 'path'
import { getScanPath } from '@/services/setting.service'
import { syncMediaDerivedTagForArtwork } from '@/services/media-derived-tag-service'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { normalizeImageSizeField, toDatabaseImageSize } from '@/utils/image-size'
import { inferMediaTypeFromPath, needsAnimationContentScan } from '@/lib/media-type'
import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import {
  invalidateArtworkReadingForRebuild,
  lockArtworkForReading,
  type ArtworkReadingInvalidationTransaction
} from '@pixishelf/db'

export interface ArtworkImageTransactionClient extends ArtworkReadingInvalidationTransaction {
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
  uploadReceipt?: MediaUploadReceipt
  path: string // 存储在数据库中的相对路径
}

export interface ChapterMetaInput {
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}

export interface ReplaceChapterMetaInput extends ChapterMetaInput {
  uploadReceipt?: MediaUploadReceipt
  uploadSize?: number
  videoFileName: string
  chaptersFileName: string
}

export type ArtworkImageOrderErrorCode = 'NOT_FOUND' | 'INVALID_ORDER' | 'CONFLICT'

export class ArtworkImageOrderError extends Error {
  constructor(
    public readonly code: ArtworkImageOrderErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ArtworkImageOrderError'
  }
}

function normalizeMediaPath(mediaPath: string) {
  return mediaPath.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

/**
 * 保留数据库里仍存在的媒体项，并按扫描器提供的顺序追加新发现的媒体。
 */
export function preserveExistingMediaPathOrder<T extends { path: string }>(
  incoming: T[],
  existing: Array<{ path: string }>
): T[] {
  const incomingByPath = new Map(incoming.map((item) => [normalizeMediaPath(item.path), item]))
  const usedPaths = new Set<string>()
  const ordered: T[] = []

  for (const item of existing) {
    const normalizedPath = normalizeMediaPath(item.path)
    const incomingItem = incomingByPath.get(normalizedPath)
    if (!incomingItem || usedPaths.has(normalizedPath)) continue
    ordered.push(incomingItem)
    usedPaths.add(normalizedPath)
  }

  for (const item of incoming) {
    const normalizedPath = normalizeMediaPath(item.path)
    if (usedPaths.has(normalizedPath)) continue
    ordered.push(item)
    usedPaths.add(normalizedPath)
  }

  return ordered
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
  options: {
    appendTagIds?: number[]
    preserveExistingOrder?: boolean
    contentDirectory?: MediaContentDirectorySnapshot
  } = {}
) {
  return await prisma.$transaction(async (tx) => {
    if (options.contentDirectory) await assertContentScan(tx, [options.contentDirectory])
    return updateArtworkImagesWithTransactionClient(tx, artworkId, files, chaptersMeta, options)
  })
}

export async function updateArtworkImagesWithTransactionClient(
  tx: ArtworkImageTransactionClient,
  artworkId: number,
  files: ImageMeta[],
  chaptersMeta: ReplaceChapterMetaInput[] = [],
  options: {
    appendTagIds?: number[]
    preserveExistingOrder?: boolean
    contentDirectory?: MediaContentDirectorySnapshot
  } = {}
) {
  if (options.preserveExistingOrder) {
    return reconcileArtworkImages(
      tx as unknown as import('@/lib/prisma').AppTransaction,
      artworkId,
      files,
      chaptersMeta
    )
  }
  await invalidateArtworkReadingForRebuild(tx, artworkId)
  const orderedFiles = options.preserveExistingOrder
    ? preserveExistingMediaPathOrder(
        files,
        await tx.image.findMany({
          where: { artworkId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { path: true }
        })
      ).map((file, index) => ({ ...file, order: index }))
    : files

  // 1. 删除旧图片记录
  await tx.image.deleteMany({
    where: { artworkId }
  })

  const chaptersMetaMap = new Map(chaptersMeta.map((item) => [item.videoFileName, item]))

  // 2. 准备新图片数据
  const newImages = orderedFiles.map((file) => ({
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
    size: toDatabaseImageSize(file.size),
    mediaType: inferMediaTypeFromPath(file.path),
    webpAnimationStatus: needsAnimationContentScan(file.path) ? EMediaAnimationStatus.pending : null
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
          tagId: tag.id,
          provenance: 'MANUAL'
        })),
        skipDuplicates: true
      })
    }
  }
}

/**
 * 原子性地重排作品的全部媒体项。固定的顺序可避免过时编辑器覆盖其他标签页所做的修改。
 */
export async function reorderArtworkImages(input: {
  artworkId: number
  imageIds: number[]
  expectedImageIds: number[]
}) {
  const { artworkId, imageIds, expectedImageIds } = input

  return prisma.$transaction(async (tx) => {
    const artwork = await lockArtworkForReading(tx, artworkId)
    if (!artwork) {
      throw new ArtworkImageOrderError('NOT_FOUND', 'Artwork not found')
    }

    const currentImages = await tx.image.findMany({
      where: { artworkId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true }
    })
    const currentIds = currentImages.map((image) => image.id)

    if (
      currentIds.length !== expectedImageIds.length ||
      currentIds.some((id, index) => id !== expectedImageIds[index])
    ) {
      throw new ArtworkImageOrderError('CONFLICT', 'Media order has changed; refresh and try again')
    }

    const uniqueIds = new Set(imageIds)
    const currentIdSet = new Set(currentIds)
    if (
      imageIds.length !== currentIds.length ||
      uniqueIds.size !== imageIds.length ||
      imageIds.some((id) => !currentIdSet.has(id))
    ) {
      throw new ArtworkImageOrderError(
        'INVALID_ORDER',
        'Media order must contain every artwork media item exactly once'
      )
    }

    for (let sortOrder = 0; sortOrder < imageIds.length; sortOrder += 1) {
      await tx.image.update({
        where: { id: imageIds[sortOrder]! },
        data: { sortOrder }
      })
    }

    return { success: true as const, imageIds }
  })
}

/**
 * 删除单个图片
 * @param imageId 图片ID
 * @param deleteFile 是否同时删除物理文件
 */
const deletionImageSelect = {
  id: true,
  artworkId: true,
  path: true,
  chaptersPath: true,
  chaptersHash: true,
  size: true
} as const

async function deletionImage(imageId: number) {
  const image = await prisma.image.findUnique({ where: { id: imageId }, select: deletionImageSelect })
  if (!image) throw new Error('Image not found')
  return image
}
function deletionImagePaths(image: Awaited<ReturnType<typeof deletionImage>>, kind: 'IMAGE' | 'CHAPTERS') {
  if (kind === 'CHAPTERS' && image.chaptersPath && !isChapterManifestFileName(path.basename(image.chaptersPath))) {
    throw new Error('Invalid chapter file path')
  }
  return [
    ...new Set([
      ...(kind === 'IMAGE' ? [normalizeDeletePath(image.path)] : []),
      ...(image.chaptersPath && isChapterManifestFileName(path.basename(image.chaptersPath))
        ? [normalizeDeletePath(image.chaptersPath)]
        : [])
    ])
  ]
}
const deletionMemberDigest = (members: string) => createHash('sha256').update(members).digest('hex')

export async function previewDeleteImage(imageId: number, kind: 'IMAGE' | 'CHAPTERS', userId: string) {
  const scanRoot = await getScanPath()
  if (!scanRoot) throw new ContentWriteConflict('媒体目录未配置。')
  const previous = await readDeletionIntent({ scanRoot, userId, kind, targetId: imageId })
  if (previous && !previous.completed) {
    return {
      operationId: previous.manifest.operationId,
      recovery: true,
      selectedPaths: previous.manifest.selectedPaths,
      memberDigest: deletionMemberDigest(previous.manifest.members)
    }
  }
  const image = await deletionImage(imageId)
  return {
    operationId: randomUUID(),
    recovery: false,
    selectedPaths: deletionImagePaths(image, kind),
    memberDigest: deletionMemberDigest(deletionMembers(image))
  }
}
async function deleteImageContent(input: {
  imageId: number
  kind: Exclude<DeletionKind, 'ARTWORK'>
  userId?: string
  operationId?: string
  selectedPaths?: string[]
  memberDigest?: string
}) {
  const confirmation = MediaDeleteConfirmationSchema.safeParse(input)
  if (!confirmation.success) throw new ContentWriteConflict('请重新打开删除预览，确认原文件选择。')
  if (!input.userId) throw new ContentWriteConflict('缺少删除操作者。')
  const scanRoot = await getScanPath()
  if (!scanRoot) throw new ContentWriteConflict('媒体目录未配置。')
  return executeDeletion({
    scanRoot,
    userId: input.userId,
    kind: input.kind,
    targetId: input.imageId,
    operationId: confirmation.data.operationId,
    selectedPaths: confirmation.data.selectedPaths,
    prepare: async () => {
      const image = await deletionImage(input.imageId)
      const selectedPaths = deletionImagePaths(image, input.kind)
      if (
        deletionMemberDigest(deletionMembers(image)) !== confirmation.data.memberDigest ||
        JSON.stringify([...selectedPaths].sort()) !== JSON.stringify([...confirmation.data.selectedPaths].sort())
      ) {
        throw new ContentWriteConflict('媒体关联或文件选择已变化，请重新打开删除预览。')
      }
      return {
        selectedPaths,
        files: selectedPaths.map((relative) => ({
          path: relative,
          kind: relative === normalizeDeletePath(image.path) ? ('MEDIA' as const) : ('CHAPTER' as const),
          reason: '原确认框选择的文件'
        })),
        directories: [],
        scopePaths: [normalizeDeletePath(image.path), ...selectedPaths],
        artworkIds: [],
        imageIds: [image.id],
        members: deletionMembers(image)
      }
    },
    verifyMembers: async (tx, members) => {
      if (deletionMemberDigest(members) !== confirmation.data.memberDigest) {
        throw new ContentWriteConflict('删除预览与原恢复操作不一致。')
      }
      const image = JSON.parse(members) as Awaited<ReturnType<typeof deletionImage>>
      if (image.artworkId) await lockArtworkForReading(tx, image.artworkId)
      const current = await tx.image.findUnique({ where: { id: image.id }, select: deletionImageSelect })
      if (deletionMembers(current) !== members) throw new ContentWriteConflict('媒体关联已变化，保留原删除意图。')
    },
    publish: async (tx, manifest) => {
      const image = JSON.parse(manifest.members) as Awaited<ReturnType<typeof deletionImage>>
      if (input.kind === 'IMAGE') {
        await tx.image.delete({ where: { id: image.id } })
        if (image.artworkId) await syncMediaDerivedTagForArtwork(tx, image.artworkId)
      } else {
        await tx.image.update({
          where: { id: image.id },
          data: {
            chaptersPath: null,
            chaptersCount: 0,
            chaptersDuration: null,
            chaptersUpdatedAt: null,
            chaptersHash: null
          }
        })
      }
    }
  })
}

export async function deleteImage(
  imageId: number,
  deleteFile: boolean,
  userId?: string,
  confirmation?: Partial<MediaDeleteConfirmation>
) {
  if (deleteFile) {
    await deleteImageContent({ imageId, kind: 'IMAGE', userId, ...confirmation })
    return true
  }
  const image = await deletionImage(imageId)
  await prisma.$transaction(async (tx) => {
    if (image.artworkId) await lockArtworkForReading(tx, image.artworkId)
    const writing = await tx.image.findUnique({
      where: { id: imageId },
      select: {
        contentSource: { select: { writeToken: true } },
        artwork: { select: { contentSource: { select: { writeToken: true } } } }
      }
    })
    if (writing?.contentSource?.writeToken || writing?.artwork?.contentSource?.writeToken) {
      throw new ContentWriteConflict()
    }
    const current = await tx.image.findUnique({ where: { id: imageId }, select: deletionImageSelect })
    if (deletionMembers(current) !== deletionMembers(image)) throw new ContentWriteConflict()
    await tx.image.delete({ where: { id: imageId } })
    if (image.artworkId) await syncMediaDerivedTagForArtwork(tx, image.artworkId)
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
    await lockArtworkForReading(tx, artworkId)
    const image = await tx.image.create({
      data: {
        artworkId,
        path: file.path,
        sortOrder: file.order,
        width: file.width,
        height: file.height,
        size: toDatabaseImageSize(file.size),
        mediaType: inferMediaTypeFromPath(file.path),
        webpAnimationStatus: needsAnimationContentScan(file.path) ? EMediaAnimationStatus.pending : null
      }
    })

    await syncMediaDerivedTagForArtwork(tx, artworkId)

    return normalizeImageSizeField(image)
  })
}

/**
 * 新增单张图片并可附带章节元信息
 * @param artworkId 作品ID
 * @param file 图片元数据
 * @param chaptersMeta 章节元信息
 */
export async function addImageWithChapters(
  artworkId: number,
  file: ImageMeta,
  chaptersMeta?: ChapterMetaInput,
  userId?: string
) {
  return prisma.$transaction(async (tx) => {
    const receipt = file.uploadReceipt
    if (!receipt || !userId) throw new ContentWriteConflict('缺少已完成上传的回执。')
    const checkpoint = await verifyUploadReceipt(tx, userId, receipt, file.path, { size: file.size })
    if (checkpoint.handle.parentWriteId) throw new ContentWriteConflict('替换会话必须整体提交。')
    if (checkpoint.status === 'COMPLETED') {
      const previous = await tx.mediaContentPathWrite.findUniqueOrThrow({
        where: { id: checkpoint.handle.writeId },
        select: { resolutionEvidenceId: true }
      })
      const match = previous.resolutionEvidenceId?.match(/^image:(\d+):(\d+)$/)
      if (!match || Number(match[1]) !== artworkId) throw new ContentWriteConflict()
      const image = await tx.image.findUnique({ where: { id: Number(match[2]), artworkId } })
      if (!image) throw new ContentWriteConflict('已发布的媒体已变化。')
      return normalizeImageSizeField(image)
    }
    return publishContentOwner(tx, userId, [receipt.authorization], 'committed', async (inner) => {
      await lockArtworkForReading(inner, artworkId)
      const artwork = await inner.artwork.findUnique({
        where: { id: artworkId },
        select: { storagePath: true, images: { take: 1, select: { path: true } } }
      })
      if (!artwork) throw new ContentWriteConflict('作品已不存在。')
      const expectedDirectory = (artwork.storagePath ?? path.posix.dirname(artwork.images[0]?.path ?? ''))
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
      if (!expectedDirectory || path.posix.dirname(file.path.replace(/^\/+/, '')) !== expectedDirectory) {
        throw new ContentWriteConflict('上传路径不属于此作品。')
      }
      const existing = await inner.image.findFirst({
        where: { artworkId, path: { in: [file.path.replace(/^\/+/, ''), `/${file.path.replace(/^\/+/, '')}`] } }
      })
      const data = {
        path: file.path,
        sortOrder: file.order,
        width: file.width,
        height: file.height,
        size: toDatabaseImageSize(file.size),
        mediaType: inferMediaTypeFromPath(file.path),
        webpAnimationStatus: needsAnimationContentScan(file.path) ? EMediaAnimationStatus.pending : null,
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
      if (existing) await retireContentPathMarks(inner, file.path)
      const image = existing
        ? await inner.image.update({ where: { id: existing.id }, data })
        : await inner.image.create({ data: { ...data, artworkId } })
      await inner.mediaContentPathWrite.update({
        where: { id: receipt.authorization.handle.writeId },
        data: {
          resolutionEvidenceId: `image:${artworkId}:${image.id}`,
          childDisposition: 'PUBLISH',
          resolvedAt: new Date()
        }
      })
      await finishLegacyContentGuards(inner, { sourcePath: file.path })
      await syncMediaDerivedTagForArtwork(inner, artworkId)
      return normalizeImageSizeField(image)
    })
  })
}

/**
 * 为图片关联章节元信息
 * @param input 关联入参
 */
export async function associateChaptersToImage(input: { imageId: number } & ChapterMetaInput) {
  const image = await prisma.image.update({
    where: { id: input.imageId },
    data: {
      chaptersPath: input.chaptersPath,
      chaptersCount: input.chaptersCount,
      chaptersDuration: input.chaptersDuration,
      chaptersUpdatedAt: new Date(),
      chaptersHash: input.chaptersHash
    }
  })

  return normalizeImageSizeField(image)
}

/**
 * 清空图片章节信息
 * @param input 清空入参
 */
export async function clearChaptersForImage(input: {
  imageId: number
  deleteFile?: boolean
  userId?: string
  operationId?: string
  selectedPaths?: string[]
  memberDigest?: string
}) {
  if (input.deleteFile) {
    await deleteImageContent({ ...input, kind: 'CHAPTERS' })
    return normalizeImageSizeField(await prisma.image.findUniqueOrThrow({ where: { id: input.imageId } }))
  }
  const image = await deletionImage(input.imageId)
  return prisma.$transaction(async (tx) => {
    if (image.artworkId) await lockArtworkForReading(tx, image.artworkId)
    const current = await tx.image.findUnique({
      where: { id: image.id },
      select: {
        chaptersPath: true,
        contentSource: { select: { writeToken: true } },
        artwork: { select: { contentSource: { select: { writeToken: true } } } }
      }
    })
    if (
      !current ||
      current.chaptersPath !== image.chaptersPath ||
      current.artwork?.contentSource?.writeToken ||
      current.contentSource?.writeToken
    ) {
      throw new ContentWriteConflict()
    }
    return normalizeImageSizeField(
      await tx.image.update({
        where: { id: image.id },
        data: {
          chaptersPath: null,
          chaptersCount: 0,
          chaptersDuration: null,
          chaptersUpdatedAt: null,
          chaptersHash: null
        }
      })
    )
  })
}

/** Reconcile a normal scan without retiring unchanged Image IDs or their personal data. */
export async function reconcileArtworkImages(
  tx: import('@/lib/prisma').AppTransaction,
  artworkId: number,
  files: ImageMeta[],
  chapters: ReplaceChapterMetaInput[] = []
) {
  await lockArtworkForReading(tx, artworkId)
  const source = await tx.artworkContentSource.findUnique({ where: { artworkId }, select: { writeToken: true } })
  if (source?.writeToken) throw new ContentWriteConflict()
  const existing = await tx.image.findMany({ where: { artworkId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  const key = (value: string) => value.replace(/^\/+/, '')
  const byPath = new Map(existing.map((image) => [key(image.path), image]))
  const incoming = new Map(files.map((file) => [key(file.path), file]))
  if (incoming.size !== files.length) throw new ContentWriteConflict('Duplicate scan media paths')
  const ordered = [
    ...existing.flatMap((image) => (incoming.has(key(image.path)) ? [incoming.get(key(image.path))!] : [])),
    ...files.filter((file) => !byPath.has(key(file.path)))
  ]
  const chapterMap = new Map(chapters.map((item) => [item.videoFileName, item]))
  for (let order = 0; order < ordered.length; order++) {
    const file = ordered[order]!
    const current = byPath.get(key(file.path))
    const chapter = chapterMap.get(file.fileName)
    const data = {
      width: file.width,
      height: file.height,
      size: toDatabaseImageSize(file.size),
      sortOrder: order,
      mediaType: inferMediaTypeFromPath(file.path),
      ...(chapter
        ? {
            chaptersPath: chapter.chaptersPath,
            chaptersCount: chapter.chaptersCount,
            chaptersDuration: chapter.chaptersDuration,
            chaptersHash: chapter.chaptersHash,
            chaptersUpdatedAt: new Date()
          }
        : {})
    }
    if (current) await tx.image.update({ where: { id: current.id }, data })
    else {
      await tx.image.create({
        data: {
          ...data,
          artworkId,
          path: file.path,
          webpAnimationStatus: needsAnimationContentScan(file.path) ? EMediaAnimationStatus.pending : null
        }
      })
    }
  }
  const removedIds = existing.filter((image) => !incoming.has(key(image.path))).map((image) => image.id)
  if (removedIds.length) await tx.image.deleteMany({ where: { id: { in: removedIds }, artworkId } })
  await syncMediaDerivedTagForArtwork(tx, artworkId)
}
