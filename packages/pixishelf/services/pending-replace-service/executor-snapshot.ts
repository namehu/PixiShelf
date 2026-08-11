import fs from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import {
  type PendingReplaceManifestFile,
  type PendingReplaceMediaSnapshot,
  type PendingReplaceTargetFileSnapshot,
  parsePendingReplaceManifest,
  parsePendingReplaceMediaSnapshot,
  parsePendingReplaceTargetFileSnapshot
} from '@/schemas/pending-replace.dto'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { createFileSha256, pathExists } from './executor-file-utils'

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)

export function asManifest(value: Prisma.JsonValue): PendingReplaceManifestFile[] {
  return parsePendingReplaceManifest(value)
}

export function asMediaSnapshot(value: Prisma.JsonValue): PendingReplaceMediaSnapshot[] {
  return parsePendingReplaceMediaSnapshot(value)
}

export function asTargetFileSnapshot(value: Prisma.JsonValue): PendingReplaceTargetFileSnapshot[] {
  return parsePendingReplaceTargetFileSnapshot(value)
}

export async function assertTargetDirectoryFilesSnapshot(
  targetDirectory: string,
  expected: PendingReplaceTargetFileSnapshot[]
) {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(targetDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && expected.length === 0) return
    throw error
  }
  const affectedEntries = entries
    .filter((entry) => {
      const extension = path.extname(entry.name).toLowerCase()
      return supportedMediaExtensions.has(extension) || isChapterManifestFileName(entry.name)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const current = await Promise.all(
    affectedEntries.map(async (entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`目标目录存在不安全的媒体条目: ${entry.name}`)
      }
      const absolutePath = path.join(targetDirectory, entry.name)
      const stats = await fs.stat(absolutePath)
      return {
        name: entry.name,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        sha256: await createFileSha256(absolutePath)
      }
    })
  )
  const normalizedExpected = [...expected].sort((a, b) => a.name.localeCompare(b.name))
  if (
    current.length !== normalizedExpected.length ||
    current.some((file, index) => {
      const expectedFile = normalizedExpected[index]
      return (
        !expectedFile ||
        file.name !== expectedFile.name ||
        file.size !== expectedFile.size ||
        !sameFileTime(file.mtimeMs, expectedFile.mtimeMs) ||
        file.sha256 !== expectedFile.sha256
      )
    })
  ) {
    throw new Error('作品目标目录在预检后发生变化，本项目已安全回滚，请重新扫描')
  }
}

export async function assertBackupDirectoryFilesSnapshot(
  backupDirectory: string,
  expected: PendingReplaceTargetFileSnapshot[]
) {
  const entries = (await fs.readdir(backupDirectory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  if (entries.length !== expected.length) {
    throw new Error('旧媒体备份文件集合已发生变化，拒绝恢复')
  }
  const current = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`旧媒体备份存在不安全条目: ${entry.name}`)
      }
      const absolutePath = path.join(backupDirectory, entry.name)
      const stats = await fs.stat(absolutePath)
      return {
        name: entry.name,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        sha256: await createFileSha256(absolutePath)
      }
    })
  )
  const normalizedExpected = [...expected].sort((a, b) => a.name.localeCompare(b.name))
  if (
    current.some((file, index) => {
      const expectedFile = normalizedExpected[index]
      return (
        !expectedFile ||
        file.name !== expectedFile.name ||
        file.size !== expectedFile.size ||
        !sameFileTime(file.mtimeMs, expectedFile.mtimeMs) ||
        file.sha256 !== expectedFile.sha256
      )
    })
  ) {
    throw new Error('旧媒体备份内容已发生变化，拒绝恢复')
  }
}

export async function assertBackupDirectoryFileSubsetSnapshot(
  backupDirectory: string,
  expected: PendingReplaceTargetFileSnapshot[]
) {
  const expectedByName = new Map(expected.map((file) => [file.name, file]))
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const expectedFile = expectedByName.get(entry.name)
    if (!expectedFile || entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`旧媒体应急备份存在未知或不安全条目: ${entry.name}`)
    }
    const absolutePath = path.join(backupDirectory, entry.name)
    const stats = await fs.stat(absolutePath)
    if (
      stats.size !== expectedFile.size ||
      !sameFileTime(stats.mtimeMs, expectedFile.mtimeMs) ||
      (await createFileSha256(absolutePath)) !== expectedFile.sha256
    ) {
      throw new Error(`旧媒体应急备份内容已发生变化: ${entry.name}`)
    }
  }
}

export async function assertRollbackFileSnapshot(
  targetDirectory: string,
  backupDirectory: string,
  expected: PendingReplaceTargetFileSnapshot[]
) {
  if (await pathExists(backupDirectory)) {
    await assertBackupDirectoryFileSubsetSnapshot(backupDirectory, expected)
  }
  for (const expectedFile of expected) {
    const backupPath = path.join(backupDirectory, expectedFile.name)
    const targetPath = path.join(targetDirectory, expectedFile.name)
    const [inBackup, inTarget] = await Promise.all([pathExists(backupPath), pathExists(targetPath)])
    if (inBackup === inTarget) {
      throw new Error(`旧媒体必须且只能存在于目标或应急备份之一: ${expectedFile.name}`)
    }
    const actualPath = inBackup ? backupPath : targetPath
    const stats = await fs.lstat(actualPath)
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size !== expectedFile.size ||
      !sameFileTime(stats.mtimeMs, expectedFile.mtimeMs) ||
      (await createFileSha256(actualPath)) !== expectedFile.sha256
    ) {
      throw new Error(`旧媒体回滚快照不匹配: ${expectedFile.name}`)
    }
  }
}

export async function assertArtworkDatabaseSnapshot(
  tx: ArtworkMediaSnapshotTransactionClient,
  artworkId: number,
  expected: PendingReplaceMediaSnapshot[]
) {
  const current = await tx.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      path: true,
      sortOrder: true,
      size: true,
      width: true,
      height: true,
      mediaType: true,
      chaptersPath: true
    }
  })
  const normalizedExpected = [...expected]
    .sort((a, b) => a.order - b.order)
    .map((media) => ({
      path: normalizeStoredPath(media.path),
      order: media.order,
      size: media.databaseSize === undefined ? media.size : (media.databaseSize ?? 0),
      width: media.width,
      height: media.height,
      mediaType: media.mediaType ?? null,
      chaptersPath: media.chaptersPath ? normalizeStoredPath(media.chaptersPath) : null
    }))
  const normalizedCurrent = current.map((media) => ({
    path: normalizeStoredPath(media.path),
    order: media.sortOrder,
    size: Number(media.size ?? 0),
    width: media.width ?? 0,
    height: media.height ?? 0,
    mediaType: media.mediaType,
    chaptersPath: media.chaptersPath ? normalizeStoredPath(media.chaptersPath) : null
  }))
  if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedExpected)) {
    throw new Error('作品媒体在预检后发生变化，本项目已安全回滚，请重新扫描')
  }
}

interface ArtworkMediaSnapshotTransactionClient {
  image: {
    findMany(args: any): PromiseLike<
      Array<{
        path: string
        sortOrder: number
        size: bigint | null
        width: number | null
        height: number | null
        mediaType: string
        chaptersPath: string | null
      }>
    >
  }
}

export async function assertArtworkMediaFilesSnapshot(
  scanPath: string,
  expected: PendingReplaceMediaSnapshot[]
) {
  await Promise.all(
    expected.map(async (media) => {
      const absolutePath = await resolveExistingPathWithinRoot(scanPath, stripLeadingSlash(media.path))
      const stats = await fs.stat(absolutePath)
      if (
        !stats.isFile() ||
        stats.size !== media.size ||
        !sameFileTime(stats.mtimeMs, media.mtimeMs) ||
        (media.sha256 !== undefined && (await createFileSha256(absolutePath)) !== media.sha256)
      ) {
        throw new Error(`作品媒体文件在预检后发生变化: ${media.path}`)
      }
      if (media.chaptersPath) {
        const absoluteChaptersPath = await resolveExistingPathWithinRoot(
          scanPath,
          stripLeadingSlash(media.chaptersPath)
        )
        const chaptersStats = await fs.stat(absoluteChaptersPath)
        if (
          !chaptersStats.isFile() ||
          !sameFileTime(chaptersStats.mtimeMs, media.chaptersMtimeMs) ||
          (media.chaptersSha256 !== undefined &&
            (await createFileSha256(absoluteChaptersPath)) !== media.chaptersSha256)
        ) {
          throw new Error(`作品章节文件在预检后发生变化: ${media.chaptersPath}`)
        }
      }
    })
  )
}

export function buildInstalledNewMediaSnapshot(
  targetDirectory: string,
  manifest: PendingReplaceManifestFile[],
  newMedia: PendingReplaceMediaSnapshot[]
) {
  const chapterByMedia = new Map(
    manifest
      .filter((file) => file.kind === 'chapter' && file.relatedMediaName && file.targetName)
      .map((file) => [file.relatedMediaName!, file] as const)
  )
  return newMedia.map((media) => ({
    ...media,
    path: toStoredPath(path.posix.join(stripLeadingSlash(targetDirectory), media.targetName)),
    chaptersPath: chapterByMedia.has(media.sourceName)
      ? toStoredPath(
          path.posix.join(stripLeadingSlash(targetDirectory), chapterByMedia.get(media.sourceName)!.targetName!)
        )
      : null,
    chaptersMtimeMs: chapterByMedia.get(media.sourceName)?.mtimeMs,
    chaptersSha256: chapterByMedia.get(media.sourceName)?.sha256
  }))
}

export function stripLeadingSlash(value: string) {
  return value.replace(/^[/\\]+/, '')
}

export function toStoredPath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalized ? `/${normalized}` : '/'
}

export function normalizeStoredPath(value: string) {
  return toStoredPath(value).toLowerCase()
}

function sameFileTime(actual: number, expected: number | undefined) {
  return expected === undefined || Math.abs(actual - expected) < 1
}
