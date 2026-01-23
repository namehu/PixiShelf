import { PixivArtworkData } from '../../../types/pixiv'

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
