import 'server-only'
import sharp from 'sharp'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { prisma } from '@/lib/prisma'
import { openArtworkDedupCover } from '@/services/artwork-dedup-cover'
import { MobileError, mobileHeaders } from '@/lib/mobile/http'
import { getScanPath } from '@/services/setting.service'
import { requireArchiveStorageRoot } from '@/services/archive/config'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { getMediaMimeType } from '@/utils/media'
import { parseMobileRange } from '@/lib/mobile/range'

let activePreviews = 0
function safeRelative(value: string) {
  return (
    !!value &&
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.split('/').every((part) => !!part && !part.startsWith('.'))
  )
}
/** Streams registered originals without redirecting or forwarding credentials to ImgProxy. */
export async function openMobileMedia(
  id: number,
  revision: number,
  variant: 'preview' | 'thumbnail' | 'original',
  range?: string | null
) {
  const image = await prisma.image.findUnique({
    where: { id },
    select: {
      artworkId: true,
      path: true,
      mediaType: true,
      artwork: {
        select: {
          mediaRevision: true,
          createdVia: true,
          deletedAt: true,
          archiveLifecycleState: true
        }
      }
    }
  })
  if (
    !image?.artwork ||
    !image.artworkId ||
    image.artwork.deletedAt ||
    image.artwork.archiveLifecycleState !== 'ACTIVE'
  )
    {throw new MobileError(404, 'MEDIA_UNAVAILABLE')}
  if (image.artwork.mediaRevision !== revision) throw new MobileError(409, 'MEDIA_CHANGED')
  if (
    (await prisma.artworkDedupClaim.findUnique({ where: { artworkId: image.artworkId }, select: { role: true } }))
      ?.role === 'COPY'
  )
    {throw new MobileError(404, 'MEDIA_UNAVAILABLE')}
  if (variant !== 'original') {
    const media = await openArtworkDedupCover(image.artworkId, id)
    if (!media) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
    if (media.size > 64 * 1024 * 1024) {
      await media.body.cancel()
      throw new MobileError(413, 'MEDIA_TOO_LARGE')
    }
    if (activePreviews >= 2) {
      await media.body.cancel()
      throw new MobileError(429, 'PREVIEW_BUSY')
    }
    activePreviews++
    try {
      const bytes = await new Response(media.body).arrayBuffer()
      const preview = await sharp(Buffer.from(bytes), { animated: false, limitInputPixels: 100_000_000 })
        .resize({ width: variant === 'thumbnail' ? 512 : 2048, height: variant === 'thumbnail' ? 512 : 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant === 'thumbnail' ? 78 : 85 })
        .toBuffer()
      return new Response(new Uint8Array(preview), { headers: { ...mobileHeaders, 'Content-Type': 'image/webp' } })
    } finally {
      activePreviews--
    }
  }
  if (!safeRelative(image.path)) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  const contentType = path.extname(image.path).toLowerCase() === '.apng' ? 'image/apng' : getMediaMimeType(image.path)
  if (
    !contentType ||
    (!contentType.startsWith('image/') && !contentType.startsWith('video/')) ||
    contentType === 'image/svg+xml'
  )
    {throw new MobileError(415, 'UNSUPPORTED_MEDIA')}
  const root = image.artwork.createdVia === 'URL_ARCHIVE' ? await requireArchiveStorageRoot() : await getScanPath()
  if (!root) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  let target: string
  try {
    target = await resolveExistingPathWithinRoot(root, image.path)
    if (!safeRelative(path.relative(await realpath(root), target))) throw new Error('hidden')
  } catch {
    throw new MobileError(404, 'MEDIA_UNAVAILABLE')
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new MobileError(404, 'MEDIA_UNAVAILABLE')
    if (contentType.startsWith('image/') && stat.size > 64 * 1024 * 1024) throw new MobileError(413, 'MEDIA_TOO_LARGE')
    const bytes = parseMobileRange(range, stat.size)
    if (bytes === false) {
      await file.close()
      return new Response(null, { status: 416, headers: { ...mobileHeaders, 'Content-Range': `bytes */${stat.size}` } })
    }
    const headers: Record<string, string> = {
      ...mobileHeaders,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(bytes ? bytes.end - bytes.start + 1 : stat.size)
    }
    if (bytes) headers['Content-Range'] = `bytes ${bytes.start}-${bytes.end}/${stat.size}`
    const body = Readable.toWeb(
      file.createReadStream({ autoClose: true, ...(bytes || {}) })
    ) as ReadableStream<Uint8Array>
    return new Response(body, { status: bytes ? 206 : 200, headers })
  } catch (error) {
    await file.close()
    throw error
  }
}
