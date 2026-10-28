import 'server-only'
import path from 'node:path'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { MobileError } from '@/lib/mobile/http'
import { isVideoFile } from '@/lib/media'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { getScanPath } from '@/services/setting.service'
import { requireArchiveStorageRoot } from '@/services/archive/config'
import { validateChapterManifest } from '@/services/artwork-service/video-chapters'
import { getPlayableVideoKeyframesByImageId } from '@/services/video-keyframe-read-service'

const manifestLimit = 5 * 1024 * 1024
function isVisibleRelative(value: string) {
  return Boolean(value) && !path.isAbsolute(value) && !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => part && !part.startsWith('.'))
}
async function visiblePath(root: string, stored: string) {
  if (!isVisibleRelative(stored)) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  const resolved = await resolveExistingPathWithinRoot(root, stored)
  if (!isVisibleRelative(path.relative(await realpath(root), resolved))) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  return resolved
}
async function chapterNavigation(root: string, stored: string | null) {
  if (!stored) return []
  let target: string
  try {
    // Older manifests store a root-relative leading slash; traversal and real hidden targets remain rejected.
    target = await visiblePath(root, stored.replace(/^\/+/, ''))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
    if (stat.size > manifestLimit) throw new MobileError(413, 'MANIFEST_TOO_LARGE')
    const parts: Buffer[] = []
    let size = 0
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const part = Buffer.from(chunk)
      size += part.length
      if (size > manifestLimit) throw new MobileError(413, 'MANIFEST_TOO_LARGE')
      parts.push(part)
    }
    const manifest = await validateChapterManifest(JSON.parse(Buffer.concat(parts).toString('utf8')))
    return manifest.chapters.map((chapter) => ({ index: chapter.index, title: chapter.title,
      start: chapter.start, end: chapter.end }))
  } finally {
    await file.close()
  }
}

/** Only timestamps leave this transport; derived media paths and manifest diagnostics remain server-side. */
export async function mobileVideoNavigation(id: number, revision: number) {
  const image = await prisma.image.findUnique({ where: { id }, select: {
    artworkId: true, path: true, mediaType: true, chaptersPath: true,
    artwork: { select: { mediaRevision: true, createdVia: true, deletedAt: true, archiveLifecycleState: true } }
  } })
  if (!image?.artworkId || !image.artwork || image.artwork.deletedAt || image.artwork.archiveLifecycleState !== 'ACTIVE') {
    throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  }
  if (image.artwork.mediaRevision !== revision) throw new MobileError(409, 'MEDIA_CHANGED')
  if ((await prisma.artworkDedupClaim.findUnique({ where: { artworkId: image.artworkId }, select: { role: true } }))?.role === 'COPY') {
    throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  }
  if (image.mediaType !== 'VIDEO' && !isVideoFile(image.path)) throw new MobileError(400, 'NOT_VIDEO')
  const root = image.artwork.createdVia === 'URL_ARCHIVE' ? await requireArchiveStorageRoot() : await getScanPath()
  if (!root) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  await visiblePath(root, image.path)
  const [chapters, keyframes] = await Promise.all([
    chapterNavigation(root, image.chaptersPath),
    getPlayableVideoKeyframesByImageId(id)
  ])
  return { chapters, frames: (keyframes?.frames ?? []).map((frame) => ({
    id: frame.id, captureTime: frame.captureTime, selectedOrder: frame.selectedOrder
  })) }
}
