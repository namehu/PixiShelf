// oxlint-disable max-lines
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { syncMediaDerivedTagsForArtworks } from '@/services/media-derived-tag-service'
import { buildScannedImageSeedData, type ScannedImageSeedData } from './scan-image-builder'
import { getMetaSource, getPathBasename } from './path-utils'
import type { MetadataInfo } from './metadata-parser'
import type { ArtworkData, ScanContext } from './types'

/**
 * 批量处理一个批次的作品（使用事务）
 * @param batch 批次作品数组
 * @param context 扫描上下文
 */
export async function processBatch(batch: ArtworkData[], context: ScanContext): Promise<void> {
  const imageSeedStartTime = Date.now()
  const imageSeedMap = await precomputeBatchImageSeeds(batch, context)
  const imageSeeds = Array.from(imageSeedMap.values()).reduce((total, seeds) => total + seeds.length, 0)
  logger.info('Scan performance checkpoint:', {
    phase: 'image_seed_precompute',
    durationMs: Date.now() - imageSeedStartTime,
    batchSize: batch.length,
    imageSeeds
  })

  const transactionStartTime = Date.now()
  let artworksToCreateCount = 0
  let imagesToCreateCount = 0
  let artworkTagsToCreateCount = 0
  let rawMetadataToCreateCount = 0

  await prisma.$transaction(
    async (tx) => {
      // 准备批量数据
      const artworksToCreate = []
      const imagesToCreate = []
      const artworkTagsToCreate = []
      const rawMetadataToCreate = []

      for (const artworkData of batch) {
        const { metadata, directoryCreatedAt, metadataFilePath } = artworkData

        // 从缓存获取艺术家
        const artist = context.artistCache.get(metadata.userId)
        if (!artist) {
          logger.warn('Artist not found in cache, this should not happen after batch processing:', {
            userId: metadata.userId
          })
          continue
        }

        // 准备作品数据
        const artworkToCreate = {
          title: metadata.title,
          description: metadata.description || null,
          artistId: artist.id,
          imageCount: 0, // 初始为 0，由 DB 触发器在插入图片时自动增加
          descriptionLength: metadata.description?.length || 0,
          externalId: metadata.id,
          metaSource: getMetaSource(metadataFilePath, context.options.scanPath),
          sourceUrl: metadata.url || null,
          originalUrl: metadata.original || null,
          thumbnailUrl: metadata.thumbnail || null,
          xRestrict: metadata.xRestrict || null,
          isAiGenerated: metadata.ai === 'Yes',
          size: metadata.size || null,
          bookmarkCount: metadata.bookmark || null,
          sourceDate: metadata.date || null,
          directoryCreatedAt,
          metadataFormat: metadata.metadataFormat || 'txt',
          pixivAiType: metadata.pixivAiType ?? null,
          pixivType: metadata.pixivType ?? null,
          sanityLevel: metadata.sanityLevel ?? null
        }

        artworksToCreate.push(artworkToCreate)
      }

      // 批量创建作品
      if (artworksToCreate.length > 0) {
        // 使用 createMany 而不是 createManyAndReturn 来提高性能
        const artworkCreateStartTime = Date.now()
        await tx.artwork.createMany({
          data: artworksToCreate,
          skipDuplicates: true
        })
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_artwork_create',
          durationMs: Date.now() - artworkCreateStartTime,
          batchSize: batch.length,
          artworksToCreate: artworksToCreate.length
        })

        context.scanResult.newArtworks += artworksToCreate.length

        // 查询刚创建的作品以获取 ID（通过 externalId 匹配）
        const externalIds = artworksToCreate.map((a) => a.externalId)
        const artworkLookupStartTime = Date.now()
        const createdArtworks = await tx.artwork.findMany({
          where: {
            externalId: {
              in: externalIds
            }
          },
          orderBy: {
            id: 'asc'
          }
        })
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_artwork_lookup',
          durationMs: Date.now() - artworkLookupStartTime,
          batchSize: batch.length,
          externalIds: externalIds.length
        })

        // 创建 externalId 到 artwork 的映射
        const artworkMap = new Map()
        for (const artwork of createdArtworks) {
          artworkMap.set(artwork.externalId, artwork)
        }

        // 为每个作品准备图片和标签数据
        for (const artworkData of batch) {
          const artwork = artworkMap.get(artworkData.metadata.id)
          if (!artwork) continue

          // 准备图片数据
          if (artworkData.mediaFiles.length > 0) {
            const artworkImages = (imageSeedMap.get(artworkData.metadata.id) || []).map((imageSeed) => ({
              ...imageSeed,
              artworkId: artwork.id
            }))
            imagesToCreate.push(...artworkImages)
          }

          const rawMetadataJson = getRawMetadataJsonInput(artworkData.metadata)
          if (rawMetadataJson !== undefined) {
            rawMetadataToCreate.push({
              artworkId: artwork.id,
              rawMetadataJson
            })
          }

          // 准备标签关联数据
          if (artworkData.metadata.tags && artworkData.metadata.tags.length > 0) {
            for (const tagName of artworkData.metadata.tags) {
              if (!tagName) continue

              const tagId = context.tagCache.get(tagName)
              if (tagId) {
                artworkTagsToCreate.push({
                  artworkId: artwork.id,
                  tagId
                })
              }
            }
          }
        }
        artworksToCreateCount = artworksToCreate.length
        imagesToCreateCount = imagesToCreate.length
        artworkTagsToCreateCount = artworkTagsToCreate.length
        rawMetadataToCreateCount = rawMetadataToCreate.length

        // 批量创建图片
        const imageCreateStartTime = Date.now()
        if (imagesToCreate.length > 0) {
          await tx.image.createMany({
            data: imagesToCreate,
            skipDuplicates: true
          })
          context.scanResult.newImages += imagesToCreate.length
        }
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_image_create',
          durationMs: Date.now() - imageCreateStartTime,
          batchSize: batch.length,
          imagesToCreate: imagesToCreate.length
        })

        // 批量创建作品-标签关联
        const artworkTagCreateStartTime = Date.now()
        if (artworkTagsToCreate.length > 0) {
          await tx.artworkTag.createMany({
            data: artworkTagsToCreate,
            skipDuplicates: true
          })
        }
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_artwork_tag_create',
          durationMs: Date.now() - artworkTagCreateStartTime,
          batchSize: batch.length,
          artworkTagsToCreate: artworkTagsToCreate.length
        })

        const rawMetadataCreateStartTime = Date.now()
        if (rawMetadataToCreate.length > 0) {
          await tx.artworkRawMetadata.createMany({
            data: rawMetadataToCreate,
            skipDuplicates: true
          })
        }
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_raw_metadata_create',
          durationMs: Date.now() - rawMetadataCreateStartTime,
          batchSize: batch.length,
          rawMetadataToCreate: rawMetadataToCreate.length
        })

        const mediaDerivedTagSyncStartTime = Date.now()
        const imageArtworkIds = imagesToCreate.map((image) => image.artworkId)
        await syncMediaDerivedTagsForArtworks(tx, imageArtworkIds)
        logger.info('Scan performance checkpoint:', {
          phase: 'transaction_write_media_derived_tag_sync',
          durationMs: Date.now() - mediaDerivedTagSyncStartTime,
          batchSize: batch.length,
          artworkIds: new Set(imageArtworkIds).size
        })
      }
    },
    {
      timeout: 30000, // 增加事务超时时间到 30 秒
      maxWait: 5000 // 最大等待时间 5 秒
    }
  )

  logger.info('Scan performance checkpoint:', {
    phase: 'transaction_write',
    durationMs: Date.now() - transactionStartTime,
    batchSize: batch.length,
    artworksToCreate: artworksToCreateCount,
    imagesToCreate: imagesToCreateCount,
    artworkTagsToCreate: artworkTagsToCreateCount,
    rawMetadataToCreate: rawMetadataToCreateCount
  })
}

/**
 * 批量预处理当前批次作品的艺术家（增量处理）
 * @param artworks 作品数组
 * @param context 扫描上下文
 */
export async function batchProcessArtists(artworks: ArtworkData[], context: ScanContext): Promise<void> {
  const startTime = Date.now()
  // 1. 收集当前批次中缓存中不存在的艺术家用户ID
  const uncachedUserIds = new Set<string>()
  for (const artwork of artworks) {
    if (artwork.metadata.userId && !context.artistCache.has(artwork.metadata.userId)) {
      uncachedUserIds.add(artwork.metadata.userId)
    }
  }

  if (uncachedUserIds.size === 0) {
    logger.info('All artists in current batch are already cached, skipping artist processing')
    logger.info('Scan performance checkpoint:', {
      phase: 'artist_processing',
      durationMs: Date.now() - startTime,
      batchSize: artworks.length,
      uncachedArtists: 0,
      createdArtists: 0,
      totalArtistsInCache: context.artistCache.size
    })
    return
  }

  logger.info('Processing uncached artists in current batch:', { uncachedArtists: uncachedUserIds.size })

  // 2. 批量查询数据库中已存在的艺术家
  const existingArtistLookupStartTime = Date.now()
  const existingArtists = await prisma.artist.findMany({
    where: {
      userId: {
        in: Array.from(uncachedUserIds)
      }
    }
  })
  logger.info('Scan performance checkpoint:', {
    phase: 'artist_processing_existing_lookup',
    durationMs: Date.now() - existingArtistLookupStartTime,
    batchSize: artworks.length,
    uncachedArtists: uncachedUserIds.size,
    existingArtists: existingArtists.length
  })

  // 构建已存在艺术家的映射
  const existingArtistMap = new Map<string, any>()
  for (const artist of existingArtists) {
    if (artist.userId) {
      existingArtistMap.set(artist.userId, artist)
      // 增量更新缓存
      context.artistCache.set(artist.userId, artist)
    }
  }

  // 3. 筛选出需要新建的艺术家
  const artistsToCreate = []
  for (const artwork of artworks) {
    const userId = artwork.metadata.userId
    if (userId && uncachedUserIds.has(userId) && !existingArtistMap.has(userId)) {
      artistsToCreate.push({
        name: artwork.metadata.user,
        username: artwork.metadata.user,
        userId: userId,
        bio: `Artist from external source (ID: ${userId})`
      })
    }
  }

  // 4. 批量创建新艺术家
  if (artistsToCreate.length > 0) {
    logger.info('Creating new artists in batch:', { artistsToCreateCount: artistsToCreate.length })

    const artistCreateStartTime = Date.now()
    await prisma.artist.createMany({
      data: artistsToCreate,
      skipDuplicates: true
    })
    logger.info('Scan performance checkpoint:', {
      phase: 'artist_processing_create',
      durationMs: Date.now() - artistCreateStartTime,
      batchSize: artworks.length,
      artistsToCreate: artistsToCreate.length
    })

    context.scanResult.newArtists += artistsToCreate.length

    // 再次查询新创建的艺术家获取完整信息
    const createdArtistLookupStartTime = Date.now()
    const newlyCreatedArtists = await prisma.artist.findMany({
      where: {
        userId: {
          in: artistsToCreate.map((a) => a.userId)
        }
      }
    })
    logger.info('Scan performance checkpoint:', {
      phase: 'artist_processing_created_lookup',
      durationMs: Date.now() - createdArtistLookupStartTime,
      batchSize: artworks.length,
      artistsToCreate: artistsToCreate.length,
      createdArtistsFound: newlyCreatedArtists.length
    })

    // 增量更新缓存
    for (const artist of newlyCreatedArtists) {
      if (artist.userId) {
        context.artistCache.set(artist.userId, artist)
      }
    }
  }

  logger.info('Batch artist processing completed:', { totalArtistsInCache: context.artistCache.size })
  logger.info('Scan performance checkpoint:', {
    phase: 'artist_processing',
    durationMs: Date.now() - startTime,
    batchSize: artworks.length,
    uncachedArtists: uncachedUserIds.size,
    createdArtists: artistsToCreate.length,
    totalArtistsInCache: context.artistCache.size
  })
}

function getRawMetadataJsonInput(metadata: MetadataInfo): Prisma.InputJsonValue | undefined {
  if (
    metadata.metadataFormat !== 'json' ||
    metadata.rawMetadataJson === undefined ||
    metadata.rawMetadataJson === null
  ) {
    return undefined
  }

  return metadata.rawMetadataJson as Prisma.InputJsonValue
}

/**
 * 批量预处理当前批次作品的标签（增量处理）
 * @param artworks 作品数组
 * @param context 扫描上下文
 */
export async function batchProcessTags(artworks: ArtworkData[], context: ScanContext): Promise<void> {
  const startTime = Date.now()
  // 1. 收集当前批次中缓存中不存在的标签名称
  const uncachedTagNames = new Set<string>()
  for (const artwork of artworks) {
    if (artwork.metadata.tags && artwork.metadata.tags.length > 0) {
      for (const tagName of artwork.metadata.tags) {
        if (tagName && !context.tagCache.has(tagName)) {
          uncachedTagNames.add(tagName)
        }
      }
    }
  }

  if (uncachedTagNames.size === 0) {
    logger.info('All tags in current batch are already cached, skipping tag processing')
    logger.info('Scan performance checkpoint:', {
      phase: 'tag_processing',
      durationMs: Date.now() - startTime,
      batchSize: artworks.length,
      uncachedTags: 0,
      createdTags: 0,
      totalTagsInCache: context.tagCache.size
    })
    return
  }

  logger.info('Processing uncached tags in current batch:', { uncachedTags: uncachedTagNames.size })

  // 2. 批量查询数据库中已存在的标签
  const existingTagLookupStartTime = Date.now()
  const existingTags = await prisma.tag.findMany({
    where: {
      name: {
        in: Array.from(uncachedTagNames)
      }
    },
    select: {
      id: true,
      name: true
    }
  })
  logger.info('Scan performance checkpoint:', {
    phase: 'tag_processing_existing_lookup',
    durationMs: Date.now() - existingTagLookupStartTime,
    batchSize: artworks.length,
    uncachedTags: uncachedTagNames.size,
    existingTags: existingTags.length
  })

  // 构建已存在标签的映射并增量更新缓存
  const existingTagMap = new Map<string, number>()
  for (const tag of existingTags) {
    existingTagMap.set(tag.name, tag.id)
    // 增量更新缓存
    context.tagCache.set(tag.name, tag.id)
  }

  // 3. 筛选出需要新建的标签
  const tagsToCreate = Array.from(uncachedTagNames).filter((tagName) => !existingTagMap.has(tagName))

  // 4. 批量创建操作：一次性创建所有新标签
  if (tagsToCreate.length > 0) {
    logger.info('Creating new tags in batch:', { tagsToCreateCount: tagsToCreate.length })

    const tagCreateStartTime = Date.now()
    await prisma.tag.createMany({
      data: tagsToCreate.map((name) => ({ name })),
      skipDuplicates: true // 防止并发创建重复标签
    })
    logger.info('Scan performance checkpoint:', {
      phase: 'tag_processing_create',
      durationMs: Date.now() - tagCreateStartTime,
      batchSize: artworks.length,
      tagsToCreate: tagsToCreate.length
    })

    context.scanResult.newTags += tagsToCreate.length

    // 再次查询新创建的标签获取其ID
    const createdTagLookupStartTime = Date.now()
    const newlyCreatedTags = await prisma.tag.findMany({
      where: {
        name: {
          in: tagsToCreate
        }
      },
      select: {
        id: true,
        name: true
      }
    })
    logger.info('Scan performance checkpoint:', {
      phase: 'tag_processing_created_lookup',
      durationMs: Date.now() - createdTagLookupStartTime,
      batchSize: artworks.length,
      tagsToCreate: tagsToCreate.length,
      createdTagsFound: newlyCreatedTags.length
    })

    // 增量更新缓存
    for (const tag of newlyCreatedTags) {
      context.tagCache.set(tag.name, tag.id)
    }
  }

  logger.info('Batch tag processing completed:', { totalTagsInCache: context.tagCache.size })
  logger.info('Scan performance checkpoint:', {
    phase: 'tag_processing',
    durationMs: Date.now() - startTime,
    batchSize: artworks.length,
    uncachedTags: uncachedTagNames.size,
    createdTags: tagsToCreate.length,
    totalTagsInCache: context.tagCache.size
  })
}

/**
 * 批量处理重新扫描的作品（更新逻辑）
 * @param batch 作品数据数组
 * @param context 扫描上下文
 */
export async function processRescanBatch(batch: ArtworkData[], context: ScanContext): Promise<void> {
  const imageSeedMap = await precomputeBatchImageSeeds(batch, context)

  await prisma.$transaction(
    async (tx) => {
      for (const artworkData of batch) {
        const { metadata, directoryCreatedAt, metadataFilePath } = artworkData

        // 获取 Artist ID
        const artist = context.artistCache.get(metadata.userId)
        if (!artist) {
          throw new Error(`Artist not found for user ID: ${metadata.userId}`)
        }

        // 1. 更新 Artwork 基础信息
        // 查找现有 Artwork
        const existingArtwork = await tx.artwork.findUnique({
          where: { externalId: metadata.id }
        })

        if (!existingArtwork) {
          throw new Error(`Artwork with externalId ${metadata.id} not found in database`)
        }

        logger.debug('update artwork:', existingArtwork, {
          title: metadata.title,
          description: metadata.description || null,
          artistId: artist.id,
          descriptionLength: metadata.description?.length || 0,
          sourceUrl: metadata.url || null,
          originalUrl: metadata.original || null,
          thumbnailUrl: metadata.thumbnail || null,
          xRestrict: metadata.xRestrict || null,
          isAiGenerated: metadata.ai === 'Yes',
          size: metadata.size || null,
          bookmarkCount: metadata.bookmark || null,
          sourceDate: metadata.date || null,
          directoryCreatedAt,
          metadataFormat: metadata.metadataFormat || 'txt',
          pixivAiType: metadata.pixivAiType ?? null,
          pixivType: metadata.pixivType ?? null,
          sanityLevel: metadata.sanityLevel ?? null
        })

        await tx.artwork.update({
          where: { id: existingArtwork.id },
          data: {
            title: metadata.title,
            description: metadata.description || null,
            artistId: artist.id,
            descriptionLength: metadata.description?.length || 0,
            sourceUrl: metadata.url || null,
            originalUrl: metadata.original || null,
            thumbnailUrl: metadata.thumbnail || null,
            xRestrict: metadata.xRestrict || null,
            isAiGenerated: metadata.ai === 'Yes',
            size: metadata.size || null,
            bookmarkCount: metadata.bookmark || null,
            sourceDate: metadata.date || null,
            directoryCreatedAt,
            metaSource: getMetaSource(metadataFilePath, context.options.scanPath),
            metadataFormat: metadata.metadataFormat || 'txt',
            pixivAiType: metadata.pixivAiType ?? null,
            pixivType: metadata.pixivType ?? null,
            sanityLevel: metadata.sanityLevel ?? null
          }
        })

        const rawMetadataJson = getRawMetadataJsonInput(metadata)
        if (rawMetadataJson !== undefined) {
          await tx.artworkRawMetadata.upsert({
            where: { artworkId: existingArtwork.id },
            create: {
              artworkId: existingArtwork.id,
              rawMetadataJson
            },
            update: {
              rawMetadataJson
            }
          })
        } else {
          await tx.artworkRawMetadata.deleteMany({
            where: { artworkId: existingArtwork.id }
          })
        }

        // 2. 更新图片 (删除旧的，插入新的)
        // 删除旧图片
        await tx.image.deleteMany({
          where: { artworkId: existingArtwork.id }
        })

        // 插入新图片
        if (artworkData.mediaFiles.length > 0) {
          const imagesToCreate = (imageSeedMap.get(artworkData.metadata.id) || []).map((imageSeed) => ({
            ...imageSeed,
            artworkId: existingArtwork.id
          }))

          logger.debug('imagesToCreate:', imagesToCreate)
          await tx.image.createMany({
            data: imagesToCreate
          })
          context.scanResult.newImages += imagesToCreate.length
        }

        await syncMediaDerivedTagsForArtworks(tx, [existingArtwork.id])

        context.scanResult.newArtworks += 1 // 借用这个字段表示处理成功数
      }
    },
    {
      timeout: 30000,
      maxWait: 5000
    }
  )
}

/**
 * 在事务外预计算图片与章节摘要，避免事务持有期间做文件系统 I/O。
 * @param batch 当前批次作品
 * @param context 扫描上下文
 * @returns externalId -> 图片种子数据
 */
async function precomputeBatchImageSeeds(
  batch: ArtworkData[],
  context: ScanContext
): Promise<Map<string, ScannedImageSeedData[]>> {
  const imageSeedEntries = await Promise.all(
    batch.map(async (artworkData) => {
      const imageSeeds = await buildScannedImageSeedData({
        mediaFiles: artworkData.mediaFiles,
        scanPath: context.options.scanPath,
        onChapterWarning: ({ mediaPath, message }) => {
          const warningMessage = `Chapter scan warning for artwork ${artworkData.metadata.id}, media ${getPathBasename(mediaPath)}: ${message}`
          logger.warn(warningMessage, {
            artworkId: artworkData.metadata.id,
            mediaPath
          })
          context.scanResult.errors.push(warningMessage)
        }
      })

      return [artworkData.metadata.id, imageSeeds] as const
    })
  )

  return new Map(imageSeedEntries)
}
