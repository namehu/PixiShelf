import * as fs from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import sharp from 'sharp'
import { mapBounded, throwIfAborted } from './bounded.ts'
import { hashStableFile, statStableFile, type StableFileState } from './content-reader.ts'
import { ScanExecutorError } from './errors.ts'
import { computeLocalWorkContentFingerprintWithinRoot } from './fingerprint.ts'
import {
  relativeFromRoot,
  resolveSafeExistingPath,
  type SafeScanPath,
  type SafeScanRoot,
  walkSafeFiles
} from './paths.ts'
import { metadataCandidateFromPath, selectPreferredMetadataCandidates, type MetadataCandidate } from './metadata.ts'
import { compareCodePoints, compareNaturalCodePoints } from './stable-order.ts'
import { createChapterManifestHash, readChapterManifest } from '../video-processing/chapter-manifest.ts'
import { VideoProcessingPermanentError } from '../video-processing/types.ts'

const metadataSuffix = /-meta\.(?:json|txt)$/i
const mediaExtensions = new Set<string>(MEDIA_FILE_EXTENSIONS)
const videoExtensions = new Set<string>(VIDEO_FILE_EXTENSIONS)
const animationExtensions = new Set(['.gif', '.apng'])
const contentScannedAnimationExtensions = new Set(['.webp', '.gif', '.png', '.apng'])

export interface ScanDiscoveryLimits {
  pageSize: number
  maxDepth: number
  maxDiscoveryEntries: number
  maxEntries: number
  maxMediaPerArtwork: number
  concurrency?: number
  maxMetadataBytes?: number
  maxArchiveMediaBytes?: number
}

export interface FrozenMetadataCandidate extends MetadataCandidate {
  contentHash: string
  state: StableFileState
}

export interface StattedMetadataCandidate extends MetadataCandidate {
  state: StableFileState
}

export interface DiscoveredMediaFile {
  relativePath: string
  size: bigint
  sortOrder: number
  mediaType: 'IMAGE' | 'ANIMATION' | 'VIDEO'
  webpAnimationStatus: number | null
  chaptersPath: string | null
  chaptersCount: number
  chaptersDuration: number | null
  chaptersHash: string | null
}

export interface DiscoveredLocalMediaFile extends DiscoveredMediaFile {
  width: number
  height: number
  modifiedAt: Date
}

export async function* discoverMetadataCandidatePages(
  root: SafeScanRoot,
  limits: ScanDiscoveryLimits,
  signal: AbortSignal,
  onEntry?: () => void
): AsyncGenerator<FrozenMetadataCandidate[]> {
  for await (const page of discoverMetadataStatCandidatePages(root, limits, signal, onEntry)) {
    throwIfAborted(signal)
    yield await mapBounded(page, limits.concurrency ?? 1, signal, async (candidate) => {
      const hashed = await hashStableFile({
        absolutePath: candidate.absolutePath,
        maxBytes: limits.maxMetadataBytes ?? 16 * 1024 * 1024,
        signal
      })
      return { ...candidate, contentHash: hashed.sha256, state: hashed.state }
    })
  }
}

export async function* discoverMetadataStatCandidatePages(
  root: SafeScanRoot,
  limits: ScanDiscoveryLimits,
  signal: AbortSignal,
  onEntry?: () => void
): AsyncGenerator<StattedMetadataCandidate[]> {
  const candidates: MetadataCandidate[] = []
  for await (const page of walkSafeFiles(root, '', {
    pageSize: limits.pageSize,
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxDiscoveryEntries,
    signal,
    include: (relativePath) => metadataSuffix.test(relativePath),
    ...(onEntry ? { onEntry } : {})
  })) {
    for (const item of page) {
      const candidate = metadataCandidateFromPath(item)
      if (candidate) candidates.push(candidate)
    }
  }
  const selected = selectPreferredMetadataCandidates(candidates)
  for (let offset = 0; offset < selected.length; offset += limits.pageSize) {
    throwIfAborted(signal)
    const page = selected.slice(offset, offset + limits.pageSize)
    const statted = await mapBounded(page, limits.concurrency ?? 1, signal, async (candidate) => ({
      ...candidate,
      state: await statStableFile(candidate.absolutePath)
    }))
    yield statted
  }
}

export async function* discoverAuditMetadataStatCandidatePages(
  root: SafeScanRoot,
  limits: ScanDiscoveryLimits,
  signal: AbortSignal,
  onEntry?: () => void
): AsyncGenerator<StattedMetadataCandidate[]> {
  for await (const page of walkSafeFiles(root, '', {
    pageSize: limits.pageSize,
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxDiscoveryEntries,
    signal,
    include: (relativePath) => metadataSuffix.test(relativePath),
    ...(onEntry ? { onEntry } : {})
  })) {
    throwIfAborted(signal)
    const candidates = page.flatMap((item) => {
      const candidate = metadataCandidateFromPath(item)
      return candidate ? [candidate] : []
    })
    if (candidates.length === 0) continue
    yield await mapBounded(candidates, limits.concurrency ?? 1, signal, async (candidate) => ({
      ...candidate,
      state: await statStableFile(candidate.absolutePath)
    }))
  }
}

export async function resolveClientMetadataPage(
  root: SafeScanRoot,
  relativePaths: readonly string[],
  signal: AbortSignal,
  maxMetadataBytes = 16 * 1024 * 1024
): Promise<FrozenMetadataCandidate[]> {
  const candidates: MetadataCandidate[] = []
  for (const relativePath of relativePaths) {
    throwIfAborted(signal)
    const resolved = await resolveSafeExistingPath(root, relativePath, 'file')
    const candidate = metadataCandidateFromPath(resolved)
    if (!candidate) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Client metadata input has an invalid filename')
    }
    candidates.push(candidate)
  }
  return Promise.all(
    selectPreferredMetadataCandidates(candidates).map(async (candidate) => {
      const hashed = await hashStableFile({ absolutePath: candidate.absolutePath, maxBytes: maxMetadataBytes, signal })
      return { ...candidate, contentHash: hashed.sha256, state: hashed.state }
    })
  )
}

export async function collectArtworkMedia(
  root: SafeScanRoot,
  candidate: MetadataCandidate,
  limits: Pick<ScanDiscoveryLimits, 'maxEntries' | 'maxMediaPerArtwork'>,
  signal: AbortSignal
): Promise<DiscoveredMediaFile[]> {
  throwIfAborted(signal)
  const directory = path.dirname(candidate.absolutePath)
  const handle = await fs.opendir(directory)
  const media: Array<DiscoveredMediaFile & { filename: string }> = []
  let entries = 0
  try {
    for await (const entry of handle) {
      throwIfAborted(signal)
      entries += 1
      if (entries > limits.maxEntries) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Artwork directory exceeds the configured entry limit')
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!mediaExtensions.has(extension)) continue
      const pageIndex = mediaPageIndex(entry.name, candidate.artworkId, extension)
      if (pageIndex === null) continue
      const absolutePath = path.join(directory, entry.name)
      const metadata = await fs.lstat(absolutePath)
      if (metadata.isSymbolicLink()) {
        throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Artwork media must not be a symbolic link')
      }
      if (!metadata.isFile()) continue
      media.push({
        relativePath: relativeFromRoot(root, await fs.realpath(absolutePath)),
        size: BigInt(metadata.size),
        sortOrder: pageIndex,
        mediaType: inferMediaType(extension),
        webpAnimationStatus: contentScannedAnimationExtensions.has(extension) ? 0 : null,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersHash: null,
        filename: entry.name
      })
      if (media.length > limits.maxMediaPerArtwork) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Artwork media count exceeds the configured limit')
      }
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  const ordered = media
    .sort((left, right) => left.sortOrder - right.sortOrder || compareCodePoints(left.filename, right.filename))
    .map((item, sortOrder) => withoutFilename(item, sortOrder))
  return attachChapterManifests(root, ordered, signal)
}

export async function collectLocalMedia(
  root: SafeScanRoot,
  relativeDirectory: string,
  limits: Pick<ScanDiscoveryLimits, 'maxEntries' | 'maxMediaPerArtwork' | 'concurrency'>,
  signal: AbortSignal
): Promise<DiscoveredLocalMediaFile[]> {
  const directory = await resolveSafeExistingPath(root, relativeDirectory, 'directory')
  const handle = await fs.opendir(directory.absolutePath)
  const media: Array<DiscoveredMediaFile & { absolutePath: string; filename: string; modifiedAt: Date }> = []
  let entries = 0
  try {
    for await (const entry of handle) {
      throwIfAborted(signal)
      entries += 1
      if (entries > limits.maxEntries) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work exceeds the configured entry limit')
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (!mediaExtensions.has(extension)) continue
      const absolutePath = path.join(directory.absolutePath, entry.name)
      const metadata = await fs.lstat(absolutePath)
      if (metadata.isSymbolicLink()) {
        throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Local media is a symbolic link')
      }
      if (!metadata.isFile()) continue
      media.push({
        relativePath: relativeFromRoot(root, await fs.realpath(absolutePath)),
        size: BigInt(metadata.size),
        sortOrder: 0,
        mediaType: inferMediaType(extension),
        webpAnimationStatus: contentScannedAnimationExtensions.has(extension) ? 0 : null,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersHash: null,
        absolutePath,
        modifiedAt: metadata.mtime,
        filename: entry.name
      })
      if (media.length > limits.maxMediaPerArtwork) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work media count exceeds the configured limit')
      }
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  const ordered = await mapBounded(
    media.sort((left, right) => naturalNameCompare(left.filename, right.filename)),
    limits.concurrency ?? 1,
    signal,
    async (item, sortOrder): Promise<DiscoveredLocalMediaFile> => {
      const dimensions = await readLocalMediaDimensions(item.absolutePath, item.mediaType)
      return {
        ...withoutFilename(item, sortOrder),
        ...dimensions,
        modifiedAt: item.modifiedAt
      }
    }
  )
  return attachChapterManifests(root, ordered, signal)
}

export async function verifyLocalWorkFingerprint(input: {
  root: SafeScanRoot
  relativeDirectory: string
  kind: 'MEDIA_DIRECTORY'
  expectedFingerprint: string | null
  limits: Pick<ScanDiscoveryLimits, 'maxEntries' | 'maxMediaPerArtwork' | 'maxArchiveMediaBytes'>
  signal: AbortSignal
}): Promise<SafeScanPath> {
  throwIfAborted(input.signal)
  if (!input.expectedFingerprint) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work input has no frozen fingerprint')
  }
  const actual = await computeLocalWorkContentFingerprintWithinRoot({
    root: input.root,
    relativeDirectory: input.relativeDirectory,
    kind: input.kind,
    maxEntries: input.limits.maxEntries,
    maxFiles: input.limits.maxMediaPerArtwork,
    maxFileBytes: input.limits.maxArchiveMediaBytes ?? 4 * 1024 * 1024 * 1024,
    signal: input.signal
  })
  if (actual !== input.expectedFingerprint) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work changed before processing')
  }
  return resolveSafeExistingPath(input.root, input.relativeDirectory, 'directory')
}

function mediaPageIndex(filename: string, artworkId: string, extension: string): number | null {
  if (filename.toLowerCase() === `${artworkId}${extension}`.toLowerCase()) return 0
  const escapedId = artworkId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = filename.match(new RegExp(`^${escapedId}_p(\\d+)${escapedExtension}$`, 'i'))
  const page = match?.[1] ? Number(match[1]) : Number.NaN
  return Number.isSafeInteger(page) && page >= 0 ? page : null
}

function inferMediaType(extension: string): 'IMAGE' | 'ANIMATION' | 'VIDEO' {
  if (videoExtensions.has(extension)) return 'VIDEO'
  if (animationExtensions.has(extension)) return 'ANIMATION'
  return 'IMAGE'
}

function naturalNameCompare(left: string, right: string): number {
  return compareNaturalCodePoints(left, right)
}

function withoutFilename(item: DiscoveredMediaFile & { filename: string }, sortOrder: number): DiscoveredMediaFile {
  return {
    relativePath: item.relativePath,
    size: item.size,
    sortOrder,
    mediaType: item.mediaType,
    webpAnimationStatus: item.webpAnimationStatus,
    chaptersPath: item.chaptersPath,
    chaptersCount: item.chaptersCount,
    chaptersDuration: item.chaptersDuration,
    chaptersHash: item.chaptersHash
  }
}

async function attachChapterManifests<T extends DiscoveredMediaFile>(
  root: SafeScanRoot,
  media: T[],
  signal: AbortSignal
): Promise<T[]> {
  const result: T[] = []
  for (const item of media) {
    throwIfAborted(signal)
    result.push(item.mediaType === 'VIDEO' ? await attachChapterManifest(root, item) : item)
  }
  return result
}

async function attachChapterManifest<T extends DiscoveredMediaFile>(root: SafeScanRoot, media: T): Promise<T> {
  const parsed = path.posix.parse(media.relativePath)
  const names = [`${parsed.name}.chapters.json`, `${parsed.base}.chapters.json`, `${parsed.name}..chapters.json`]
  for (const name of names) {
    const relativePath = parsed.dir ? `${parsed.dir}/${name}` : name
    let resolved: SafeScanPath
    try {
      resolved = await resolveSafeExistingPath(root, relativePath, 'file')
    } catch (error) {
      if (error instanceof ScanExecutorError && error.code === 'SOURCE_NOT_FOUND') continue
      throw error
    }
    try {
      const manifest = await readChapterManifest(root.absolutePath, resolved.relativePath)
      return {
        ...media,
        chaptersPath: resolved.relativePath,
        chaptersCount: manifest.chapters.length,
        chaptersDuration: manifest.duration,
        chaptersHash: createChapterManifestHash(manifest)
      }
    } catch (error) {
      if (error instanceof VideoProcessingPermanentError) {
        throw new ScanExecutorError(
          error.code === 'PATH_OUTSIDE_ALLOWED_ROOT' ? 'PATH_OUTSIDE_SCAN_ROOT' : 'INPUT_SNAPSHOT_INVALID',
          `Video chapter manifest is invalid: ${resolved.relativePath}`
        )
      }
      throw new ScanExecutorError(
        'SOURCE_NOT_READABLE',
        `Video chapter manifest cannot be read: ${resolved.relativePath}`
      )
    }
  }
  return media
}

async function readLocalMediaDimensions(
  absolutePath: string,
  mediaType: DiscoveredMediaFile['mediaType']
): Promise<{ width: number; height: number }> {
  if (mediaType === 'VIDEO') return { width: 0, height: 0 }
  try {
    const metadata = await sharp(absolutePath).metadata()
    return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  } catch {
    // Match the legacy importer: unreadable image metadata does not reject an otherwise valid media file.
    return { width: 0, height: 0 }
  }
}
