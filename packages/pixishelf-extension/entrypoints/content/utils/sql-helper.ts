import { PixivArtworkData } from '../../../types/pixiv'

export function generateArtworkSql(artworks: PixivArtworkData[]) {
  if (artworks.length === 0) {
    return { success: false, error: '没有可生成的作品数据' }
  }

  try {
    const timestamp = new Date().toISOString()
    let mainSql = `-- PixiShelf Artwork Data Export (Main)\n`
    mainSql += `-- Generated at ${timestamp}\n\n`

    let tagsSql = `-- PixiShelf Artwork Data Export (Tags)\n`
    tagsSql += `-- Generated at ${timestamp}\n\n`

    for (const data of artworks) {
      // --- Main SQL ---
      mainSql += `-- Transaction for Artwork: ${data.id}\n`
      mainSql += `BEGIN;\n\n`

      // Helper for escaping SQL strings
      const escapeSql = (str: string | null | undefined) => {
        if (!str) return ''
        return str.replace(/'/g, "''")
      }

      // We use Pixiv User ID as Artist ID.
      // const artistId = parseInt(data.authorId) // Not used in Update Only mode
      // Note: artworkId used to be parseInt(data.id) directly used as PK.
      // Now we treat data.id as externalId.
      const artworkExternalId = data.id
      const title = escapeSql(data.title)
      const description = escapeSql(data.description)
      const updateTime = new Date(data.uploadDate).toISOString()
      const bookmarkCount = data.bookmarkCount
      const width = data.width
      const height = data.height
      const sizeStr = `${width}x${height}`
      const originalUrl = escapeSql(data.url)
      const thumbnailUrl = escapeSql(data.thumbnailUrl)
      const descriptionLength = description.length

      // 1. Series & Artwork (Update with CTE) - Scenario B
      // 使用 CTE 动态获取 Series ID 和 Artwork ID 并插入 SeriesArtwork
      if (data.series) {
        const seriesExternalId = escapeSql(data.series.id)
        const seriesTitle = escapeSql(data.series.title)
        const sortOrder = data.series.order

        mainSql += `-- 1. Series Upsert & Artwork Update (CTE)\n`
        mainSql += `WITH upserted_series AS (\n`
        mainSql += `    INSERT INTO "Series" ("title", "source", "externalId", "updatedAt")\n`
        mainSql += `    VALUES ('${seriesTitle}', 'PIXIV', '${seriesExternalId}', NOW())\n`
        mainSql += `    ON CONFLICT ("source", "externalId")\n`
        mainSql += `    DO UPDATE SET "title" = EXCLUDED."title", "updatedAt" = NOW()\n`
        mainSql += `    RETURNING "id"\n`
        mainSql += `),\n`
        mainSql += `updated_artwork AS (\n`
        mainSql += `    UPDATE "Artwork" SET \n`
        mainSql += `        "title" = '${title}',\n`
        mainSql += `        "description" = '${description}',\n`
        mainSql += `        "updatedAt" = '${updateTime}',\n`
        mainSql += `        "bookmarkCount" = ${bookmarkCount},\n`
        mainSql += `        "originalUrl" = '${originalUrl}',\n`
        mainSql += `        "thumbnailUrl" = '${thumbnailUrl}',\n`
        mainSql += `        "size" = '${sizeStr}',\n`
        mainSql += `        "descriptionLength" = ${descriptionLength}\n`
        mainSql += `    WHERE "externalId" = '${artworkExternalId}'\n`
        mainSql += `    RETURNING "id"\n`
        mainSql += `)\n`
        mainSql += `INSERT INTO "SeriesArtwork" ("seriesId", "artworkId", "sortOrder")\n`
        mainSql += `SELECT s.id, a.id, ${sortOrder}\n`
        mainSql += `FROM upserted_series s, updated_artwork a\n`
        mainSql += `ON CONFLICT ("seriesId", "artworkId") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";\n\n`
      } else {
        // 2. No Series - Just Update Artwork
        mainSql += `-- 2. Artwork Update (No Series)\n`
        mainSql += `UPDATE "Artwork" SET \n`
        mainSql += `    "title" = '${title}',\n`
        mainSql += `    "description" = '${description}',\n`
        mainSql += `    "updatedAt" = '${updateTime}',\n`
        mainSql += `    "bookmarkCount" = ${bookmarkCount},\n`
        mainSql += `    "originalUrl" = '${originalUrl}',\n`
        mainSql += `    "thumbnailUrl" = '${thumbnailUrl}',\n`
        mainSql += `    "size" = '${sizeStr}',\n`
        mainSql += `    "descriptionLength" = ${descriptionLength}\n`
        mainSql += `WHERE "externalId" = '${artworkExternalId}';\n\n`
      }

      mainSql += `COMMIT;\n\n`

      // --- Tags SQL ---
      if (data.tags && data.tags.length > 0) {
        tagsSql += `-- Transaction for Artwork Tags: ${data.id}\n`
        tagsSql += `BEGIN;\n\n`

        for (const tag of data.tags) {
          const tagName = escapeSql(tag.name)
          // Handle translations: prefer en, Pixiv API might provide others in future
          const hasTranslation = !!tag.translation?.en
          const tagEn = tag.translation?.en ? `'${escapeSql(tag.translation.en)}'` : 'NULL'
          const translateType = hasTranslation ? "'PIXIV'" : "'NONE'"

          // Upsert Tag
          tagsSql += `INSERT INTO "Tag" ("name", "name_en", "translateType", "updatedAt")\n`
          tagsSql += `VALUES ('${tagName}', ${tagEn}, ${translateType}, NOW())\n`
          tagsSql += `ON CONFLICT ("name") DO UPDATE SET "name_en" = COALESCE(EXCLUDED."name_en", "Tag"."name_en"), "translateType" = CASE WHEN EXCLUDED."translateType" != 'NONE' THEN EXCLUDED."translateType" ELSE "Tag"."translateType" END, "updatedAt" = NOW();\n`

          // Link ArtworkTag
          // Fix: Use subquery to find artworkId by externalId, as artworkId is now auto-increment
          tagsSql += `INSERT INTO "ArtworkTag" ("artworkId", "tagId")\n`
          tagsSql += `VALUES (\n`
          tagsSql += `    (SELECT "id" FROM "Artwork" WHERE "externalId" = '${artworkExternalId}'),\n`
          tagsSql += `    (SELECT "id" FROM "Tag" WHERE "name" = '${tagName}')\n`
          tagsSql += `)\n`
          tagsSql += `ON CONFLICT ("artworkId", "tagId") DO NOTHING;\n`
        }
        tagsSql += `\nCOMMIT;\n\n`
      }
    }

    return { success: true, content: { main: mainSql, tags: tagsSql } }
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
