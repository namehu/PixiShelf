import 'server-only'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { VIDEO_EXTENSIONS } from '@/lib/constant'

/**
 * 构建作品查询的 WHERE 子句
 */
export function buildArtworkWhereClause(params: ArtworksInfiniteQuerySchema, initialParamIndex = 1) {
  const {
    id,
    tags,
    search,
    artistId,
    artistName,
    tagId,
    tagIds,
    mediaType,
    mediaTypes,
    hasAudio,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    externalId,
    exactMatch,
    mediaCountMin,
    mediaCountMax,
    excludeTags
  } = params

  let whereSQL = 'WHERE 1=1'
  const sqlParams: any[] = []
  let paramIndex = initialParamIndex

  if (id && Number.isFinite(id)) {
    whereSQL += ` AND a.id = $${paramIndex}`
    sqlParams.push(id)
    paramIndex++
  }

  // 1.0 External ID
  if (externalId) {
    whereSQL += ` AND a."externalId" = $${paramIndex}`
    sqlParams.push(externalId)
    paramIndex++
  }

  // 1.1 艺术家筛选
  if (artistId && Number.isFinite(artistId)) {
    whereSQL += ` AND a."artistId" = $${paramIndex}`
    sqlParams.push(artistId)
    paramIndex++
  }

  // 1.1.2 艺术家名称筛选
  if (artistName) {
    if (exactMatch) {
      whereSQL += ` AND (artist.name = $${paramIndex} OR artist."userId" = $${paramIndex})`
      sqlParams.push(artistName)
      paramIndex++
    } else {
      whereSQL += ` AND (artist.name ILIKE $${paramIndex} OR artist."userId" ILIKE $${paramIndex})`
      sqlParams.push(`%${artistName}%`)
      paramIndex++
    }
  }

  // 1.2 标签名筛选
  if (tags && tags.length > 0) {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "ArtworkTag" at2
      JOIN "Tag" t2 ON at2."tagId" = t2.id
      WHERE at2."artworkId" = a.id AND t2.name = ANY($${paramIndex})
    )`
    sqlParams.push(tags)
    paramIndex++
  }

  // 1.2.5 排除标签名筛选
  if (excludeTags && excludeTags.length > 0) {
    whereSQL += ` AND NOT EXISTS (
      SELECT 1 FROM "ArtworkTag" at_ex
      JOIN "Tag" t_ex ON at_ex."tagId" = t_ex.id
      WHERE at_ex."artworkId" = a.id AND t_ex.name = ANY($${paramIndex})
    )`
    sqlParams.push(excludeTags)
    paramIndex++
  }

  // 1.2.8 多标签 ID 精确收窄：作品必须同时包含所选的全部标签
  if (tagIds && tagIds.length > 0) {
    whereSQL += ` AND (
      SELECT COUNT(DISTINCT at_ids."tagId")
      FROM "ArtworkTag" at_ids
      WHERE at_ids."artworkId" = a.id AND at_ids."tagId" = ANY($${paramIndex}::int[])
    ) = cardinality($${paramIndex}::int[])`
    sqlParams.push(tagIds)
    paramIndex++
  }

  // 1.3 标签ID筛选
  if (tagId && Number.isFinite(tagId)) {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "ArtworkTag" at3
      WHERE at3."artworkId" = a.id AND at3."tagId" = $${paramIndex}
    )`
    sqlParams.push(tagId)
    paramIndex++
  }

  // 1.4 文本搜索
  if (search) {
    if (exactMatch) {
      whereSQL += ` AND a.title = $${paramIndex}`
      sqlParams.push(search)
      paramIndex++
    } else {
      const searchCondition = `%${search}%`
      whereSQL += ` AND (
        a.title ILIKE $${paramIndex} OR
        a.description ILIKE $${paramIndex} OR
        artist.name ILIKE $${paramIndex} OR
        artist."userId" ILIKE $${paramIndex}
      )`
      sqlParams.push(searchCondition)
      paramIndex++
    }
  }

  // 1.5 精确媒体格式筛选：作品至少包含任一选中的扩展名
  if (mediaTypes && mediaTypes.length > 0) {
    const likeConditions = mediaTypes.map((_, i) => `LOWER(i.path) LIKE $${paramIndex + i}`).join(' OR ')
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "Image" i
      WHERE i."artworkId" = a.id AND (${likeConditions})
    )`
    sqlParams.push(...mediaTypes.map((ext) => `%${ext}`))
    paramIndex += mediaTypes.length
  }

  // 1.5.2 视频音频筛选：作品至少包含一个满足条件的视频媒体
  if (hasAudio === 'yes' || hasAudio === 'no') {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "Image" i_audio
      JOIN "MediaVideoMetadata" mvm_audio ON mvm_audio."imageId" = i_audio.id
      WHERE i_audio."artworkId" = a.id AND mvm_audio."hasAudio" = ${hasAudio === 'yes' ? 'true' : 'false'}
    )`
  }

  if (hasAudio === 'unknown') {
    const videoLikeConditions = VIDEO_EXTENSIONS.map((_, i) => `LOWER(i_audio.path) LIKE $${paramIndex + i}`).join(' OR ')
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "Image" i_audio
      LEFT JOIN "MediaVideoMetadata" mvm_audio ON mvm_audio."imageId" = i_audio.id
      WHERE i_audio."artworkId" = a.id
        AND (i_audio."mediaType" = 'VIDEO' OR ${videoLikeConditions})
        AND (mvm_audio."imageId" IS NULL OR mvm_audio."hasAudio" IS NULL)
    )`
    sqlParams.push(...VIDEO_EXTENSIONS.map((ext) => `%${ext}`))
    paramIndex += VIDEO_EXTENSIONS.length
  }

  // 1.5.5 粗粒度媒体类型筛选
  if (mediaType === 'video' || mediaType === 'image') {
    const extParams = VIDEO_EXTENSIONS.map((ext) => `%${ext}`)

    // 构建类似 LOWER(i.path) LIKE $5 OR LOWER(i.path) LIKE $6 ...
    const likeConditions = VIDEO_EXTENSIONS.map((_, i) => `LOWER(i.path) LIKE $${paramIndex + i}`).join(' OR ')

    const videoCheckSQL = `
      EXISTS (
        SELECT 1 FROM "Image" i
        WHERE i."artworkId" = a.id AND (${likeConditions})
      )
    `

    if (mediaType === 'video') {
      whereSQL += ` AND ${videoCheckSQL}`
    } else {
      whereSQL += ` AND NOT ${videoCheckSQL}`
    }

    sqlParams.push(...extParams)
    paramIndex += VIDEO_EXTENSIONS.length
  }

  // 1.6 时间范围筛选
  if (startDate) {
    whereSQL += ` AND a."sourceDate" >= $${paramIndex}::date`
    sqlParams.push(startDate)
    paramIndex++
  }

  if (endDate) {
    whereSQL += ` AND a."sourceDate" < ($${paramIndex}::date + 1)`
    sqlParams.push(endDate)
    paramIndex++
  }

  // 1.6.5 数据库创建时间范围筛选
  if (createdStartDate) {
    whereSQL += ` AND a."createdAt" >= $${paramIndex}::date`
    sqlParams.push(createdStartDate)
    paramIndex++
  }

  if (createdEndDate) {
    whereSQL += ` AND a."createdAt" < ($${paramIndex}::date + 1)`
    sqlParams.push(createdEndDate)
    paramIndex++
  }

  // 1.7 媒体数量筛选
  if (mediaCountMin !== undefined && mediaCountMin !== null) {
    whereSQL += ` AND a."imageCount" >= $${paramIndex}`
    sqlParams.push(mediaCountMin)
    paramIndex++
  }

  if (mediaCountMax !== undefined && mediaCountMax !== null) {
    whereSQL += ` AND a."imageCount" <= $${paramIndex}`
    sqlParams.push(mediaCountMax)
    paramIndex++
  }

  return { whereSQL, sqlParams, paramIndex }
}
