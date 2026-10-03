import 'server-only'
import { randomUUID } from 'crypto'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { lockArtworkForReading, lockCreatorCatalog, type Prisma } from '@pixishelf/db'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import { requestArchiveArtworkMaintenance } from '@/services/archive/archive-maintenance-service'
import {
  ArtworkDeleteReportSchema,
  ArtworkDeletePreviewSchema,
  ArtworkDeleteInputSchema,
  type ArtworkDeleteInput,
  countArtworkDeleteEntries,
  type ArtworkDeleteReport
} from '@/schemas/artwork-delete.dto'
import {
  ArtworkFileDeletion,
  determineDeleteDirectory,
  fileErrorCode,
  normalizeDeletePath,
  type DeleteFileReference
} from './delete-artwork-files'

/** Query only the affected path prefixes, including legacy leading slashes and Windows separators. */
async function findOtherReferences(artworkId: number, scopes: string[]): Promise<DeleteFileReference[]> {
  if (!scopes.length) return []
  const variants = (value: string) => [
    value,
    `/${value}`,
    value.replace(/\//g, '\\'),
    `\\${value.replace(/\//g, '\\')}`
  ]
  const mode = process.platform === 'win32' ? ('insensitive' as const) : ('default' as const)
  // Prisma startsWith uses PostgreSQL LIKE. Backslashes must remain literal separators;
  // underscores/percent signs in real directory names must not become wildcards.
  const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
  const filters = [...new Set(scopes)].flatMap((scope) =>
    variants(scope).flatMap((value) => [
      { equals: value, mode },
      { startsWith: escapeLike(`${value}${value.includes('\\') ? '\\' : '/'}`), mode }
    ])
  )
  const ancestorFilters = [
    ...new Set(
      scopes.flatMap((scope) => {
        const segments = scope.split('/')
        return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
      })
    )
  ].flatMap((scope) => variants(scope).map((equals) => ({ equals, mode })))
  const [artworks, images] = await Promise.all([
    prisma.artwork.findMany({
      where: {
        id: { not: artworkId },
        OR: [
          ...[...filters, ...ancestorFilters].map((filter) => ({ storagePath: filter })),
          ...filters.map((filter) => ({ metaSource: filter }))
        ]
      },
      select: { storagePath: true, metaSource: true }
    }),
    prisma.image.findMany({
      where: {
        AND: [
          { OR: [{ artworkId: { not: artworkId } }, { artworkId: null }] },
          {
            OR: [...filters.map((filter) => ({ path: filter })), ...filters.map((filter) => ({ chaptersPath: filter }))]
          }
        ]
      },
      select: { path: true, chaptersPath: true }
    })
  ])
  return [
    ...artworks.flatMap((row) => [
      ...(row.storagePath ? [{ path: row.storagePath, directory: true }] : []),
      ...(row.metaSource ? [{ path: row.metaSource, directory: false }] : [])
    ]),
    ...images.flatMap((row) => [
      { path: row.path, directory: false },
      ...(row.chaptersPath ? [{ path: row.chaptersPath, directory: false }] : [])
    ])
  ]
}

async function loadArtwork(id: number) {
  const artwork = await prisma.artwork.findUnique({
    where: { id }
  })
  if (!artwork) throw new Error(`Artwork ${id} not found`)
  return artwork
}

function createReport(artwork: Awaited<ReturnType<typeof loadArtwork>>): ArtworkDeleteReport {
  const id = artwork.id
  const report: ArtworkDeleteReport = {
    reportId: randomUUID(),
    artwork: { id, title: artwork.title, createdVia: artwork.createdVia, directory: null },
    startedAt: new Date().toISOString(),
    finishedAt: '',
    mode: artwork.createdVia === 'URL_ARCHIVE' ? 'ARCHIVE_TRASH' : 'DIRECT_DELETE',
    outcome: 'FAILED',
    entries: [],
    database: { artwork: 'NOT_ATTEMPTED', media: 'NOT_ATTEMPTED', deletedMediaCount: 0, relatedRecords: [] },
    counts: countArtworkDeleteEntries([]),
    inspectionComplete: false,
    warnings: [],
    archive: null
  }
  return report
}

async function prepareFiles(artwork: Awaited<ReturnType<typeof loadArtwork>>, report: ArtworkDeleteReport) {
  const images = await prisma.image.findMany({
    where: { artworkId: artwork.id },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, chaptersPath: true }
  })
  const directory = determineDeleteDirectory({ ...artwork, images })
  report.artwork.directory = directory
  const files = new ArtworkFileDeletion(report, {
    scanRoot: await getScanPath(),
    directory,
    media: images,
    metaSource: artwork.metaSource
  })
  const scopes = [
    directory,
    ...images.flatMap((image) =>
      [image.path, image.chaptersPath].flatMap((value) => {
        try {
          if (!value) return []
          const normalized = normalizeDeletePath(value)
          const parent = path.posix.dirname(normalized)
          return [parent === '.' ? normalized : parent]
        } catch {
          return []
        }
      })
    )
  ].filter((value): value is string => Boolean(value && value !== '.'))
  await files.prepare(await findOtherReferences(artwork.id, scopes))
  return { files, images }
}

export async function previewDeleteArtwork(id: number) {
  const artwork = await loadArtwork(id)
  const report = createReport(artwork)
  if (artwork.createdVia === 'URL_ARCHIVE') {
    return ArtworkDeletePreviewSchema.parse({
      artwork: report.artwork,
      mode: report.mode,
      directoryMode: 'REGISTERED_ONLY',
      canDelete: true,
      inspectionComplete: false,
      entries: [],
      warnings: ['归档作品整包移入回收站，保留 7 天。']
    })
  }
  const { files } = await prepareFiles(artwork, report)
  return ArtworkDeletePreviewSchema.parse(files.preview())
}

export async function deleteArtwork(
  input: ArtworkDeleteInput,
  options: { requestedByUserId: string }
): Promise<ArtworkDeleteReport> {
  const { artworkId: id, selectedPaths } = ArtworkDeleteInputSchema.parse(input)
  const artwork = await loadArtwork(id)
  const report = createReport(artwork)
  const finish = () => {
    report.finishedAt = new Date().toISOString()
    report.counts = countArtworkDeleteEntries(report.entries)
    const result = ArtworkDeleteReportSchema.parse(report)
    // Same report ID and actual outcomes in server logs; never log the raw exception/absolute paths to the client.
    logger.info('[DeleteArtwork] Result', result)
    if (result.outcome === 'FAILED' || result.outcome === 'PARTIAL') {
      logger.warn('[DeleteArtwork] Incomplete deletion', {
        reportId: result.reportId,
        artworkId: id,
        warnings: result.warnings
      })
    }
    return result
  }
  if (artwork.createdVia === 'URL_ARCHIVE') {
    try {
      const maintenance = await requestArchiveArtworkMaintenance({
        artworkId: id,
        action: 'TRASH_ARCHIVE',
        requestedByUserId: options.requestedByUserId
      })
      report.archive = {
        jobId: maintenance.jobId,
        lifecycleState: maintenance.lifecycleState,
        reused: maintenance.reused
      }
      report.database.artwork = 'RETAINED'
      report.database.media = 'RETAINED'
      report.outcome = 'QUEUED'
      report.warnings.push('作品已标记删除，归档文件由回收任务处理。本次请求未执行文件移动或物理删除；保留期为 7 天。')
    } catch {
      report.database.artwork = 'FAILED'
      report.warnings.push('回收请求未完成，请检查是否存在归档更新、恢复任务或状态冲突。')
    }
    return finish()
  }

  try {
    if (!selectedPaths) throw new Error('A file selection is required')
    const { files, images } = await prepareFiles(artwork, report)
    const filesDeleted = await files.deleteSelected(selectedPaths)
    if (!filesDeleted) {
      report.database.artwork = 'RETAINED'
      report.database.media = 'RETAINED'
      report.warnings.push('部分选中文件删除失败，作品及媒体记录已保留。重新打开删除预览可重试；已删文件不会自动恢复。')
      report.outcome = report.entries.some((entry) => entry.status === 'DELETED') ? 'PARTIAL' : 'FAILED'
      return finish()
    }
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        // Image triggers update Artwork; always acquire the catalog lock before its row lock.
        await lockCreatorCatalog(tx as unknown as Prisma.TransactionClient)
        await lockArtworkForReading(tx as unknown as Prisma.TransactionClient, id)
        const current = await tx.image.findMany({
          where: { artworkId: id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, path: true, chaptersPath: true }
        })
        if (JSON.stringify(current) !== JSON.stringify(images)) throw new Error('Media records changed')
        const result = await tx.image.deleteMany({ where: { artworkId: id } })
        await tx.artwork.delete({ where: { id } })
        return result
      })
      report.database.media = 'DELETED'
      report.database.artwork = 'DELETED'
      report.database.deletedMediaCount = deleted.count
      report.database.relatedRecords.push(
        '媒体的探测信息、章节预览、代表帧等数据库关联随媒体记录级联移除；派生媒体目录不在本次文件清理范围内。',
        '作品的标签、收藏、创作者、系列成员、来源引用、来源快照、原始元数据及作品关系随作品记录级联移除。'
      )
    } catch (error) {
      report.database.media = 'FAILED'
      report.database.artwork = 'FAILED'
      report.warnings.push('数据库删除事务失败，作品及媒体记录均保留；已删除的文件不会自动恢复。')
      throw error
    }
    await files.cleanupDirectories()
    report.outcome = report.entries.some((entry) => entry.status === 'FAILED') ? 'PARTIAL' : 'COMPLETED'
  } catch (error) {
    report.warnings.push(`删除流程未完成（${fileErrorCode(error)}）。请核对明细后重新预览。`)
    if (report.database.artwork === 'NOT_ATTEMPTED') report.database.artwork = 'RETAINED'
    if (report.database.media === 'NOT_ATTEMPTED') report.database.media = 'RETAINED'
    report.outcome = report.entries.some((entry) => entry.status === 'DELETED') ? 'PARTIAL' : 'FAILED'
  }
  return finish()
}
