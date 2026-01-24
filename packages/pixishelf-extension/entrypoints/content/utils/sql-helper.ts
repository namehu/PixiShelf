import { PixivArtworkData } from '../../../types/pixiv'

export function generateArtworkSql(artworks: PixivArtworkData[]) {
  if (artworks.length === 0) {
    return { success: false, error: '没有可生成的作品数据' }
  }

  try {
    const timestamp = new Date().toISOString()
    let seriesSql = `-- PixiShelf Artwork Data Export (Series)\n`
    seriesSql += `-- Generated at ${timestamp}\n\n`

    let noSeriesSql = `-- PixiShelf Artwork Data Export (No Series)\n`
    noSeriesSql += `-- Generated at ${timestamp}\n\n`

    let tagsSql = `-- PixiShelf Artwork Data Export (Tags)\n`
    tagsSql += `-- Generated at ${timestamp}\n\n`

    for (const data of artworks) {
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
        seriesSql += `-- Transaction for Artwork: ${data.id}\n`
        seriesSql += `BEGIN;\n\n`

        const seriesExternalId = escapeSql(data.series.id)
        const seriesTitle = escapeSql(data.series.title)
        const sortOrder = data.series.order

        seriesSql += `-- 1. Series Upsert & Artwork Update (CTE)\n`
        seriesSql += `WITH upserted_series AS (\n`
        seriesSql += `    INSERT INTO "Series" ("title", "source", "externalId", "updatedAt")\n`
        seriesSql += `    VALUES ('${seriesTitle}', 'PIXIV', '${seriesExternalId}', NOW())\n`
        seriesSql += `    ON CONFLICT ("source", "externalId")\n`
        seriesSql += `    DO UPDATE SET "title" = EXCLUDED."title", "updatedAt" = NOW()\n`
        seriesSql += `    RETURNING "id"\n`
        seriesSql += `),\n`
        seriesSql += `updated_artwork AS (\n`
        seriesSql += `    UPDATE "Artwork" SET \n`
        seriesSql += `        "title" = '${title}',\n`
        seriesSql += `        "description" = '${description}',\n`
        seriesSql += `        "updatedAt" = '${updateTime}',\n`
        seriesSql += `        "bookmarkCount" = ${bookmarkCount},\n`
        seriesSql += `        "originalUrl" = '${originalUrl}',\n`
        seriesSql += `        "thumbnailUrl" = '${thumbnailUrl}',\n`
        seriesSql += `        "size" = '${sizeStr}',\n`
        seriesSql += `        "descriptionLength" = ${descriptionLength}\n`
        seriesSql += `    WHERE "externalId" = '${artworkExternalId}'\n`
        seriesSql += `    RETURNING "id"\n`
        seriesSql += `)\n`
        seriesSql += `INSERT INTO "SeriesArtwork" ("seriesId", "artworkId", "sortOrder")\n`
        seriesSql += `SELECT s.id, a.id, ${sortOrder}\n`
        seriesSql += `FROM upserted_series s, updated_artwork a\n`
        seriesSql += `ON CONFLICT ("seriesId", "artworkId") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder";\n\n`

        seriesSql += `COMMIT;\n\n`
      } else {
        noSeriesSql += `-- Transaction for Artwork: ${data.id}\n`
        noSeriesSql += `BEGIN;\n\n`

        // 2. No Series - Just Update Artwork
        noSeriesSql += `-- 2. Artwork Update (No Series)\n`
        noSeriesSql += `UPDATE "Artwork" SET \n`
        noSeriesSql += `    "title" = '${title}',\n`
        noSeriesSql += `    "description" = '${description}',\n`
        noSeriesSql += `    "updatedAt" = '${updateTime}',\n`
        noSeriesSql += `    "bookmarkCount" = ${bookmarkCount},\n`
        noSeriesSql += `    "originalUrl" = '${originalUrl}',\n`
        noSeriesSql += `    "thumbnailUrl" = '${thumbnailUrl}',\n`
        noSeriesSql += `    "size" = '${sizeStr}',\n`
        noSeriesSql += `    "descriptionLength" = ${descriptionLength}\n`
        noSeriesSql += `WHERE "externalId" = '${artworkExternalId}';\n\n`

        noSeriesSql += `COMMIT;\n\n`
      }

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

    return { success: true, content: { series: seriesSql, noSeries: noSeriesSql, tags: tagsSql } }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
