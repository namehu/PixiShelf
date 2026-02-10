import path from 'path'
import fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { prisma } from '@/lib/prisma'
import { migrationLogger } from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { buildArtworkWhereClause } from '@/services/artwork-service/query-builder'

// 状态定义
export type MigrationStatus = 'PENDING' | 'SKIPPED' | 'SUCCESS' | 'FAILED'

export interface MigrationResult {
  artworkId: number
  status: MigrationStatus
  msg: string[]
}

export interface MigrationStats {
  total: number
  processed: number
  success: number
  skipped: number
  failed: number
}

export interface MigrationFailedItem {
  artworkId: number
  externalId: string | null
  msg: string[]
}

export interface MigrationJobResult extends MigrationStats {
  failedItems: MigrationFailedItem[]
}

export interface MigrationSafetyOptions {
  transferMode?: 'move' | 'copy'
  verifyAfterCopy?: boolean
  cleanupSource?: boolean
}

export interface MigrationRunOptions {
  targetIds?: number[]
  batchSize?: number
  concurrency?: number
  startAfterId?: number
  filters?: MigrationFilters
  safety?: MigrationSafetyOptions
}

export interface MigrationFilters {
  search?: string | null
  artistName?: string | null
  startDate?: string | null
  endDate?: string | null
  externalId?: string | null
  exactMatch?: boolean
}

export interface MigrationPrecheckInput {
  targetIds?: number[]
  filters?: MigrationFilters
}

export interface MigrationPrecheckResult {
  total: number
  eligible: number
  missingArtist: number
  missingExternalId: number
  missingImages: number
}

const toUtcDate = (dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`)

const addUtcDays = (dateStr: string, days: number) => {
  const date = toUtcDate(dateStr)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

const buildMigrationWhere = (filters?: MigrationFilters) => {
  const where: any = {
    artist: { isNot: null },
    externalId: { not: null }
  }

  if (filters?.externalId) {
    where.externalId = filters.externalId
  }

  if (filters?.artistName) {
    where.artist = {
      isNot: null,
      is: {
        name: filters.exactMatch ? filters.artistName : { contains: filters.artistName, mode: 'insensitive' }
      }
    }
  }

  if (filters?.search) {
    if (filters.exactMatch) {
      where.title = filters.search
    } else {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { artist: { is: { name: { contains: filters.search, mode: 'insensitive' } } } }
      ]
    }
  }

  if (filters?.startDate || filters?.endDate) {
    const sourceDate: any = {}
    if (filters.startDate) sourceDate.gte = toUtcDate(filters.startDate)
    if (filters.endDate) sourceDate.lt = addUtcDays(filters.endDate, 1)
    where.sourceDate = sourceDate
  }

  return where
}

const resolveSafetyOptions = (options?: MigrationSafetyOptions) => {
  return {
    transferMode: options?.transferMode ?? 'move',
    verifyAfterCopy: options?.verifyAfterCopy ?? true,
    cleanupSource: options?.cleanupSource ?? true
  }
}

export async function precheckMigration(input: MigrationPrecheckInput): Promise<MigrationPrecheckResult> {
  const parsedFilters = ArtworksInfiniteQuerySchema.parse({
    cursor: 1,
    pageSize: 1,
    search: input.filters?.search ?? undefined,
    artistName: input.filters?.artistName ?? undefined,
    startDate: input.filters?.startDate ?? undefined,
    endDate: input.filters?.endDate ?? undefined,
    externalId: input.filters?.externalId ?? undefined,
    exactMatch: input.filters?.exactMatch ?? undefined
  })

  let { whereSQL, sqlParams, paramIndex } = buildArtworkWhereClause(parsedFilters)

  if (input.targetIds?.length) {
    whereSQL += ` AND a.id = ANY($${paramIndex})`
    sqlParams.push(input.targetIds)
    paramIndex++
  }

  const runCount = async (extraCondition: string) => {
    const query = `
      SELECT COUNT(*) as count
      FROM "Artwork" a
      LEFT JOIN "Artist" artist ON a."artistId" = artist.id
      ${whereSQL}
      ${extraCondition}
    `
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(query, ...sqlParams)
    return Number(result[0]?.count || 0)
  }

  const total = await runCount('')
  const eligible = await runCount(' AND a."artistId" IS NOT NULL AND a."externalId" IS NOT NULL AND a."imageCount" > 0')
  const missingArtist = await runCount(' AND a."artistId" IS NULL')
  const missingExternalId = await runCount(' AND a."externalId" IS NULL')
  const missingImages = await runCount(' AND a."imageCount" <= 0')

  return {
    total,
    eligible,
    missingArtist,
    missingExternalId,
    missingImages
  }
}

/**
 * 迁移单个作品
 */
export async function migrateArtwork(
  artworkId: number,
  scanRoot: string,
  safetyOptions?: MigrationSafetyOptions
): Promise<MigrationResult> {
  const logs: string[] = []
  const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    logs.push(msg)
    if (level === 'error') migrationLogger.error(msg)
    else if (level === 'warn') migrationLogger.warn(msg)
    else migrationLogger.info(msg)
  }

  // 1. 获取数据
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: { images: true, artist: true }
  })

  if (!artwork || !artwork.artist?.userId || !artwork.externalId || !artwork.images.length) {
    return { artworkId, status: 'FAILED', msg: ['数据不完整 (Artist或Images缺失)'] }
  }

  const targetRelDirFs = path.join(artwork.artist.userId, artwork.externalId)
  const targetRelDir = targetRelDirFs.replace(/\\/g, '/')
  const targetAbsDir = path.join(scanRoot, targetRelDirFs)

  // 假设第一张图代表当前位置
  const currentRelPath = artwork.images[0]!.path
  const currentAbsPath = path.join(scanRoot, currentRelPath)
  const sourceAbsDir = path.dirname(currentAbsPath)

  // 2. 幂等性检查：如果已经在目标路径下
  // Windows下路径可能包含反斜杠，统一替换为正斜杠比较
  const normalizedCurrent = currentRelPath.replace(/\\/g, '/').replace(/^\//, '')
  const normalizedTarget = targetRelDir.replace(/\\/g, '/')

  if (normalizedCurrent.startsWith(normalizedTarget)) {
    return { artworkId, status: 'SKIPPED', msg: [`路径已符合规范: ${currentRelPath}`] }
  }

  let rolledBack = false
  const moves: { src: string; dest: string }[] = []
  const copies: { src: string; dest: string }[] = []
  const safety = resolveSafetyOptions(safetyOptions)
  const rollbackMoves = async () => {
    if (moves.length === 0) return
    for (let i = moves.length - 1; i >= 0; i--) {
      const move = moves[i]!
      try {
        await fs.rename(move.dest, move.src)
      } catch (e: any) {
        log(`回滚失败: ${move.dest} -> ${move.src} (${e.message})`, 'error')
      }
    }
    rolledBack = true
  }
  const rollbackCopies = async () => {
    if (copies.length === 0) return
    for (let i = copies.length - 1; i >= 0; i--) {
      const copy = copies[i]!
      try {
        await fs.unlink(copy.dest)
      } catch (e: any) {
        log(`清理拷贝失败: ${copy.dest} (${e.message})`, 'error')
      }
    }
  }

  try {
    try {
      await fs.access(sourceAbsDir)
    } catch {
      try {
        await fs.access(targetAbsDir)
        const targetFiles = await fs.readdir(targetAbsDir)
        if (targetFiles.length > 0) {
          const expectedFiles = artwork.images.map((img) => path.basename(img.path))
          const targetFileSet = new Set(targetFiles)
          const allMatched = expectedFiles.every((file) => targetFileSet.has(file))
          if (allMatched) {
            await prisma.$transaction(async (tx) => {
              for (const img of artwork.images) {
                const fileName = path.basename(img.path)
                const newPath = path.posix.join(targetRelDir, fileName)
                await tx.image.update({
                  where: { id: img.id },
                  data: { path: '/' + newPath }
                })
              }
            })
            logs.push(`已修复路径至 ${targetRelDir}`)
            return { artworkId, status: 'SUCCESS', msg: logs }
          }
          return { artworkId, status: 'FAILED', msg: ['源目录不存在，目标目录已有文件'] }
        }
      } catch {}
      return { artworkId, status: 'FAILED', msg: ['源目录不存在'] }
    }

    const sourceFiles = await fs.readdir(sourceAbsDir)
    const relatedFiles = sourceFiles.filter((f) => f.startsWith(artwork.externalId!))

    if (relatedFiles.length === 0) {
      return { artworkId, status: 'FAILED', msg: ['源目录中未找到相关文件'] }
    }

    await fs.mkdir(targetAbsDir, { recursive: true })

    for (const file of relatedFiles) {
      const src = path.join(sourceAbsDir, file)
      const dest = path.join(targetAbsDir, file)

      if (src !== dest) {
        try {
          if (safety.transferMode === 'copy') {
            await fs.copyFile(src, dest, fsConstants.COPYFILE_EXCL)
            copies.push({ src, dest })
          } else {
            await fs.rename(src, dest)
            moves.push({ src, dest })
          }
        } catch (e: any) {
          if (e.code === 'EEXIST' && safety.transferMode === 'copy') {
            continue
          }
          throw e
        }
      }
    }

    if (safety.transferMode === 'copy' && safety.verifyAfterCopy) {
      for (const file of relatedFiles) {
        const src = path.join(sourceAbsDir, file)
        const dest = path.join(targetAbsDir, file)
        if (src === dest) continue
        const [srcStat, destStat] = await Promise.all([fs.stat(src), fs.stat(dest)])
        if (srcStat.size !== destStat.size) {
          throw new Error(`拷贝校验失败: ${file}`)
        }
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        for (const img of artwork.images) {
          const fileName = path.basename(img.path)
          const newPath = path.posix.join(targetRelDir, fileName)
          await tx.image.update({
            where: { id: img.id },
            data: { path: '/' + newPath }
          })
        }
      })
    } catch (e: any) {
      await rollbackMoves()
      log(`[Migrate] 数据库更新失败: ${e.message}`, 'error')
      throw e
    }

    if (safety.cleanupSource) {
      if (safety.transferMode === 'copy') {
        for (const file of relatedFiles) {
          try {
            await fs.unlink(path.join(sourceAbsDir, file))
          } catch (e: any) {
            log(`[Migrate] 清理源文件失败: ${file} (${e.message})`, 'warn')
          }
        }
      }

      if (path.relative(scanRoot, sourceAbsDir) !== '') {
        try {
          const deleteCandidates = new Set(['@eaDir', '.DS_Store'])
          const entries = await fs.readdir(sourceAbsDir)
          for (const entry of entries) {
            if (deleteCandidates.has(entry)) {
              const entryPath = path.join(sourceAbsDir, entry)
              await fs.rm(entryPath, { recursive: true, force: true })
            }
          }

          const remaining = await fs.readdir(sourceAbsDir)
          if (remaining.length === 0) {
            await fs.rmdir(sourceAbsDir)
            log(`[Migrate] 已移除空目录: ${sourceAbsDir}`, 'info')
          } else {
            log(
              `[Migrate] 源目录非空，跳过删除: ${sourceAbsDir} (剩余 ${remaining.length} 个文件: ${remaining.slice(0, 3).join(', ')}...)`,
              'info'
            )
          }
        } catch (e: any) {
          log(`[Migrate] 尝试删除源目录失败: ${sourceAbsDir}, Error: ${e.message}`, 'warn')
        }
      } else {
        log(`[Migrate] 源目录为根目录，跳过删除: ${sourceAbsDir} （防止删除根目录） ${scanRoot}`, 'info')
      }
    }

    logs.push(`迁移至 ${targetRelDir}`)
    return { artworkId, status: 'SUCCESS', msg: logs }
  } catch (error: any) {
    if (moves.length > 0 && !rolledBack) {
      await rollbackMoves()
    }
    if (copies.length > 0) {
      await rollbackCopies()
    }
    log(`[Migrate] ID:${artworkId} Failed: ${error.message}`, 'error')
    return { artworkId, status: 'FAILED', msg: logs } // Return collected logs even on failure
  }
}

/**
 * 运行迁移任务
 */
export async function runMigrationJob(
  onProgress: (stats: MigrationStats, currentMsg: string[]) => void,
  checkCancelled: () => Promise<boolean>,
  checkPaused: () => Promise<boolean>,
  onStateChange: (state: 'PAUSED' | 'RUNNING') => void,
  options?: MigrationRunOptions
): Promise<MigrationJobResult> {
  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('SCAN_PATH 未配置')
  }

  const batchSize = Math.max(1, options?.batchSize ?? 200)
  const concurrency = Math.max(1, options?.concurrency ?? 3)

  const stats: MigrationStats = {
    total: 0,
    processed: 0,
    success: 0,
    skipped: 0,
    failed: 0
  }

  const failedItems: MigrationFailedItem[] = []
  const where: any = buildMigrationWhere(options?.filters)

  let cancelled = false
  let paused = false
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const ensureNotCancelled = async () => {
    if (cancelled) {
      throw new Error('Migration cancelled')
    }
    if (await checkCancelled()) {
      cancelled = true
      migrationLogger.info('迁移任务被取消')
      throw new Error('Migration cancelled')
    }
  }

  const ensureRunning = async () => {
    while (await checkPaused()) {
      if (!paused) {
        paused = true
        onStateChange('PAUSED')
      }
      await ensureNotCancelled()
      await sleep(800)
    }
    if (paused) {
      paused = false
      onStateChange('RUNNING')
    }
  }

  if (options?.targetIds?.length) {
    stats.total = await prisma.artwork.count({
      where: {
        ...where,
        id: { in: options.targetIds }
      }
    })
  } else {
    stats.total = await prisma.artwork.count({ where })
  }

  migrationLogger.info(
    `开始迁移任务，共 ${stats.total} 个作品${options?.targetIds ? ` (指定ID: ${options.targetIds.join(',')})` : ''}`
  )

  const handleResult = (art: { id: number; externalId: string | null }, result: MigrationResult) => {
    stats.processed++
    if (result.status === 'SUCCESS') stats.success++
    else if (result.status === 'SKIPPED') stats.skipped++
    else {
      stats.failed++
      failedItems.push({ artworkId: art.id, externalId: art.externalId, msg: result.msg })
    }

    if (result.status === 'FAILED') {
      migrationLogger.warn(`[ID:${art.id}] ${result.msg.join('; ')}`)
    } else if (result.status === 'SUCCESS') {
      migrationLogger.info(`[ID:${art.id}] ${result.msg.join('; ')}`)
    }

    onProgress(
      stats,
      result.msg.map((m) => `[${art.externalId}] ${m}`)
    )
  }

  const runBatch = async (artworks: { id: number; externalId: string | null }[]) => {
    if (artworks.length === 0) return
    let index = 0
    const worker = async () => {
      while (true) {
        if (cancelled) return
        const currentIndex = index++
        if (currentIndex >= artworks.length) return
        await ensureNotCancelled()
        await ensureRunning()
        const art = artworks[currentIndex]!
        const result = await migrateArtwork(art.id, scanPath, options?.safety)
        handleResult(art, result)
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, artworks.length) }, () => worker())
    await Promise.all(workers)
  }

  if (options?.targetIds?.length) {
    const sortedIds = [...options.targetIds].sort((a, b) => a - b)
    for (let i = 0; i < sortedIds.length; i += batchSize) {
      await ensureNotCancelled()
      await ensureRunning()
      const idBatch = sortedIds.slice(i, i + batchSize)
      const artworks = await prisma.artwork.findMany({
        select: { id: true, externalId: true },
        where: {
          ...where,
          id: { in: idBatch }
        },
        orderBy: { id: 'asc' }
      })
      await runBatch(artworks)
    }
  } else {
    let lastId = options?.startAfterId ?? 0
    while (true) {
      await ensureNotCancelled()
      await ensureRunning()
      const artworks = await prisma.artwork.findMany({
        select: { id: true, externalId: true },
        where: {
          ...where,
          id: { gt: lastId }
        },
        orderBy: { id: 'asc' },
        take: batchSize
      })
      if (artworks.length === 0) break
      await runBatch(artworks)
      lastId = artworks[artworks.length - 1]!.id
    }
  }

  return { ...stats, failedItems }
}
