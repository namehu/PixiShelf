import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { ArchiveExecutorError, toArchiveExecutorError, withArchiveExecutorErrorContext } from './errors.ts'
import type { ArchiveRemoteMedia } from './types.ts'

const DEFAULT_MAX_MEDIA_BYTES = 512 * 1024 * 1024

export interface ArchiveStoragePaths {
  scanRootAbsolutePath: string
  stagingRelativePath: string
  stagingAbsolutePath: string
  finalRelativePath: string
  finalAbsolutePath: string
}

export interface StoredArchiveMedia {
  relativePath: string
  byteCount: bigint
  mimeType: string
  width: number
  height: number
  sha256: string
}

export function buildArchiveStoragePaths(input: {
  scanRoot: string
  archiveImportId: string
  providerKey: string
  creatorBucket: string
  externalId: string
}): ArchiveStoragePaths {
  const provider = safePathSegment(input.providerKey)
  const bucket = safePathSegment(input.creatorBucket)
  const externalId = safePathSegment(input.externalId)
  const archiveImportId = safePathSegment(input.archiveImportId)
  const stagingRelativePath = normalizeRelativePath(path.join('.archive-staging', archiveImportId))
  const finalRelativePath = normalizeRelativePath(
    path.join('sources', provider, bucket, externalId, 'revisions', archiveImportId)
  )
  return {
    scanRootAbsolutePath: path.resolve(input.scanRoot),
    stagingRelativePath,
    stagingAbsolutePath: path.resolve(input.scanRoot, stagingRelativePath),
    finalRelativePath,
    finalAbsolutePath: path.resolve(input.scanRoot, finalRelativePath)
  }
}

export async function prepareArchiveStagingDirectory(scanRoot: string, storedPath: string): Promise<string> {
  const target = await resolveCreatablePathWithinRoot(scanRoot, storedPath)
  try {
    await mkdir(path.join(target, 'media'), { recursive: true })
  } catch (error) {
    throw withStorageContext(error)
  }
  return target
}

export async function storeArchiveRemoteMedia(input: {
  remote: ArchiveRemoteMedia
  stagingDirectory: string
  index: number
  expectedFilename: string
  signal: AbortSignal
  maxBytes?: number
  partialKey: string
}): Promise<StoredArchiveMedia> {
  throwIfAborted(input.signal)
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Archive max media bytes must be positive')
  if (input.remote.contentLength !== null && input.remote.contentLength > maxBytes) {
    input.remote.stream.destroy()
    throw new ArchiveExecutorError('DOWNLOAD_TOO_LARGE', `Archive media exceeds ${maxBytes} bytes`, {
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }

  const filename = buildStoredFilename(
    input.index,
    input.remote.originalFilename ?? input.expectedFilename,
    input.remote.mimeType
  )
  const mediaDirectory = await resolveCreatablePathWithinRoot(input.stagingDirectory, 'media')
  const target = await resolveCreatablePathWithinRoot(mediaDirectory, filename)
  const partial = await resolveCreatablePathWithinRoot(
    mediaDirectory,
    `${filename}.part-${safePathSegment(input.partialKey)}`
  )
  let handle: Awaited<ReturnType<typeof open>>
  try {
    await mkdir(mediaDirectory, { recursive: true })
    await rm(partial, { force: true })
    handle = await open(partial, 'wx')
  } catch (error) {
    throw withStorageContext(error)
  }

  const hash = createHash('sha256')
  let byteCount = 0
  let transferError: ArchiveExecutorError | null = null
  try {
    for await (const chunk of input.remote.stream) {
      throwIfAborted(input.signal)
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteCount += buffer.length
      if (byteCount > maxBytes) {
        throw new ArchiveExecutorError('DOWNLOAD_TOO_LARGE', `Archive media exceeds ${maxBytes} bytes`, {
          stage: 'MEDIA_STREAM',
          remoteHost: input.remote.remoteHost
        })
      }
      hash.update(buffer)
      await handle.write(buffer)
    }
    await handle.sync()
  } catch (error) {
    input.remote.stream.destroy()
    transferError = classifyTransferError(error, input.remote.remoteHost)
  }
  try {
    await handle.close()
  } catch (error) {
    transferError = withStorageContext(error)
  }
  if (transferError) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw transferError
  }

  if (input.remote.contentLength !== null && byteCount !== input.remote.contentLength) {
    await rm(partial, { force: true })
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive media length differs from Content-Length', {
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }

  const mimeType = normalizeImageMimeType(input.remote.mimeType, filename)
  if (!mimeType.startsWith('image/')) {
    await rm(partial, { force: true })
    throw new ArchiveExecutorError('MEDIA_INVALID', `Unsupported archive media type: ${mimeType}`, {
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(partial, { animated: true }).metadata()
  } catch (error) {
    await rm(partial, { force: true })
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive media is not a decodable image', {
      cause: error,
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  if (!metadata.width || !metadata.height) {
    await rm(partial, { force: true })
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive media has no valid dimensions', {
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }

  throwIfAborted(input.signal)
  try {
    await rm(target, { force: true })
    await rename(partial, target)
  } catch (error) {
    throw withStorageContext(error)
  }
  return {
    relativePath: normalizeRelativePath(path.join('media', filename)),
    byteCount: BigInt(byteCount),
    mimeType,
    width: metadata.width,
    height: metadata.pageHeight ?? metadata.height,
    sha256: hash.digest('hex')
  }
}

export async function validateArchiveStoredMedia(
  stagingDirectory: string,
  items: Array<{ stagedPath: string | null; sha256: string | null; byteCount: bigint | null }>
): Promise<void> {
  for (const item of items) {
    if (!item.stagedPath || !item.sha256 || item.byteCount === null) {
      throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive checkpoint is missing a media digest')
    }
    const filePath = await resolveExistingPathWithinRoot(stagingDirectory, item.stagedPath)
    const file = await readFile(filePath)
    if (BigInt(file.length) !== item.byteCount || createHash('sha256').update(file).digest('hex') !== item.sha256) {
      throw new ArchiveExecutorError('MEDIA_INVALID', `Archive media digest mismatch: ${item.stagedPath}`, {
        recoverable: true
      })
    }
  }
}

export async function writeArchiveManifest(stagingDirectory: string, manifest: Record<string, unknown>): Promise<void> {
  const target = await resolveCreatablePathWithinRoot(stagingDirectory, 'manifest.json')
  const temporary = await resolveCreatablePathWithinRoot(stagingDirectory, 'manifest.json.tmp')
  await writeFile(temporary, `${JSON.stringify(manifest, jsonReplacer, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  JSON.parse(await readFile(temporary, 'utf8'))
  await rename(temporary, target)
}

export async function prepareArchiveRevisionDirectory(paths: ArchiveStoragePaths): Promise<void> {
  const finalDirectory = await resolveCreatablePathWithinRoot(paths.scanRootAbsolutePath, paths.finalRelativePath)
  await mkdir(path.dirname(finalDirectory), { recursive: true })
  if (!(await pathExists(finalDirectory))) {
    const stagingDirectory = await resolveExistingPathWithinRoot(paths.scanRootAbsolutePath, paths.stagingRelativePath)
    await rename(stagingDirectory, finalDirectory)
  }
  for (const required of ['media', 'manifest.json']) {
    await resolveExistingPathWithinRoot(finalDirectory, required).catch(() => {
      throw new ArchiveExecutorError('MEDIA_INVALID', `Prepared archive revision is missing ${required}`, {
        recoverable: true
      })
    })
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

export async function resolveExistingPathWithinRoot(root: string, candidate: string): Promise<string> {
  const resolved = resolveCandidate(root, candidate)
  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(resolved.root), realpath(resolved.candidate)])
  assertWithinRoot(canonicalRoot, canonicalCandidate)
  return canonicalCandidate
}

export async function resolveCreatablePathWithinRoot(root: string, candidate: string): Promise<string> {
  const resolved = resolveCandidate(root, candidate)
  const existingAncestor = await nearestExistingAncestor(resolved.candidate)
  const [canonicalRoot, canonicalAncestor] = await Promise.all([realpath(resolved.root), realpath(existingAncestor)])
  assertWithinRoot(canonicalRoot, canonicalAncestor)
  return resolved.candidate
}

function resolveCandidate(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(resolvedRoot, candidate)
  assertWithinRoot(resolvedRoot, resolvedCandidate)
  return { root: resolvedRoot, candidate: resolvedCandidate }
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive path escapes its configured root')
  }
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate
  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

function buildStoredFilename(index: number, originalFilename: string, mimeType: string | null): string {
  const ordinal = String(index + 1).padStart(4, '0')
  const parsed = path.parse(path.basename(originalFilename.replace(/[\\/]/g, '-')))
  const stem = safePathSegment(parsed.name || `media-${ordinal}`).slice(0, 160)
  const extension = safeExtension(parsed.ext) || extensionForMimeType(mimeType) || '.bin'
  return `${ordinal}-${stem}${extension}`
}

function safePathSegment(value: string): string {
  const safe = value
    .normalize('NFKC')
    .trim()
    // oxlint-disable-next-line no-control-regex -- filesystem segments must reject C0 controls
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 180)
  if (!safe || safe === '.' || safe === '..') {
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Invalid archive path segment')
  }
  return safe
}

function safeExtension(value: string): string {
  const normalized = value.toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(normalized) ? normalized : ''
}

function extensionForMimeType(mimeType: string | null): string {
  return (
    (
      {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/avif': '.avif',
        'image/bmp': '.bmp'
      } as Record<string, string>
    )[mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''] ?? ''
  )
}

function normalizeImageMimeType(mimeType: string | null, filename: string): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized?.startsWith('image/')) return normalized
  return (
    (
      {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.bmp': 'image/bmp'
      } as Record<string, string>
    )[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
  )
}

function withStorageContext(error: unknown): ArchiveExecutorError {
  const classified = toArchiveExecutorError(error)
  if (classified.code === 'STORAGE_FULL') return classified
  return withArchiveExecutorErrorContext(classified, { stage: 'STORAGE' })
}

function classifyTransferError(error: unknown, remoteHost: string | null): ArchiveExecutorError {
  const classified = toArchiveExecutorError(error)
  if (classified.stage === 'STORAGE') return classified
  if (classified.code === 'INTERNAL') {
    return new ArchiveExecutorError('REMOTE_RESPONSE_INVALID', 'Remote archive media transfer was interrupted', {
      cause: classified,
      recoverable: true,
      stage: 'MEDIA_STREAM',
      remoteHost
    })
  }
  return classified.stage
    ? classified
    : withArchiveExecutorErrorContext(classified, { stage: 'MEDIA_STREAM', remoteHost })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new ArchiveExecutorError('CANCELLED', 'Archive execution was cancelled')
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
