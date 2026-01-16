
import { useArtworkTaskStore } from '../stores/artworkTaskStore'
import { PixivArtworkData } from '../../../types/pixiv'

class ArtworkPixivService {
  private static MAX_RETRIES = 3
  private static RETRY_DELAY = 1000
  private static REQUEST_DELAY = 1500 // Min delay between requests

  private static sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  static async fetchPixivArtworkData(id: string): Promise<PixivArtworkData | null> {
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

      // Extract Tags
      const tags = body.tags?.tags?.map((t: any) => t.tag) || []

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
        resolution,
        downloadCount: 0, // Default
        fileSize: 0, // Default
        url: body.urls?.original,
        thumbnailUrl: body.urls?.thumb
      }

    } catch (error) {
      console.error(`Failed to fetch artwork ${id}:`, error)
      throw error
    }
  }

  static async processArtworks(ids: string[]) {
    const { 
      updateProgress, 
      setTaskStatus, 
      addLog, 
      updateTaskStats,
      progressData
    } = useArtworkTaskStore.getState()

    // Filter out already completed (fulfilled)
    const pendingIds = ids.filter(id => {
        const progress = progressData[id]
        return !progress || progress.status !== 'fulfilled'
    })

    if (pendingIds.length === 0) {
        addLog('所有作品已处理完成')
        setTaskStatus({ isRunning: false })
        return
    }

    addLog(`开始处理 ${pendingIds.length} 个作品`)

    for (const id of pendingIds) {
      // Check if task is paused/stopped
      if (!useArtworkTaskStore.getState().isRunning) {
        addLog('任务已暂停')
        break
      }

      try {
        let retries = 0
        let data: PixivArtworkData | null = null
        
        while (retries < this.MAX_RETRIES) {
          try {
            data = await this.fetchPixivArtworkData(id)
            break
          } catch (e: any) {
             if (e.message?.includes('429')) {
                 addLog(`触发速率限制(429)，等待 5 秒...`)
                 await this.sleep(5000)
             } else {
                 addLog(`获取作品 ${id} 失败 (重试 ${retries + 1}/${this.MAX_RETRIES}): ${e.message}`)
                 await this.sleep(this.RETRY_DELAY)
             }
             retries++
          }
        }

        if (data) {
          updateProgress(id, { status: 'fulfilled', data })
          addLog(`获取作品成功: ${data.title}`)
        } else {
          updateProgress(id, { status: 'rejected', data: '获取失败或数据为空' })
          addLog(`获取作品失败: ${id}`)
        }

      } catch (error: any) {
        updateProgress(id, { status: 'rejected', data: error.message })
        addLog(`处理作品出错 ${id}: ${error.message}`)
      } finally {
        updateTaskStats()
        // Random delay to avoid rate limiting
        const delay = this.REQUEST_DELAY + Math.random() * 1000
        await this.sleep(delay)
      }
    }

    setTaskStatus({ isRunning: false })
    addLog('任务完成')
  }

  static async generateSql() {
    const { successfulArtworks } = useArtworkTaskStore.getState()
    
    if (successfulArtworks.length === 0) {
      return { success: false, error: '没有可生成的作品数据' }
    }

    try {
      let sqlContent = '-- PixiShelf Artwork Data Export\n'
      sqlContent += `-- Generated at ${new Date().toISOString()}\n\n`

      for (const { data } of successfulArtworks) {
        // 1. Artwork Info
        // Escape strings for SQL
        const title = data.title.replace(/'/g, "''")
        const author = data.authorName.replace(/'/g, "''")
        const createTime = new Date(data.createDate).toISOString() // Or format as needed by DB
        const resolution = data.resolution || `${data.width}x${data.height}`
        
        // Artwork UPSERT
        sqlContent += `-- Artwork: ${data.id}\n`
        sqlContent += `INSERT INTO artworks (id, title, author, create_time, download_count, file_size, resolution, series_flag)\n`
        sqlContent += `VALUES ('${data.id}', '${title}', '${author}', '${createTime}', ${data.downloadCount || 0}, ${data.fileSize || 0}, '${resolution}', ${!!data.series})\n`
        sqlContent += `ON CONFLICT (id) DO UPDATE SET \n`
        sqlContent += `  title = EXCLUDED.title,\n`
        sqlContent += `  author = EXCLUDED.author,\n`
        sqlContent += `  create_time = EXCLUDED.create_time,\n`
        sqlContent += `  resolution = EXCLUDED.resolution,\n`
        sqlContent += `  series_flag = EXCLUDED.series_flag;\n\n`

        // 2. Series Info
        if (data.series) {
          sqlContent += `-- Series for Artwork: ${data.id}\n`
          sqlContent += `BEGIN TRANSACTION;\n`
          sqlContent += `INSERT INTO series (series_id, artwork_id, sequence)\n`
          sqlContent += `VALUES ('${data.series.id}', '${data.id}', ${data.series.order})\n`
          sqlContent += `ON CONFLICT (series_id, artwork_id) DO UPDATE SET sequence = EXCLUDED.sequence;\n`
          // Note: We already set series_flag in artworks table update above, but user requested explicit UPDATE inside transaction
          // Keeping user's requested logic for consistency
          sqlContent += `UPDATE artworks SET series_flag = true WHERE id = '${data.id}';\n`
          sqlContent += `COMMIT;\n\n`
        }
      }

      return { success: true, content: sqlContent }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  static async downloadSqlFile() {
    const result = await this.generateSql()
    if (!result.success || !result.content) {
      return result
    }

    try {
      const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pixiv_artworks_${new Date().getTime()}.sql`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

export default ArtworkPixivService
