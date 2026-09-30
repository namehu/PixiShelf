import path from 'path'
import fs from 'fs/promises'
import { constants as fsConstants, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { migrationLogger } from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import {
  migrationFilterSchema,
  migrationSelectionSchema,
  resolveCanonicalArtworkStoragePath,
  type MigrationSelection
} from '@pixishelf/job-contracts'
import { buildMigrationArtworkWhere, createPrismaMigrationSelectionPort } from '@pixishelf/job-executors'
import { lockArtworkForReading, lockCreatorCatalog } from '@pixishelf/db'
import { generateLocalStorageKey } from './artwork-service/utils'
import { resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '@/lib/safe-path'

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
  id?: number | null
  search?: string | null
  artistName?: string | null
  startDate?: string | null
  endDate?: string | null
  externalId?: string | null
  mediaTypes?: string | null
  exactMatch?: boolean
}

export interface MigrationPrecheckInput {
  targetIds?: number[]
  filters?: MigrationFilters
  selection?: MigrationSelection
}

export interface MigrationPrecheckResult {
  total: number
  eligible: number
  missingArtist: number
  missingExternalId: number
  missingImages: number
}

const resolveSafetyOptions = (options?: MigrationSafetyOptions) => {
  return {
    transferMode: options?.transferMode ?? 'move',
    verifyAfterCopy: options?.verifyAfterCopy ?? true,
    cleanupSource: options?.cleanupSource ?? true
  }
}

function normalizeMigrationStoredPath(storedPath: string): string {
  if (/^(?:[/\\]){2}/.test(storedPath)) throw new Error('持久路径不能是 UNC 或网络绝对路径')
  const normalized = storedPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || /^[A-Za-z]:/.test(normalized)) throw new Error('持久路径必须位于媒体根目录内')
  const segments = normalized.split('/')
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[<>:"|?*]/.test(segment) ||
        [...segment].some((character) => character.charCodeAt(0) <= 0x1f)
    )
  ) {
    throw new Error('持久路径包含不安全的目录段')
  }
  return segments.join('/')
}

async function hashMigrationFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertExclusiveMigrationPathOwnership(
  tx: Prisma.TransactionClient,
  artworkId: number,
  storedPaths: string[],
  label: '源路径' | '目标路径'
): Promise<void> {
  const canonicalPaths = [
    ...new Set(
      storedPaths.map((storedPath) =>
        normalizeMigrationStoredPath(storedPath).normalize('NFC').toLocaleLowerCase('en-US')
      )
    )
  ]
  if (canonicalPaths.length === 0) return
  const rows = await tx.$queryRaw<Array<{ ownedByOther: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM "Image" AS image
      WHERE image."artworkId" <> ${artworkId}
        AND (
          LOWER(NORMALIZE(REGEXP_REPLACE(REPLACE(image.path, CHR(92), '/'), '^/+', ''), NFC))
            IN (${Prisma.join(canonicalPaths)})
          OR LOWER(NORMALIZE(REGEXP_REPLACE(REPLACE(image."chaptersPath", CHR(92), '/'), '^/+', ''), NFC))
            IN (${Prisma.join(canonicalPaths)})
        )
      UNION ALL
      SELECT 1
      FROM "Artwork" AS other_artwork
      WHERE other_artwork.id <> ${artworkId}
        AND (
          LOWER(NORMALIZE(REGEXP_REPLACE(REPLACE(other_artwork."metaSource", CHR(92), '/'), '^/+', ''), NFC))
            IN (${Prisma.join(canonicalPaths)})
          OR LOWER(NORMALIZE(REGEXP_REPLACE(REPLACE(other_artwork."storagePath", CHR(92), '/'), '^/+', ''), NFC))
            IN (${Prisma.join(canonicalPaths)})
        )
    ) AS "ownedByOther"
  `)
  if (rows[0]?.ownedByOther) throw new Error(`${label}已被其他作品引用`)
}

async function resolveMigrationArtist(
  tx: Prisma.TransactionClient,
  artistId: number
): Promise<{ id: number; externalRefs: Array<{ externalId: string }> }> {
  const source = await tx.artist.findUniqueOrThrow({
    where: { id: artistId },
    select: {
      mergedIntoId: true,
      externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
    }
  })
  if (source.mergedIntoId === null) return { id: artistId, externalRefs: source.externalRefs }
  const target = await tx.artist.findUniqueOrThrow({
    where: { id: source.mergedIntoId },
    select: {
      mergedIntoId: true,
      externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
    }
  })
  if (target.mergedIntoId !== null) {
    throw new Error('艺术家合并关系异常，请先完成维护再迁移')
  }
  return { id: source.mergedIntoId, externalRefs: target.externalRefs }
}

export async function precheckMigration(input: MigrationPrecheckInput): Promise<MigrationPrecheckResult> {
  const selection = input.selection ?? (await buildMigrationSelection(input))
  const selectionPort = createPrismaMigrationSelectionPort(
    prisma as unknown as Parameters<typeof createPrismaMigrationSelectionPort>[0]
  )
  return selectionPort.precheck(migrationSelectionSchema.parse(selection))
}

export async function buildMigrationSelection(input: MigrationPrecheckInput): Promise<MigrationSelection> {
  if (input.targetIds?.length) {
    return migrationSelectionSchema.parse({ mode: 'ARTWORK_IDS', artworkIds: input.targetIds })
  }
  const upper = await prisma.artwork.aggregate({ _max: { id: true } })
  return migrationSelectionSchema.parse({
    mode: 'QUERY',
    filters: canonicalMigrationFilters(input.filters),
    upperArtworkId: upper._max.id ?? 0
  })
}

function canonicalMigrationFilters(filters?: MigrationFilters) {
  return migrationFilterSchema.parse({
    ...(filters?.id != null ? { id: filters.id } : {}),
    ...(filters?.search ? { search: filters.search } : {}),
    ...(filters?.artistName ? { artistName: filters.artistName } : {}),
    ...(filters?.startDate ? { startDate: filters.startDate } : {}),
    ...(filters?.endDate ? { endDate: filters.endDate } : {}),
    ...(filters?.externalId ? { externalId: filters.externalId } : {}),
    mediaTypes: ArtworksInfiniteQuerySchema.shape.mediaTypes.parse(filters?.mediaTypes),
    exactMatch: filters?.exactMatch ?? false
  })
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
  const artwork = await prisma.$transaction(async (tx) => {
    const current = await tx.artwork.findUnique({
      where: { id: artworkId },
      include: {
        images: true,
        externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } },
        artist: {
          select: {
            id: true,
            externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
          }
        }
      }
    })
    if (!current) return current
    if (!current.artistId) return { ...current, originalArtistId: current.artistId }
    const transaction = tx as unknown as Prisma.TransactionClient
    await lockCreatorCatalog(transaction)
    const targetArtist = await resolveMigrationArtist(transaction, current.artistId)
    if (current.createdVia !== 'LOCAL_DIRECTORY' && current.createdVia !== 'MANUAL_CREATE') {
      return { ...current, originalArtistId: current.artistId, artistId: targetArtist.id, artist: targetArtist }
    }
    const targetArtistId = targetArtist.id
    const artistDirectory = `artist-${targetArtistId}`
    const mapping = await tx.localImportArtistMapping.findUnique({
      where: { artistDirectory },
      select: { artistId: true }
    })
    if (mapping && mapping.artistId !== targetArtistId) {
      throw new Error(`本地导入目录 ${artistDirectory} 已绑定到其他艺术家`)
    }
    if (!mapping) {
      await tx.localImportArtistMapping.create({ data: { artistDirectory, artistId: targetArtistId } })
    }
    if (current.storageKey) {
      return {
        ...current,
        originalArtistId: current.artistId,
        artistId: targetArtistId,
        artist: targetArtist
      }
    }
    const storageKey = generateLocalStorageKey(current.id)
    await tx.artwork.update({ where: { id: current.id }, data: { storageKey } })
    return {
      ...current,
      originalArtistId: current.artistId,
      artistId: targetArtistId,
      artist: targetArtist,
      storageKey
    }
  })

  if (!artwork || !artwork.images.length) {
    return { artworkId, status: 'FAILED', msg: ['数据不完整 (Artist或Images缺失)'] }
  }
  const artistPixivRefs = artwork.artist?.externalRefs ?? []
  const artworkPixivRefs = artwork.externalRefs
  const targetRelDir = resolveCanonicalArtworkStoragePath({
    createdVia: artwork.createdVia,
    artistId: artwork.artistId,
    artistPixivExternalId: artistPixivRefs.length === 1 ? artistPixivRefs[0]!.externalId : null,
    artworkPixivExternalId: artworkPixivRefs.length === 1 ? artworkPixivRefs[0]!.externalId : null,
    storageKey: artwork.storageKey
  })
  if (!targetRelDir) return { artworkId, status: 'FAILED', msg: ['缺少可确认的来源身份或本地存储键'] }
  const targetAbsDir = path.join(scanRoot, targetRelDir)

  const mediaDirectories = new Set(
    artwork.images.map((image) => path.posix.dirname(image.path.replace(/\\/g, '/').replace(/^\/+/, '')))
  )
  if (mediaDirectories.size !== 1) {
    return { artworkId, status: 'FAILED', msg: ['作品媒体不在同一目录，无法安全迁移'] }
  }
  const targetStoredPath = (current: string) => {
    const target = path.posix.join(targetRelDir, path.posix.basename(current.replace(/\\/g, '/')))
    return current.startsWith('/') || current.startsWith('\\') ? `/${target}` : target
  }
  const persistedPaths = [
    ...artwork.images.flatMap((image) => [image.path, ...(image.chaptersPath ? [image.chaptersPath] : [])]),
    ...(artwork.metaSource ? [artwork.metaSource] : [])
  ]
  const transitions = new Map<string, { sourceStoredPath: string; sourceRelativePath: string; targetStoredPath: string }>()
  const targetOwners = new Map<string, string>()
  for (const sourceStoredPath of persistedPaths) {
    let sourceRelativePath: string
    try {
      sourceRelativePath = normalizeMigrationStoredPath(sourceStoredPath)
    } catch (error) {
      return {
        artworkId,
        status: 'FAILED',
        msg: [error instanceof Error ? error.message : '持久路径无效']
      }
    }
    const nextStoredPath = targetStoredPath(sourceStoredPath)
    const targetRelativePath = nextStoredPath.replace(/^\/+/, '')
    const existingSource = targetOwners.get(targetRelativePath.toLocaleLowerCase('en-US'))
    if (existingSource && existingSource !== sourceRelativePath.toLocaleLowerCase('en-US')) {
      return { artworkId, status: 'FAILED', msg: ['多个持久文件会迁移到同一目标路径'] }
    }
    targetOwners.set(targetRelativePath.toLocaleLowerCase('en-US'), sourceRelativePath.toLocaleLowerCase('en-US'))
    transitions.set(sourceRelativePath.toLocaleLowerCase('en-US'), {
      sourceStoredPath,
      sourceRelativePath,
      targetStoredPath: nextStoredPath
    })
  }
  const fileTransitions = [...transitions.values()]
  const sourceOwnershipPaths = [
    ...fileTransitions.map((file) => file.sourceStoredPath),
    ...(artwork.storagePath ? [artwork.storagePath] : [])
  ]
  const targetOwnershipPaths = [...fileTransitions.map((file) => file.targetStoredPath), targetRelDir]
  const assertExclusivePathOwnership = async (tx: Prisma.TransactionClient) => {
    await assertExclusiveMigrationPathOwnership(tx, artworkId, sourceOwnershipPaths, '源路径')
    await assertExclusiveMigrationPathOwnership(tx, artworkId, targetOwnershipPaths, '目标路径')
  }
  try {
    await prisma.$transaction(async (tx) => {
      await assertExclusivePathOwnership(tx as unknown as Prisma.TransactionClient)
    })
  } catch (error) {
    return {
      artworkId,
      status: 'FAILED',
      msg: [error instanceof Error ? error.message : '迁移路径所有权检查失败']
    }
  }
  const persistReferences = async () => {
    await prisma.$transaction(async (tx) => {
      const transaction = tx as unknown as Prisma.TransactionClient
      await lockCreatorCatalog(transaction)
      if (!(await lockArtworkForReading(transaction, artworkId))) {
        throw new Error('作品在迁移发布前已不存在')
      }
      await assertExclusivePathOwnership(transaction)
      const current = await tx.artwork.findUnique({
        where: { id: artworkId },
        select: {
          id: true,
          deletedAt: true,
          createdVia: true,
          artistId: true,
          storageKey: true,
          metaSource: true,
          storagePath: true,
          externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } },
          images: { select: { id: true, path: true, chaptersPath: true }, orderBy: { id: 'asc' } }
        }
      })
      if (
        !current ||
        current.deletedAt !== null ||
        current.artistId === null ||
        current.artistId !== artwork.originalArtistId ||
        current.createdVia !== artwork.createdVia ||
        current.storageKey !== artwork.storageKey ||
        current.metaSource !== artwork.metaSource ||
        current.storagePath !== artwork.storagePath
      ) {
        throw new Error('作品身份或持久路径在迁移期间发生变化')
      }
      const activeArtist = await resolveMigrationArtist(transaction, current.artistId)
      const currentTarget = resolveCanonicalArtworkStoragePath({
        createdVia: current.createdVia,
        artistId: activeArtist.id,
        artistPixivExternalId:
          activeArtist.externalRefs.length === 1 ? activeArtist.externalRefs[0]!.externalId : null,
        artworkPixivExternalId:
          current.externalRefs.length === 1 ? current.externalRefs[0]!.externalId : null,
        storageKey: current.storageKey
      })
      if (currentTarget !== targetRelDir) throw new Error('作品来源身份在迁移期间发生变化')
      if (current.createdVia === 'LOCAL_DIRECTORY' || current.createdVia === 'MANUAL_CREATE') {
        const mapping = await tx.localImportArtistMapping.findUnique({
          where: { artistDirectory: `artist-${activeArtist.id}` },
          select: { artistId: true }
        })
        if (mapping?.artistId !== activeArtist.id) throw new Error('本地艺术家目录绑定在迁移期间发生变化')
      }
      const expectedImages = [...artwork.images].sort((left, right) => left.id - right.id)
      if (
        current.images.length !== expectedImages.length ||
        current.images.some(
          (image, index) =>
            image.id !== expectedImages[index]!.id ||
            image.path !== expectedImages[index]!.path ||
            image.chaptersPath !== expectedImages[index]!.chaptersPath
        )
      ) {
        throw new Error('作品媒体引用在迁移期间发生变化')
      }
      for (const image of artwork.images) {
        const updated = await tx.image.updateMany({
          where: {
            id: image.id,
            artworkId,
            path: image.path,
            chaptersPath: image.chaptersPath
          },
          data: {
            path: targetStoredPath(image.path),
            chaptersPath: image.chaptersPath ? targetStoredPath(image.chaptersPath) : null
          }
        })
        if (updated.count !== 1) throw new Error('作品媒体引用在迁移发布时发生变化')
      }
      const updated = await tx.artwork.updateMany({
        where: {
          id: artworkId,
          deletedAt: null,
          createdVia: artwork.createdVia,
          artistId: artwork.originalArtistId,
          storageKey: artwork.storageKey,
          metaSource: artwork.metaSource,
          storagePath: artwork.storagePath
        },
        data: {
          metaSource: artwork.metaSource ? targetStoredPath(artwork.metaSource) : null,
          storagePath: targetRelDir
        }
      })
      if (updated.count !== 1) throw new Error('作品持久路径在迁移发布时发生变化')
    })
  }

  // 2. 幂等性检查：如果已经在目标路径下
  // Windows 下路径可能包含反斜杠，统一替换为正斜杠后比较。
  if (fileTransitions.every((file) => file.sourceRelativePath === file.targetStoredPath.replace(/^\/+/, ''))) {
    await persistReferences()
    return { artworkId, status: 'SKIPPED', msg: [`路径已符合规范: ${artwork.images[0]!.path}`] }
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
        const sourceWasRecreated = await fs.access(move.src).then(
          () => true,
          () => false
        )
        if (sourceWasRecreated) {
          log(`回滚失败: 源路径已被重新占用 ${move.src}`, 'error')
          continue
        }
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
    const copySourcesToCleanup: string[] = []
    for (const file of fileTransitions) {
      const src = await resolveExistingPathWithinRoot(scanRoot, file.sourceRelativePath).catch(() => {
        throw new Error(`持久文件不存在或路径不安全: ${file.sourceStoredPath}`)
      })
      const dest = await resolveCreatablePathWithinRoot(scanRoot, file.targetStoredPath.replace(/^\/+/, '')).catch(
        () => {
          throw new Error(`目标路径不安全: ${file.targetStoredPath}`)
        }
      )
      if (src !== dest) {
        const targetExists = await fs.access(dest).then(
          () => true,
          () => false
        )
        if (targetExists) throw new Error(`目标文件已存在: ${file.targetStoredPath}`)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        let createdDestination = false
        try {
          await fs.copyFile(src, dest, fsConstants.COPYFILE_EXCL)
          createdDestination = true
          const shouldVerify = safety.transferMode === 'move' || safety.verifyAfterCopy || safety.cleanupSource
          if (shouldVerify) {
            const [srcStat, destStat, srcHash, destHash] = await Promise.all([
              fs.stat(src),
              fs.stat(dest),
              hashMigrationFile(src),
              hashMigrationFile(dest)
            ])
            if (srcStat.size !== destStat.size || srcHash !== destHash) {
              throw new Error(`拷贝校验失败: ${path.basename(src)}`)
            }
          }
          if (safety.transferMode === 'copy') {
            copies.push({ src, dest })
            copySourcesToCleanup.push(src)
          } else {
            await fs.unlink(src)
            moves.push({ src, dest })
          }
        } catch (e: any) {
          if (createdDestination) await fs.unlink(dest).catch(() => undefined)
          throw e
        }
      }
    }

    try {
      await persistReferences()
    } catch (e: any) {
      await rollbackMoves()
      log(`[Migrate] 数据库更新失败: ${e.message}`, 'error')
      throw e
    }

    if (safety.cleanupSource) {
      if (safety.transferMode === 'copy') {
        for (const source of copySourcesToCleanup) {
          try {
            await fs.unlink(source)
          } catch (e: any) {
            log(`[Migrate] 清理源文件失败: ${source} (${e.message})`, 'warn')
          }
        }
      }

      const sourceDirectories = new Set(
        fileTransitions.map((file) => path.dirname(path.join(scanRoot, file.sourceRelativePath)))
      )
      for (const sourceAbsDir of sourceDirectories) {
        if (path.relative(scanRoot, sourceAbsDir) === '' || path.resolve(sourceAbsDir) === path.resolve(targetAbsDir)) {
          if (path.relative(scanRoot, sourceAbsDir) === '') {
            log(`[Migrate] 源目录为根目录，跳过删除: ${sourceAbsDir} （防止删除根目录） ${scanRoot}`, 'info')
          }
          continue
        }
        try {
          const deleteCandidates = new Set(['@eaDir', '.DS_Store', 'Thumbs.db'])
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
    return { artworkId, status: 'FAILED', msg: logs } // 即使失败也返回已收集的日志
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
  const upper = await prisma.artwork.aggregate({ _max: { id: true } })
  const canonicalWhere = buildMigrationArtworkWhere(
    {
      mode: 'QUERY',
      filters: canonicalMigrationFilters(options?.filters),
      upperArtworkId: upper._max.id ?? 0
    },
    0
  )
  const where: Prisma.ArtworkWhereInput = {
    AND: [
      canonicalWhere,
      {
        images: { some: {} },
        OR: [
          {
            createdVia: 'PIXIV_SCAN',
            artist: { is: { externalRefs: { some: { providerKey: 'pixiv' } } } },
            externalRefs: { some: { providerKey: 'pixiv' } }
          },
          { createdVia: { in: ['LOCAL_DIRECTORY', 'MANUAL_CREATE'] }, artistId: { not: null } }
        ]
      }
    ]
  }

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
      const batchWhere =
        typeof where.id === 'number'
          ? where
          : {
              ...where,
              id: { gt: lastId }
            }
      const artworks = await prisma.artwork.findMany({
        select: { id: true, externalId: true },
        where: batchWhere,
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
