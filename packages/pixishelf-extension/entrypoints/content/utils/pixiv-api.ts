import { PixivArtworkData, PixivTagData, PixivApiResponse, PixivUserApiResponse, PixivUserData } from '../../../types/pixiv'

/**
 * 从 Pixiv API 获取作品数据
 * @param id 作品 ID
 * @returns 作品数据或 null
 */
export async function fetchPixivArtworkData(id: string): Promise<PixivArtworkData | null> {
  const url = `https://www.pixiv.net/ajax/illust/${id}?lang=zh`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const json = await response.json()
    if (json.error) {
      throw new Error(json.message || 'Pixiv API error')
    }

    const body = json.body
    if (!body) return null

    // Extract Series Info
    let series = null
    if (body.seriesNavData) {
      series = {
        id: body.seriesNavData.seriesId,
        title: body.seriesNavData.title,
        order: body.seriesNavData.order
      }
    }

    // Extract Metrics
    const bookmarkCount = body.bookmarkCount || 0
    const likeCount = body.likeCount || 0
    const viewCount = body.viewCount || 0
    const xRestrict = body.xRestrict || 0

    // Extract Tags
    const tags =
      body.tags?.tags?.map((t: any) => ({
        name: t.tag,
        translation: t.translation
      })) || []

    // Extract Resolution
    const resolution = `${body.width}x${body.height}`

    return {
      id: body.id,
      title: body.title,
      description: body.description,
      createDate: body.createDate,
      uploadDate: body.uploadDate,
      authorId: body.userId,
      authorName: body.userName,
      pageCount: body.pageCount,
      width: body.width,
      height: body.height,
      tags,
      series,
      bookmarkCount,
      likeCount,
      viewCount,
      xRestrict,
      resolution,
      downloadCount: 0, // Default
      fileSize: 0, // Default
      url: body.urls?.original,
      thumbnailUrl: body.urls?.thumb
    }
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error(`Failed to fetch artwork ${id}:`, error)
    throw error
  }
}

/**
 * 从 Pixiv API 获取标签数据
 * @param tag 标签名
 * @returns 标签数据
 */
export async function fetchPixivTagData(tag: string): Promise<PixivTagData> {
  const url = `https://www.pixiv.net/ajax/search/tags/${encodeURIComponent(tag)}?lang=zh`

  const response = await fetch(url, {
    headers: { accept: 'application/json' }
  })

  if (response.status === 429) {
    const error = new Error('HTTP 请求失败! 状态: 429')
    error.name = 'RateLimitError'
    throw error
  }

  if (!response.ok) {
    throw new Error(`HTTP 请求失败! 状态: ${response.status} for tag: ${tag}`)
  }

  const data: PixivApiResponse = await response.json()

  if (data.error || !data.body) {
    throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`)
  }

  const body = data.body
  const translationData = body.tagTranslation?.[tag]
  const pixpedia = body.pixpedia || {}

  // 提取中文和英文翻译
  const chineseTranslation = translationData?.zh
  const englishTranslation = translationData?.en

  // 提取 abstract 和 image
  const abstract = pixpedia.abstract
  const imageUrl = pixpedia.image

  return {
    originalTag: tag,
    translation: chineseTranslation || null,
    englishTranslation: englishTranslation || null,
    abstract: abstract || null,
    imageUrl: imageUrl || null
  }
}

/**
 * 从 Pixiv API 获取用户数据
 * @param userId 用户 ID
 * @returns 用户数据
 */
export async function fetchPixivUserData(userId: string): Promise<PixivUserData> {
  const apiUrl = `https://www.pixiv.net/ajax/user/${userId}?full=1&lang=zh`
  const response = await fetch(apiUrl, {
    headers: { accept: 'application/json' }
  })

  if (response.status === 429) {
    const error = new Error('HTTP 请求失败! 状态: 429')
    error.name = 'RateLimitError'
    throw error
  }

  if (response.status === 404) {
    throw new Error(`用户 ID 不存在: ${userId}`)
  }

  if (!response.ok) {
    throw new Error(`HTTP 请求失败! 状态: ${response.status}`)
  }

  const data = await response.json()

  if (data.error || !data.body) {
    throw new Error(`Pixiv API 返回错误: ${data.message || '响应中没有 body'}`)
  }

  const body = data.body

  // 提取头像和背景图，优先使用 imageBig，并考虑为空的情况
  const avatarUrl = body.imageBig || body.image || null
  const backgroundUrl = body.background?.url || null

  return {
    userId: body.userId,
    name: body.name,
    avatarUrl: avatarUrl,
    backgroundUrl: backgroundUrl
  }
}
