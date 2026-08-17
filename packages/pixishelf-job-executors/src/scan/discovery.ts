import * as fs from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import { mapBounded, throwIfAborted } from './bounded.js'
import { hashStableFile } from './content-reader.js'
import { ScanExecutorError } from './errors.js'
import { computeLocalWorkContentFingerprintWithinRoot } from './fingerprint.js'
import {
  normalizeRelativeScanPath,
  relativeFromRoot,
  resolveSafeExistingPath,
  type SafeScanPath,
  type SafeScanRoot,
  walkSafeFiles
} from './paths.js'
import { metadataCandidateFromPath, selectPreferredMetadataCandidates, type MetadataCandidate } from './metadata.js'
import { compareCodePoints, compareNaturalCodePoints } from './stable-order.js'

const metadataSuffix = /-meta\.(?:json|txt)$/i
const mediaExtensions = new Set<string>(MEDIA_FILE_EXTENSIONS)
const videoExtensions = new Set<string>(VIDEO_FILE_EXTENSIONS)
const animationExtensions = new Set(['.gif', '.apng'])
const contentScannedAnimationExtensions = new Set(['.webp', '.gif', '.png', '.apng'])

export interface ScanDiscoveryLimits {
  pageSize: number
  maxDepth: number
  maxEntries: number
  maxMediaPerArtwork: number
  concurrency?: number
  maxMetadataBytes?: number
  maxManifestBytes?: number
  maxArchiveMediaBytes?: number
}

export interface FrozenMetadataCandidate extends MetadataCandidate {
  contentHash: string
}

export interface DiscoveredMediaFile {
  relativePath: string
  size: bigint
  sortOrder: number
  mediaType: 'IMAGE' | 'ANIMATION' | 'VIDEO'
  webpAnimationStatus: number | null
}

export interface LocalWorkCandidate {
  kind: 'MEDIA_DIRECTORY' | 'ARCHIVE_MANIFEST'
  artistDirectory: string
  relativePath: string
  title: string
  fingerprint: string
  mediaCount: number
}

export async function* discoverMetadataCandidatePages(
  root: SafeScanRoot,
  limits: ScanDiscoveryLimits,
  signal: AbortSignal
): AsyncGenerator<FrozenMetadataCandidate[]> {
  const candidates: MetadataCandidate[] = []
  for await (const page of walkSafeFiles(root, '', {
    pageSize: limits.pageSize,
    maxDepth: limits.maxDepth,
    maxEntries: limits.maxEntries,
    signal,
    include: (relativePath) => metadataSuffix.test(relativePath)
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
    const hashed = await mapBounded(page, limits.concurrency ?? 1, signal, async (candidate) => ({
      ...candidate,
      contentHash: (
        await hashStableFile({
          absolutePath: candidate.absolutePath,
          maxBytes: limits.maxMetadataBytes ?? 16 * 1024 * 1024,
          signal
        })
      ).sha256
    }))
    yield hashed
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
    selectPreferredMetadataCandidates(candidates).map(async (candidate) => ({
      ...candidate,
      contentHash: (await hashStableFile({ absolutePath: candidate.absolutePath, maxBytes: maxMetadataBytes, signal }))
        .sha256
    }))
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
        filename: entry.name
      })
      if (media.length > limits.maxMediaPerArtwork) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Artwork media count exceeds the configured limit')
      }
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  return media
    .sort((left, right) => left.sortOrder - right.sortOrder || compareCodePoints(left.filename, right.filename))
    .map((item, sortOrder) => withoutFilename(item, sortOrder))
}

export async function* discoverLocalWorkPages(
  root: SafeScanRoot,
  localDirectory: string,
  limits: ScanDiscoveryLimits,
  signal: AbortSignal
): AsyncGenerator<LocalWorkCandidate[]> {
  const localRoot = await resolveSafeExistingPath(root, normalizeRelativeScanPath(localDirectory), 'directory').catch(
    (error) => {
      if (error instanceof ScanExecutorError && error.code === 'SOURCE_NOT_FOUND') return null
      throw error
    }
  )
  if (!localRoot) return
  let page: LocalWorkCandidate[] = []
  let visitedEntries = 0

  async function* visit(
    directory: SafeScanPath,
    artistDirectory: string,
    depth: number
  ): AsyncGenerator<LocalWorkCandidate[]> {
    throwIfAborted(signal)
    if (depth > limits.maxDepth) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local import directory depth exceeds the configured limit')
    }
    const entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> = []
    const handle = await fs.opendir(directory.absolutePath)
    try {
      for await (const entry of handle) {
        throwIfAborted(signal)
        visitedEntries += 1
        if (visitedEntries > limits.maxEntries) {
          throw new ScanExecutorError(
            'INPUT_SNAPSHOT_INVALID',
            'Local import discovery exceeds the configured entry limit'
          )
        }
        const absolutePath = path.join(directory.absolutePath, entry.name)
        const metadata = await fs.lstat(absolutePath)
        if (metadata.isSymbolicLink()) {
          throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Local import discovery encountered a symbolic link')
        }
        entries.push({ name: entry.name, isDirectory: metadata.isDirectory(), isFile: metadata.isFile() })
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
    entries.sort((left, right) => compareCodePoints(left.name, right.name))
    const directMedia = entries.filter(
      (entry) => entry.isFile && mediaExtensions.has(path.extname(entry.name).toLowerCase())
    )
    const manifest = entries.find((entry) => entry.isFile && entry.name === 'manifest.json')
    if (depth > 0 && (manifest || directMedia.length > 0)) {
      if (directMedia.length > limits.maxMediaPerArtwork) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work media count exceeds the configured limit')
      }
      const relativePath = directory.relativePath
      const kind = manifest ? 'ARCHIVE_MANIFEST' : 'MEDIA_DIRECTORY'
      page.push({
        kind,
        artistDirectory,
        relativePath,
        title: path.posix.basename(relativePath),
        fingerprint: await computeLocalWorkContentFingerprintWithinRoot({
          root,
          relativeDirectory: directory.relativePath,
          kind,
          maxEntries: limits.maxEntries,
          maxFiles: limits.maxMediaPerArtwork,
          maxFileBytes:
            kind === 'ARCHIVE_MANIFEST'
              ? (limits.maxManifestBytes ?? 4 * 1024 * 1024)
              : (limits.maxArchiveMediaBytes ?? 4 * 1024 * 1024 * 1024),
          signal
        }),
        mediaCount: manifest ? 0 : directMedia.length
      })
      if (page.length === limits.pageSize) {
        const completed = page
        page = []
        yield completed
      }
    }
    if (manifest) return
    for (const child of entries.filter((entry) => entry.isDirectory)) {
      const childRelativePath = `${directory.relativePath}/${child.name}`
      yield* visit(
        { absolutePath: path.join(directory.absolutePath, child.name), relativePath: childRelativePath },
        artistDirectory,
        depth + 1
      )
    }
  }

  const artists = await readSafeDirectories(localRoot.absolutePath, () => {
    visitedEntries += 1
    if (visitedEntries > limits.maxEntries) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local import discovery exceeds the configured entry limit')
    }
  })
  for (const artist of artists) {
    yield* visit(
      {
        absolutePath: path.join(localRoot.absolutePath, artist),
        relativePath: `${localRoot.relativePath}/${artist}`
      },
      artist,
      0
    )
  }
  if (page.length > 0) yield page
}

export async function collectLocalMedia(
  root: SafeScanRoot,
  relativeDirectory: string,
  limits: Pick<ScanDiscoveryLimits, 'maxEntries' | 'maxMediaPerArtwork'>,
  signal: AbortSignal
): Promise<DiscoveredMediaFile[]> {
  const directory = await resolveSafeExistingPath(root, relativeDirectory, 'directory')
  const handle = await fs.opendir(directory.absolutePath)
  const media: Array<DiscoveredMediaFile & { filename: string }> = []
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
        filename: entry.name
      })
      if (media.length > limits.maxMediaPerArtwork) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work media count exceeds the configured limit')
      }
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  return media
    .sort((left, right) => naturalNameCompare(left.filename, right.filename))
    .map((item, sortOrder) => withoutFilename(item, sortOrder))
}

export async function verifyLocalWorkFingerprint(input: {
  root: SafeScanRoot
  relativeDirectory: string
  kind: 'MEDIA_DIRECTORY' | 'ARCHIVE_MANIFEST'
  expectedFingerprint: string | null
  limits: Pick<ScanDiscoveryLimits, 'maxEntries' | 'maxMediaPerArtwork' | 'maxManifestBytes' | 'maxArchiveMediaBytes'>
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
    maxFileBytes:
      input.kind === 'ARCHIVE_MANIFEST'
        ? (input.limits.maxManifestBytes ?? 4 * 1024 * 1024)
        : (input.limits.maxArchiveMediaBytes ?? 4 * 1024 * 1024 * 1024),
    signal: input.signal
  })
  if (actual !== input.expectedFingerprint) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work changed before processing')
  }
  return resolveSafeExistingPath(input.root, input.relativeDirectory, 'directory')
}

async function readSafeDirectories(directory: string, onEntry: () => void): Promise<string[]> {
  const result: string[] = []
  const handle = await fs.opendir(directory)
  try {
    for await (const entry of handle) {
      onEntry()
      const metadata = await fs.lstat(path.join(directory, entry.name))
      if (metadata.isSymbolicLink()) {
        throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Local artist directory is a symbolic link')
      }
      if (entry.name.startsWith('.')) continue
      if (metadata.isDirectory()) result.push(entry.name)
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
  return result.sort(compareCodePoints)
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
    webpAnimationStatus: item.webpAnimationStatus
  }
}
