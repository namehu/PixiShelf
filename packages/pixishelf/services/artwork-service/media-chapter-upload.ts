import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { isVideoFile } from '@/lib/media'
import { buildCanonicalChapterFileName, isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import {
  discoverChaptersForVideoInScanRoot,
  getChapterPathCandidates,
  resolveCanonicalChapterPath,
  validateChapterManifest
} from './video-chapters'
import { associateChaptersToImage } from './image-manager'
import { determineArtworkRelDir } from './utils'

export const MAX_CHAPTER_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024

export type MediaChapterUploadInput = {
  scanRoot: string
  artworkId: number
  imageId: number | null
  videoPath: string
  manifestText: string | (() => Promise<string>)
}

export type MediaChapterUploadMeta = {
  videoFileName: string
  chaptersFileName: string
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}

export class MediaChapterUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'MediaChapterUploadError'
  }
}

export function validateMediaChapterUploadRequest(input: { artworkId: number; fileName: string; fileSize: number }) {
  const { artworkId, fileName, fileSize } = input

  if (!artworkId || Number.isNaN(artworkId)) {
    throw new MediaChapterUploadError('Invalid artworkId', 400)
  }

  if (!isChapterManifestFileName(fileName)) {
    throw new MediaChapterUploadError('Unsupported chapter manifest file name', 400)
  }

  if (fileSize > MAX_CHAPTER_UPLOAD_SIZE_BYTES) {
    throw new MediaChapterUploadError('Chapter manifest exceeds 5MB limit', 400)
  }
}

export async function uploadMediaChapterManifest(input: MediaChapterUploadInput): Promise<MediaChapterUploadMeta> {
  const { scanRoot, artworkId, imageId } = input

  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: {
      artist: true,
      images: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  })

  if (!artwork) {
    throw new MediaChapterUploadError('Artwork not found', 404)
  }

  const targetRelDir = determineArtworkRelDir(artwork)
  if (!targetRelDir) {
    throw new MediaChapterUploadError('Cannot determine artwork media directory', 400)
  }

  let videoPath = input.videoPath
  if (imageId) {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      select: { id: true, artworkId: true, path: true }
    })

    if (!image || image.artworkId !== artworkId) {
      throw new MediaChapterUploadError('Image not found for artwork', 404)
    }

    videoPath = image.path
  }

  if (!videoPath) {
    throw new MediaChapterUploadError('Missing videoPath or imageId', 400)
  }

  const normalizedVideoPath = toStoredPath(videoPath)
  if (!isVideoFile(normalizedVideoPath)) {
    throw new MediaChapterUploadError('Chapter manifest can only be attached to video media', 400)
  }

  if (!isStoredPathWithinDir(normalizedVideoPath, targetRelDir)) {
    throw new MediaChapterUploadError('Video path does not belong to artwork media directory', 400)
  }

  const manifestText = typeof input.manifestText === 'function' ? await input.manifestText() : input.manifestText
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(manifestText)
  } catch {
    throw new MediaChapterUploadError('Invalid chapter manifest JSON', 400)
  }

  let manifest
  try {
    manifest = await validateChapterManifest(manifestJson)
  } catch (error: any) {
    throw new MediaChapterUploadError(error.message || 'Invalid chapter manifest', 400)
  }

  const canonicalChaptersPath = resolveCanonicalChapterPath(normalizedVideoPath)
  const canonicalAbsolutePath = resolvePathWithinScanRoot(scanRoot, canonicalChaptersPath)
  await fs.mkdir(path.dirname(canonicalAbsolutePath), { recursive: true })
  await fs.writeFile(canonicalAbsolutePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  for (const candidate of getChapterPathCandidates(normalizedVideoPath)) {
    if (candidate === canonicalChaptersPath) continue
    const candidateAbsolutePath = resolvePathWithinScanRoot(scanRoot, candidate)
    await fs.rm(candidateAbsolutePath, { force: true }).catch(() => {})
  }

  const chaptersMeta = await discoverChaptersForVideoInScanRoot(scanRoot, normalizedVideoPath)
  if (!chaptersMeta) {
    throw new MediaChapterUploadError('Failed to discover uploaded chapter manifest', 500)
  }

  if (imageId) {
    await associateChaptersToImage({
      imageId,
      ...chaptersMeta
    })
  }

  return {
    videoFileName: path.posix.basename(normalizedVideoPath.replace(/\\/g, '/')),
    chaptersFileName: buildCanonicalChapterFileName(path.posix.basename(normalizedVideoPath.replace(/\\/g, '/'))),
    ...chaptersMeta
  }
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}

function toStoredPath(input: string): string {
  const normalizedPath = input.replace(/\\/g, '/')
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
}

function isStoredPathWithinDir(storedPath: string, storedDir: string): boolean {
  const normalizedPath = toStoredPath(storedPath)
  const normalizedDir = toStoredPath(storedDir).replace(/\/+$/, '')
  return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}/`)
}
