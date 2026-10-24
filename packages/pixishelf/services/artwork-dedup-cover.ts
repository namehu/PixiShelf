import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Prisma } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { isVideoCoverSource, VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { getMediaMimeType } from '@/utils/media'
import { getScanPath } from './setting.service'
import { requireArchiveStorageRoot } from './archive/config'
import { VIDEO_POSTER_STORAGE_ROOT, resolveDerivedMediaStoragePath } from './derived-media-storage-paths'

const imageMime = (file: string) => {
  const mime = getMediaMimeType(file)
  return mime?.startsWith('image/') && mime !== 'image/svg+xml' ? mime : null
}
const safeRelative = (value: string) =>
  !!value &&
  !path.isAbsolute(value) &&
  !/^[A-Za-z]:/.test(value) &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  value.split('/').every((part) => !!part && !part.startsWith('.'))
export async function artworkDedupCoverUrls(
  tx: Prisma.TransactionClient,
  ids: number[],
  userId: string
): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  if (ids.length > 500) throw new RangeError('Too many cover artworks')
  const rows = await tx.$queryRaw<
    { id: number; path: string; mediaType: string; posterStatus: string | null; posterPath: string | null }[]
  >(Prisma.sql`
    SELECT a.id,i.path,i."mediaType",v."posterStatus",v."posterPath" FROM "Artwork" a
    JOIN LATERAL(SELECT id,path,"mediaType" FROM "Image" WHERE "artworkId"=a.id ORDER BY "sortOrder",id LIMIT 1)i ON true
    LEFT JOIN "MediaVideoMetadata" v ON v."imageId"=i.id
    WHERE a.id IN(${Prisma.join(ids)}) AND a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE'
      AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c WHERE c."artworkId"=a.id AND c.role='COPY')`)
  return new Map(
    rows
      .filter((row) =>
        isVideoCoverSource(row)
          ? row.posterStatus === 'COMPLETED' &&
            !!row.posterPath &&
            safeRelative(row.posterPath) &&
            !!imageMime(row.posterPath)
          : safeRelative(row.path) && !!imageMime(row.path)
      )
      .map((row) => [row.id, `/api/artwork-dedup/cover/${row.id}?expectedUserId=${encodeURIComponent(userId)}`])
  )
}
/** Reads one registered visible cover; paths remain server-side and existing posters are reused. */
export async function openArtworkDedupCover(artworkId: number) {
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    select: {
      deletedAt: true,
      archiveLifecycleState: true,
      createdVia: true,
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { path: true, mediaType: true, videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT } }
      }
    }
  })
  if (!artwork || artwork.deletedAt || artwork.archiveLifecycleState !== 'ACTIVE') return null
  if ((await prisma.artworkDedupClaim.findUnique({ where: { artworkId }, select: { role: true } }))?.role === 'COPY')
    {return null}
  const media = artwork.images[0]
  if (!media) return null
  const video = isVideoCoverSource(media)
  const relative = video
    ? media.videoMetadata?.posterStatus === 'COMPLETED'
      ? media.videoMetadata.posterPath
      : null
    : media.path
  if (!relative || !safeRelative(relative)) return null
  const contentType = imageMime(relative)
  if (!contentType) return null
  const root = video
    ? VIDEO_POSTER_STORAGE_ROOT
    : artwork.createdVia === 'URL_ARCHIVE'
      ? await requireArchiveStorageRoot()
      : await getScanPath()
  if (!root) return null
  const candidate = video ? resolveDerivedMediaStoragePath(root, relative) : relative
  try {
    const target = await resolveExistingPathWithinRoot(root, candidate)
    if (!safeRelative(path.relative(await realpath(root), target))) return null
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) {
        await handle.close()
        return null
      }
      return {
        body: Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream<Uint8Array>,
        contentType,
        size: stat.size
      }
    } catch (error) {
      await handle.close()
      throw error
    }
  } catch {
    return null
  }
}
