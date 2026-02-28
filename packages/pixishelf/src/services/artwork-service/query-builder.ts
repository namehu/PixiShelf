import 'server-only'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { VIDEO_EXTENSIONS } from '../../../lib/constant'

/**
 * 构建作品查询的 WHERE 子句
 */
export function buildArtworkWhereClause(params: ArtworksInfiniteQuerySchema, initialParamIndex = 1) {
  const {
    tags,
    search,
    artistId,
    artistName,
    tagId,
    mediaType,
    startDate,
    endDate,
    externalId,
    exactMatch,
    mediaCountMin,
    mediaCountMax
  } = params

  let whereSQL = 'WHERE 1=1'
  const sqlParams: any[] = []
  let paramIndex = initialParamIndex

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
      whereSQL += ` AND artist.name = $${paramIndex}`
      sqlParams.push(artistName)
      paramIndex++
    } else {
      whereSQL += ` AND artist.name ILIKE $${paramIndex}`
      sqlParams.push(`%${artistName}%`)
      paramIndex++
    }
  }

  // 1.2 标签名筛选
  if (tags.length > 0) {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "ArtworkTag" at2
      JOIN "Tag" t2 ON at2."tagId" = t2.id
      WHERE at2."artworkId" = a.id AND t2.name = ANY($${paramIndex})
    )`
    sqlParams.push(tags)
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
        artist.name ILIKE $${paramIndex}
      )`
      sqlParams.push(searchCondition)
      paramIndex++
    }
  }

  // 1.5 媒体类型筛选
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
