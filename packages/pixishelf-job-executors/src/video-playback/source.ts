import path from 'node:path'
import { inferMediaTypeFromPath } from '@pixishelf/job-contracts'
import { createHash } from 'node:crypto'
import { contentDirectoriesHaveWriter, type Prisma, type MediaVideoPlayback } from '@pixishelf/db'
import { inspectMediaContentFile, sameContentFileState } from '../media-content/file-reader.ts'
import { resolveMediaContentRoots, MediaContentFileError } from '../media-content/roots.ts'

export class VideoPlaybackUnavailable extends Error {
  constructor(readonly reason: 'MISSING' | 'WRITING' | 'CHANGED') {
    super(
      reason === 'WRITING'
        ? '原视频正在修改，请稍后重试'
        : reason === 'CHANGED'
          ? '原视频已变化，请重新生成播放副本'
          : '视频不存在或不可读取'
    )
  }
}

/** Shared by publication and HTTP reads: no hashing or media decoding here. */
export async function inspectVideoPlaybackSource(
  database: Prisma.TransactionClient,
  config: { sourceRoot: string; archiveRoot: string },
  imageId: number,
  signal: AbortSignal
) {
  const image = await database.image.findUnique({
    where: { id: imageId },
    include: { contentSource: true, artwork: { include: { contentSource: true } } }
  })
  if (
    !image?.artwork ||
    !image.artworkId ||
    (image.mediaType !== 'VIDEO' && inferMediaTypeFromPath(image.path) !== 'VIDEO') ||
    image.artwork.deletedAt ||
    image.artwork.archiveLifecycleState !== 'ACTIVE'
  )
    throw new VideoPlaybackUnavailable('MISSING')
  if (
    (await database.artworkDedupClaim.findUnique({ where: { artworkId: image.artworkId }, select: { role: true } }))
      ?.role === 'COPY'
  )
    throw new VideoPlaybackUnavailable('MISSING')
  if (image.contentSource?.writeToken || image.artwork.contentSource?.writeToken)
    throw new VideoPlaybackUnavailable('WRITING')
  const relativePath = image.path.replace(/^[/\\]+/, '')
  if (relativePath.split(/[\\/]/).some((part) => part.startsWith('.'))) throw new VideoPlaybackUnavailable('MISSING')
  const roots = await resolveMediaContentRoots({ ...config, expectedPixivRootIdentity: null })
  const archived = image.artwork.createdVia === 'URL_ARCHIVE'
  const root = archived ? roots.archive : roots.source
  const canonicalPath =
    archived && roots.archiveRelativePrefix ? `${roots.archiveRelativePrefix}/${relativePath}` : relativePath
  const dirname = path.posix.dirname(canonicalPath)
  const directory = {
    logicalRoot: root.logicalRoot,
    rootIdentity: root.rootIdentity,
    relativeDirectory: dirname === '.' ? '' : dirname
  }
  if (await contentDirectoriesHaveWriter(database, [directory])) throw new VideoPlaybackUnavailable('WRITING')
  let file
  try {
    file = await inspectMediaContentFile({ root, relativePath: canonicalPath, signal })
  } catch (error) {
    if (error instanceof MediaContentFileError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new VideoPlaybackUnavailable('MISSING')
    throw error
  }
  const revision = image.contentSource?.revision ?? 0n
  const mediaEpoch = image.artwork.contentSource?.mediaEpoch ?? 0n
  const version = createHash('sha256')
    .update(
      [
        image.path,
        revision,
        mediaEpoch,
        file.state.size,
        file.state.mtimeNs,
        file.state.ctimeNs,
        file.state.deviceId,
        file.state.inode
      ].join(':')
    )
    .digest('hex')
    .slice(0, 24)
  return { image, file, directory, revision, mediaEpoch, version }
}

export type VideoPlaybackSource = Awaited<ReturnType<typeof inspectVideoPlaybackSource>>

export function playbackMatchesSource(playback: MediaVideoPlayback, source: VideoPlaybackSource) {
  return (
    playback.sourcePath === source.image.path &&
    playback.sourceRevision === source.revision &&
    playback.sourceArtworkMediaEpoch === source.mediaEpoch &&
    sameContentFileState(source.file.state, {
      size: playback.sourceSize,
      mtimeNs: playback.sourceMtimeNs,
      ctimeNs: playback.sourceCtimeNs,
      deviceId: playback.sourceDeviceId,
      inode: playback.sourceInode
    })
  )
}
