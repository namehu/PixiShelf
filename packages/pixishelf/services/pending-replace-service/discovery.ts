import 'server-only'

import { createHash } from 'crypto'
import type { Dirent } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { PendingReplaceItemStatus, Prisma } from '@prisma/client'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { inferMediaTypeFromPath } from '@/lib/media-type'
import { prisma } from '@/lib/prisma'
import { resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '@/lib/safe-path'
import {
  PENDING_REPLACE_DIRECTORY,
  PENDING_REPLACE_MANIFEST_FILE,
  type PendingReplaceManifestFile,
  type PendingReplaceMediaSnapshot,
  type PendingReplaceTargetFileSnapshot,
  pendingReplaceExternalIdSchema,
  parsePendingReplaceDirectoryName
} from '@/schemas/pending-replace.dto'
import { determineArtworkRelDir } from '@/services/artwork-service/utils'
import { compareFileNamesNaturally } from '@/utils/artwork/natural-file-name-order'
import { getChapterPathCandidates, resolveCanonicalChapterPath } from '@/services/artwork-service/video-chapters'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { createFileSha256 } from './executor-file-utils'

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)
const supportedVideoExtensions = new Set(VIDEO_EXTENSIONS)
const METADATA_CONCURRENCY = 8

interface DiscoveredDirectory {
  directoryName: string
  sourceDirectory: string
  parsed: ReturnType<typeof parsePendingReplaceDirectoryName>
  isSymbolicLink: boolean
}

interface ArtworkForPendingReplace {
  id: number
  externalId: string | null
  storageKey: string | null
  title: string
  storagePath: string | null
  artist: { name: string; userId: string | null } | null
  images: Array<{
    path: string
    sortOrder: number
    width: number | null
    height: number | null
    size: bigint | null
    mediaType: string
    chaptersPath: string | null
  }>
}

export async function previewPendingReplacements(scanPath: string) {
  const pendingRoot = path.resolve(scanPath, PENDING_REPLACE_DIRECTORY)
  await fs.mkdir(pendingRoot, { recursive: true })

  const rootEntries = await fs.readdir(pendingRoot, { withFileTypes: true })
  const directories: DiscoveredDirectory[] = rootEntries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
    .sort((a, b) => compareFileNamesNaturally(a.name, b.name))
    .map((entry) => ({
      directoryName: entry.name,
      sourceDirectory: toStoredPath(path.posix.join(PENDING_REPLACE_DIRECTORY, entry.name)),
      parsed: parsePendingReplaceDirectoryName(entry.name),
      isSymbolicLink: entry.isSymbolicLink()
    }))

  const requestedExternalIds = Array.from(
    new Set(directories.flatMap((entry) => (entry.parsed?.externalId ? [entry.parsed.externalId] : [])))
  )
  const artworks = (await prisma.artwork.findMany({
    where: {
      OR: [{ externalId: { in: requestedExternalIds } }, { storageKey: { in: requestedExternalIds } }]
    },
    select: {
      id: true,
      externalId: true,
      storageKey: true,
      title: true,
      storagePath: true,
      artist: { select: { name: true, userId: true } },
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          path: true,
          sortOrder: true,
          width: true,
          height: true,
          size: true,
          mediaType: true,
          chaptersPath: true
        }
      }
    }
  })) as ArtworkForPendingReplace[]
  const artworkByExternalId = new Map(
    artworks.flatMap((artwork) => {
      const identity = artwork.storageKey ?? artwork.externalId
      return identity ? [[identity, artwork] as const] : []
    })
  )
  const externalIdCounts = new Map<string, number>()
  for (const directory of directories) {
    if (!directory.parsed) continue
    externalIdCounts.set(directory.parsed.externalId, (externalIdCounts.get(directory.parsed.externalId) ?? 0) + 1)
  }

  const items = []
  for (const directory of directories) {
    const sourceErrors: string[] = []
    const bindingErrors: string[] = []
    const warnings: string[] = []
    const duplicateExternalId = Boolean(
      directory.parsed && (externalIdCounts.get(directory.parsed.externalId) ?? 0) > 1
    )
    const artwork =
      directory.parsed && !duplicateExternalId
        ? artworkByExternalId.get(directory.parsed.externalId)
        : undefined

    if (directory.isSymbolicLink) sourceErrors.push('符号链接目录不允许用于批量替换')
    if (!directory.parsed) bindingErrors.push('尚未绑定作品，请在快速配对区选择目标作品')
    if (directory.parsed && isUnsafeExternalId(directory.parsed.externalId)) {
      bindingErrors.push('externalId 包含不安全的文件名字符')
    }
    if (duplicateExternalId) {
      bindingErrors.push('同一 externalId 出现多个待替换目录，请分别手动绑定')
    }
    if (directory.parsed && !duplicateExternalId && !artwork) {
      bindingErrors.push('未找到 externalId 对应的作品，请手动绑定')
    }

    let manifest: PendingReplaceManifestFile[] = []
    let newMediaSnapshot: PendingReplaceMediaSnapshot[] = []
    if (sourceErrors.length === 0) {
      try {
        const result = await scanPendingReplaceDirectory({
          scanPath,
          pendingRoot,
          sourceDirectoryName: directory.directoryName,
          externalId: directory.parsed?.externalId ?? 'pending'
        })
        manifest = result.manifest
        newMediaSnapshot = result.media
        warnings.push(...result.warnings)
        if (result.media.length === 0) sourceErrors.push('目录中没有可替换的直属媒体文件')
      } catch (error) {
        sourceErrors.push(error instanceof Error ? error.message : '目录扫描失败')
      }
    }

    const targetDirectory = artwork ? determineArtworkRelDir(artwork) : null
    if (artwork && !targetDirectory) bindingErrors.push('无法确定作品目标目录')
    let oldMediaSnapshot: PendingReplaceMediaSnapshot[] = []
    let targetFileSnapshot: PendingReplaceTargetFileSnapshot[] = []
    if (artwork) {
      try {
        oldMediaSnapshot = await buildOldMediaSnapshot(scanPath, artwork)
        if (targetDirectory) targetFileSnapshot = await buildTargetFileSnapshot(scanPath, targetDirectory)
      } catch (error) {
        bindingErrors.push(`读取现有媒体快照失败: ${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
    const errors = [...sourceErrors, ...bindingErrors]

    items.push({
      artworkId: artwork?.id ?? null,
      externalId: directory.parsed?.externalId ?? null,
      artworkTitle: artwork?.title ?? null,
      artistName: artwork?.artist?.name ?? null,
      sourceDirectory: directory.sourceDirectory,
      sourceDirectoryName: directory.directoryName,
      targetDirectory,
      status: errors.length > 0 ? PendingReplaceItemStatus.INVALID : PendingReplaceItemStatus.READY,
      included: errors.length === 0,
      fingerprint: manifest.length > 0 ? createManifestFingerprint(manifest) : null,
      sourceManifest: manifest as unknown as Prisma.InputJsonValue,
      oldMediaSnapshot: oldMediaSnapshot as unknown as Prisma.InputJsonValue,
      newMediaSnapshot: newMediaSnapshot as unknown as Prisma.InputJsonValue,
      targetFileSnapshot: targetFileSnapshot as unknown as Prisma.InputJsonValue,
      warnings: warnings as unknown as Prisma.InputJsonValue,
      error: errors.length > 0 ? errors.join('\n') : null
    })
  }

  const readyItems = items.filter((item) => item.status === PendingReplaceItemStatus.READY).length
  return prisma.pendingReplaceBatch.create({
    data: {
      sourceRoot: toStoredPath(PENDING_REPLACE_DIRECTORY),
      totalItems: items.length,
      readyItems,
      invalidItems: items.length - readyItems,
      items: { create: items }
    },
    include: { items: { orderBy: { sourceDirectoryName: 'asc' } }, systemJob: true }
  })
}

export async function preparePendingReplaceBinding(input: {
  scanPath: string
  sourceDirectoryName: string
  artworkId: number
}) {
  const artwork = (await prisma.artwork.findUnique({
    where: { id: input.artworkId },
    select: {
      id: true,
      externalId: true,
      storageKey: true,
      title: true,
      storagePath: true,
      artist: { select: { name: true, userId: true } },
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          path: true,
          sortOrder: true,
          width: true,
          height: true,
          size: true,
          mediaType: true,
          chaptersPath: true
        }
      }
    }
  })) as ArtworkForPendingReplace | null
  if (!artwork) throw new Error('未找到待绑定作品')
  const externalId = pendingReplaceExternalIdSchema.parse(artwork.storageKey ?? artwork.externalId)
  const targetDirectory = determineArtworkRelDir(artwork)
  if (!targetDirectory) throw new Error('无法确定作品目标目录')

  const pendingRoot = path.resolve(input.scanPath, PENDING_REPLACE_DIRECTORY)
  const scanned = await scanPendingReplaceDirectory({
    scanPath: input.scanPath,
    pendingRoot,
    sourceDirectoryName: input.sourceDirectoryName,
    externalId
  })
  if (scanned.media.length === 0) throw new Error('目录中没有可替换的直属媒体文件')

  const [oldMediaSnapshot, targetFileSnapshot] = await Promise.all([
    buildOldMediaSnapshot(input.scanPath, artwork),
    buildTargetFileSnapshot(input.scanPath, targetDirectory)
  ])
  return {
    artworkId: artwork.id,
    externalId,
    artworkTitle: artwork.title,
    artistName: artwork.artist?.name ?? null,
    targetDirectory,
    fingerprint: createManifestFingerprint(scanned.manifest),
    sourceManifest: scanned.manifest,
    oldMediaSnapshot,
    newMediaSnapshot: scanned.media,
    targetFileSnapshot,
    warnings: scanned.warnings
  }
}

export async function scanPendingReplaceDirectory(input: {
  scanPath: string
  pendingRoot: string
  sourceDirectoryName: string
  externalId: string
}) {
  const absoluteDirectory = await resolveExistingPathWithinRoot(input.pendingRoot, input.sourceDirectoryName)
  const directoryStats = await fs.lstat(absoluteDirectory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error('待替换资源必须是普通目录，不能使用符号链接')
  }
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })
  const warnings: string[] = []
  const fileEntries: Array<{
    name: string
    size: number
    mtimeMs: number
    sha256: string
    kind: 'media' | 'chapter' | 'ignored'
  }> = []

  for (const entry of entries.sort((a, b) => compareFileNamesNaturally(a.name, b.name))) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.toLowerCase() === PENDING_REPLACE_MANIFEST_FILE) {
      throw new Error(`${PENDING_REPLACE_MANIFEST_FILE} 是系统保留文件名`)
    }
    if (entry.isSymbolicLink()) throw new Error(`不允许符号链接: ${entry.name}`)
    if (entry.isDirectory()) {
      warnings.push(`已忽略子目录: ${entry.name}`)
      continue
    }
    if (!entry.isFile()) continue

    const stats = await fs.stat(path.join(absoluteDirectory, entry.name))
    const extension = path.extname(entry.name).toLowerCase()
    const kind = supportedMediaExtensions.has(extension)
      ? 'media'
      : isChapterManifestFileName(entry.name)
        ? 'chapter'
        : 'ignored'
    if (kind === 'ignored') warnings.push(`已忽略非媒体文件: ${entry.name}`)
    fileEntries.push({
      name: entry.name,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: await createFileSha256(path.join(absoluteDirectory, entry.name)),
      kind
    })
  }

  const mediaEntries = fileEntries
    .filter((entry) => entry.kind === 'media')
    .sort((a, b) => compareFileNamesNaturally(a.name, b.name))
  const media = await concurrentMap(mediaEntries, METADATA_CONCURRENCY, async (entry, order) => {
    const extension = path.extname(entry.name).toLowerCase()
    const targetName = `${input.externalId}_p${order}${extension}`
    let width = 0
    let height = 0
    if (!supportedVideoExtensions.has(extension)) {
      try {
        const metadata = await sharp(path.join(absoluteDirectory, entry.name)).metadata()
        width = metadata.width ?? 0
        height = metadata.height ?? 0
      } catch (error) {
        warnings.push(`读取图片尺寸失败 ${entry.name}: ${error instanceof Error ? error.message : '未知错误'}`)
      }
    }

    return {
      sourceName: entry.name,
      targetName,
      path: toStoredPath(path.posix.join(PENDING_REPLACE_DIRECTORY, input.sourceDirectoryName, entry.name)),
      size: entry.size,
      sha256: entry.sha256,
      width,
      height,
      order,
      mtimeMs: entry.mtimeMs,
      mediaType: inferMediaTypeFromPath(targetName),
      chaptersPath: null
    } satisfies PendingReplaceMediaSnapshot
  })
  const targetBySourceName = new Map(media.map((item) => [item.sourceName, item.targetName]))
  const manifest: PendingReplaceManifestFile[] = mediaEntries.map((entry) => ({
    ...entry,
    kind: 'media',
    targetName: targetBySourceName.get(entry.name)
  }))

  const claimedChapterTargetNames = new Set<string>()
  for (const entry of fileEntries.filter((file) => file.kind === 'chapter')) {
    const relatedMediaName = mediaEntries.find((mediaEntry) =>
      getChapterPathCandidates(mediaEntry.name).map((candidate) => path.posix.basename(candidate)).includes(entry.name)
    )?.name
    if (!relatedMediaName) {
      warnings.push(`章节文件没有对应视频，已忽略: ${entry.name}`)
      manifest.push({ ...entry, kind: 'ignored' })
      continue
    }
    const targetMediaName = targetBySourceName.get(relatedMediaName)!
    const targetName = path.posix.basename(resolveCanonicalChapterPath(targetMediaName))
    if (claimedChapterTargetNames.has(targetName)) {
      throw new Error(`同一视频存在多个章节清单候选: ${relatedMediaName}`)
    }
    claimedChapterTargetNames.add(targetName)
    manifest.push({
      ...entry,
      kind: 'chapter',
      relatedMediaName,
      targetName
    })
  }
  manifest.push(...fileEntries.filter((entry) => entry.kind === 'ignored').map((entry) => ({ ...entry, kind: 'ignored' as const })))

  return { manifest, media, warnings }
}

export function createManifestFingerprint(manifest: PendingReplaceManifestFile[]) {
  const stableManifest = manifest
    .map(({ name, size, mtimeMs, sha256, kind }) => ({ name, size, mtimeMs, sha256, kind }))
    .sort((a, b) => compareFileNamesNaturally(a.name, b.name))
  return createHash('sha256').update(JSON.stringify(stableManifest)).digest('hex')
}

async function buildOldMediaSnapshot(scanPath: string, artwork: ArtworkForPendingReplace) {
  return concurrentMap(artwork.images, METADATA_CONCURRENCY, async (image, index) => {
    const storedPath = toStoredPath(image.path)
    const absolutePath = await resolveExistingPathWithinRoot(scanPath, storedPath.replace(/^\/+/, ''))
    const stats = await fs.stat(absolutePath)
    if (!stats.isFile()) throw new Error(`现有媒体不是文件: ${storedPath}`)
    if (image.size !== null && Number(image.size) !== stats.size) {
      throw new Error(`现有媒体大小与数据库不一致: ${storedPath}`)
    }

    let chaptersMtimeMs: number | undefined
    const chaptersPath = image.chaptersPath ? toStoredPath(image.chaptersPath) : null
    if (chaptersPath) {
      const absoluteChaptersPath = await resolveExistingPathWithinRoot(scanPath, chaptersPath.replace(/^\/+/, ''))
      const chaptersStats = await fs.stat(absoluteChaptersPath)
      if (!chaptersStats.isFile()) throw new Error(`现有章节清单不是文件: ${chaptersPath}`)
      chaptersMtimeMs = chaptersStats.mtimeMs
    }

    return {
      sourceName: path.posix.basename(storedPath),
      targetName: path.posix.basename(storedPath),
      path: storedPath,
      size: stats.size,
      databaseSize: image.size === null ? null : Number(image.size),
      width: image.width ?? 0,
      height: image.height ?? 0,
      order: image.sortOrder ?? index,
      mtimeMs: stats.mtimeMs,
      mediaType: image.mediaType,
      chaptersPath,
      chaptersMtimeMs
    } satisfies PendingReplaceMediaSnapshot
  })
}

async function buildTargetFileSnapshot(
  scanPath: string,
  targetDirectory: string
): Promise<PendingReplaceTargetFileSnapshot[]> {
  const absoluteDirectory = await resolveCreatablePathWithinRoot(scanPath, targetDirectory.replace(/^[/\\]+/, ''))
  let entries: Dirent[]
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const affectedEntries = entries
    .filter((entry) => {
      const extension = path.extname(entry.name).toLowerCase()
      return supportedMediaExtensions.has(extension) || isChapterManifestFileName(entry.name)
    })
    .sort((a, b) => compareFileNamesNaturally(a.name, b.name))
  return concurrentMap(affectedEntries, METADATA_CONCURRENCY, async (entry) => {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`目标目录存在不安全的媒体条目: ${entry.name}`)
    }
    const absolutePath = path.join(absoluteDirectory, entry.name)
    const stats = await fs.stat(absolutePath)
    return {
      name: entry.name,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: await createFileSha256(absolutePath)
    }
  })
}

function toStoredPath(input: string) {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalized ? `/${normalized}` : '/'
}

function isUnsafeExternalId(externalId: string) {
  return !pendingReplaceExternalIdSchema.safeParse(externalId).success
}

async function concurrentMap<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
