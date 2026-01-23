import { PixivArtworkData } from '../../../types/pixiv'

export function generateArtworkSql(artworks: PixivArtworkData[]) {
    if (artworks.length === 0) {
      return { success: false, error: '没有可生成的作品数据' }
    }

    try {
      let sqlContent = '-- PixiShelf Artwork Data Export\n'
      sqlContent += `-- Generated at ${new Date().toISOString()}\n\n`

      for (const data of artworks) {
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

export function downloadFile(content: string, filename: string) {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
}
