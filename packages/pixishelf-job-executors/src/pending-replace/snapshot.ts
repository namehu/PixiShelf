import path from 'node:path'
import { createHash } from 'node:crypto'
import { MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import { MAX_PENDING_REPLACE_WARNINGS } from './schemas.ts'
import {
  caseFoldPath,
  normalizeStoredRelativePath,
  resolveSafeCreatablePath,
  resolveSafeExistingPath,
  toStoredPath
} from './paths.ts'
import type {
  PendingReplaceArtworkSnapshot,
  PendingReplaceExecutorDependencies,
  PendingReplaceManifestFile,
  PendingReplaceMediaSnapshot,
  PendingReplaceTargetFileSnapshot,
  QueueSqlExecutor
} from './types-internal.ts'
import { PendingReplacePermanentError } from './types.ts'

const mediaExtensions = new Set<string>(MEDIA_FILE_EXTENSIONS)
const videoExtensions = new Set<string>(VIDEO_FILE_EXTENSIONS)
export const PENDING_DIRECTORY = 'pending-replaces'
export const WORK_DIRECTORY = '.replace-work'
export const BACKUP_DIRECTORY = 'replace-backups'
export const COMPLETED_DIRECTORY = 'completed-replaces'
export const MANIFEST_FILE = 'replace-manifest.json'
const EXTERNAL_ID_MARKER = '__ext-'

export interface ScannedPendingSource {
  manifest: PendingReplaceManifestFile[]
  media: PendingReplaceMediaSnapshot[]
  warnings: string[]
}

export function parsePendingDirectoryName(directoryName: string): string | null {
  const marker = directoryName.lastIndexOf(EXTERNAL_ID_MARKER)
  if (marker < 1) return null
  const externalId = directoryName.slice(marker + EXTERNAL_ID_MARKER.length).trim()
  if (
    !externalId ||
    externalId.length > 255 ||
    externalId === '.' ||
    externalId === '..' ||
    /[<>:"/\\|?*]/.test(externalId) ||
    Array.from(externalId).some((character) => character.charCodeAt(0) < 32)
  ) {
    return null
  }
  return externalId
}

export async function scanPendingSource<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  sourceDirectoryName: string,
  externalId: string
): Promise<ScannedPendingSource> {
  const limit = boundedEntryLimit(dependencies)
  const sourceRelative = path.posix.join(PENDING_DIRECTORY, sourceDirectoryName)
  const source = await resolveSafeExistingPath(
    dependencies.fileSystem,
    dependencies.config.scanRoot,
    sourceRelative,
    'directory'
  )
  const listed = await dependencies.fileSystem.listDirectoryBounded(source, limit)
  if (listed.hasMore)
    throw new PendingReplacePermanentError('LIMIT_EXCEEDED', 'Pending source directory exceeds the entry limit')
  const warnings: string[] = []
  const files: PendingReplaceManifestFile[] = []
  for (const entry of listed.entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.toLocaleLowerCase('en-US') === MANIFEST_FILE) {
      throw new PendingReplacePermanentError('SOURCE_CHANGED', 'Pending source contains a reserved manifest file')
    }
    if (entry.isSymbolicLink)
      throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Pending source contains a link')
    if (entry.isDirectory) {
      boundedWarning(warnings, 'Ignored nested directory')
      continue
    }
    if (!entry.isFile) continue
    const stored = path.posix.join(sourceRelative, entry.name)
    const absolute = await resolveSafeExistingPath(
      dependencies.fileSystem,
      dependencies.config.scanRoot,
      stored,
      'file'
    )
    const stat = await dependencies.fileSystem.lstat(absolute)
    const extension = path.extname(entry.name).toLocaleLowerCase('en-US')
    const kind = mediaExtensions.has(extension) ? 'media' : isChapterFile(entry.name) ? 'chapter' : 'ignored'
    if (kind === 'ignored') boundedWarning(warnings, 'Ignored unsupported file')
    files.push({
      name: entry.name,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      sha256: await dependencies.fileSystem.hashFile(absolute),
      kind
    })
  }
  const mediaFiles = files.filter((file) => file.kind === 'media')
  const media: PendingReplaceMediaSnapshot[] = mediaFiles.map((file, order) => {
    const extension = path.extname(file.name).toLocaleLowerCase('en-US')
    const targetName = `${externalId}_p${order}${extension}`
    file.targetName = targetName
    return {
      sourceName: file.name,
      targetName,
      path: toStoredPath(path.posix.join(sourceRelative, file.name)),
      size: file.size,
      sha256: file.sha256,
      width: 0,
      height: 0,
      order,
      mtimeMs: file.mtimeMs,
      mediaType: inferMediaType(extension)
    }
  })
  const mediaByName = new Map(mediaFiles.map((file) => [file.name, file]))
  const claimed = new Set<string>()
  for (const chapter of files.filter((file) => file.kind === 'chapter')) {
    const related = [...mediaByName.keys()].find((name) => chapterCandidates(name).includes(chapter.name))
    if (!related) {
      chapter.kind = 'ignored'
      boundedWarning(warnings, 'Ignored orphan chapter manifest')
      continue
    }
    const targetMedia = media.find((entry) => entry.sourceName === related)!
    const targetName = `${targetMedia.targetName}.chapters.json`
    if (claimed.has(targetName))
      throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Duplicate chapter manifest')
    claimed.add(targetName)
    chapter.relatedMediaName = related
    chapter.targetName = targetName
  }
  return { manifest: files, media, warnings }
}

export async function buildArtworkSnapshots<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  artwork: PendingReplaceArtworkSnapshot
): Promise<{
  targetDirectory: string
  oldMedia: PendingReplaceMediaSnapshot[]
  targetFiles: PendingReplaceTargetFileSnapshot[]
}> {
  const targetDirectory = determineTargetDirectory(artwork)
  if (!targetDirectory)
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Artwork has no stable target directory')
  const oldMedia: PendingReplaceMediaSnapshot[] = []
  for (const image of artwork.images) {
    const relative = normalizeStoredRelativePath(image.path)
    if (caseFoldPath(path.posix.dirname(relative)) !== caseFoldPath(targetDirectory)) {
      throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Artwork media is outside its stable target directory')
    }
    const absolute = await resolveSafeExistingPath(
      dependencies.fileSystem,
      dependencies.config.scanRoot,
      relative,
      'file'
    )
    const stat = await dependencies.fileSystem.lstat(absolute)
    if (image.size !== null && image.size !== stat.size) {
      throw new PendingReplacePermanentError(
        'DATABASE_CHANGED',
        'Artwork media size differs from the database snapshot'
      )
    }
    oldMedia.push({
      sourceName: path.posix.basename(relative),
      targetName: path.posix.basename(relative),
      path: toStoredPath(relative),
      size: stat.size,
      databaseSize: image.size,
      sha256: await dependencies.fileSystem.hashFile(absolute),
      width: image.width ?? 0,
      height: image.height ?? 0,
      order: image.sortOrder,
      mtimeMs: Math.trunc(stat.mtimeMs),
      mediaType: image.mediaType,
      chaptersPath: image.chaptersPath
    })
  }
  const targetFiles = await scanTargetFiles(dependencies, targetDirectory)
  return { targetDirectory: toStoredPath(targetDirectory), oldMedia, targetFiles }
}

export async function scanTargetFiles<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  targetDirectory: string
): Promise<PendingReplaceTargetFileSnapshot[]> {
  const relative = normalizeStoredRelativePath(targetDirectory)
  const directory = await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, relative)
  let listed
  try {
    listed = await dependencies.fileSystem.listDirectoryBounded(directory, boundedEntryLimit(dependencies))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (listed.hasMore)
    throw new PendingReplacePermanentError('LIMIT_EXCEEDED', 'Target directory exceeds the entry limit')
  const snapshots: PendingReplaceTargetFileSnapshot[] = []
  for (const entry of listed.entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const extension = path.extname(entry.name).toLocaleLowerCase('en-US')
    if (!mediaExtensions.has(extension) && !isChapterFile(entry.name)) continue
    if (!entry.isFile || entry.isSymbolicLink) {
      throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Target contains a non-regular media entry')
    }
    const file = await resolveSafeExistingPath(
      dependencies.fileSystem,
      dependencies.config.scanRoot,
      path.posix.join(relative, entry.name),
      'file'
    )
    const stat = await dependencies.fileSystem.lstat(file)
    snapshots.push({
      name: entry.name,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      sha256: await dependencies.fileSystem.hashFile(file)
    })
  }
  return snapshots
}

export function createManifestFingerprint(manifest: PendingReplaceManifestFile[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        manifest
          .map(({ name, size, mtimeMs, sha256, kind }) => ({ name, size, mtimeMs, sha256, kind }))
          .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      )
    )
    .digest('hex')
}

export function buildInstalledMedia(
  itemTargetDirectory: string,
  media: PendingReplaceMediaSnapshot[],
  manifest: PendingReplaceManifestFile[]
) {
  const directory = normalizeStoredRelativePath(itemTargetDirectory)
  const chapterByMedia = new Map(
    manifest
      .filter((file) => file.kind === 'chapter' && file.relatedMediaName && file.targetName)
      .map((file) => [file.relatedMediaName!, file] as const)
  )
  return media.map((entry) => {
    const chapter = chapterByMedia.get(entry.sourceName)
    return {
      ...entry,
      path: toStoredPath(path.posix.join(directory, entry.targetName)),
      chaptersPath: chapter?.targetName ? toStoredPath(path.posix.join(directory, chapter.targetName)) : null,
      ...(chapter ? { chaptersMtimeMs: chapter.mtimeMs, chaptersSha256: chapter.sha256 } : {})
    }
  })
}

function determineTargetDirectory(artwork: PendingReplaceArtworkSnapshot): string | null {
  if (artwork.storagePath) {
    const normalized = normalizeStoredRelativePath(artwork.storagePath)
    return path.posix.extname(normalized) ? path.posix.dirname(normalized) : normalized
  }
  const directories = new Set(
    artwork.images.map((image) => path.posix.dirname(normalizeStoredRelativePath(image.path)))
  )
  return directories.size === 1 ? [...directories][0]! : null
}

function boundedEntryLimit<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  const limit = dependencies.config.maximumDirectoryEntries ?? 1_234
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_234) throw new Error('maximumDirectoryEntries must be 1..1234')
  return limit
}

function boundedWarning(warnings: string[], warning: string) {
  if (warnings.length < MAX_PENDING_REPLACE_WARNINGS) warnings.push(warning)
}

function isChapterFile(name: string) {
  const lower = name.toLocaleLowerCase('en-US')
  return lower.endsWith('.chapters.json') || lower.endsWith('.chapters.v1.json')
}

function chapterCandidates(mediaName: string) {
  return [`${mediaName}.chapters.json`, `${mediaName}.chapters.v1.json`]
}

function inferMediaType(extension: string): 'IMAGE' | 'VIDEO' | 'ANIMATION' | 'UNKNOWN' {
  if (videoExtensions.has(extension)) return 'VIDEO'
  if (extension === '.gif' || extension === '.webp' || extension === '.apng') return 'ANIMATION'
  if (mediaExtensions.has(extension)) return 'IMAGE'
  return 'UNKNOWN'
}
