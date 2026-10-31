import 'server-only'
import { inferMediaTypeFromPath } from '@pixishelf/job-contracts'
import path from 'node:path'
import { constants } from 'node:fs'
import { open, stat, realpath } from 'node:fs/promises'
import { TRPCError } from '@trpc/server'
import {
  inspectVideoPlaybackSource,
  playbackMatchesSource,
  VideoPlaybackUnavailable,
  sameContentFileState
} from '@pixishelf/job-executors/media-content'
import { prisma as appPrisma } from '@/lib/prisma'
import type { PrismaClient } from '@pixishelf/db'
const prisma = appPrisma as unknown as PrismaClient
import { resolveExistingPathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import { parseByteRange } from '@/lib/byte-range'
import { getScanPath } from './setting.service'
import { requireArchiveStorageRoot } from './archive/config'
import { VIDEO_PLAYBACK_STORAGE_ROOT } from './derived-media-storage-paths'
import { enqueueJob } from './background-task'
import { latestMediaJobs } from './background-task/media-job-query'
import { lockActiveVideoPlayback } from './video-playback-lock'

export const videoPlaybackHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer'
}

export async function submitVideoPlayback(imageIds: number[], requestedByUserId: string) {
  const results = []
  for (const imageId of new Set(imageIds)) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const active = await lockActiveVideoPlayback(tx, imageId)
        const image = await tx.image.findFirst({
          where: {
            id: imageId,
            artwork: { is: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } }
          },
          select: { path: true, artworkId: true, mediaType: true }
        })
        if (
          !image?.artworkId ||
          (image.mediaType !== 'VIDEO' && inferMediaTypeFromPath(image.path) !== 'VIDEO') ||
          (await tx.artworkDedupClaim.findUnique({ where: { artworkId: image.artworkId }, select: { role: true } }))
            ?.role === 'COPY'
        ) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '视频不可用' })
        }
        if (active) return { imageId, jobId: active.id, reused: true }
        const job = await enqueueJob(
          {
            type: 'VIDEO_PLAYBACK_GENERATION',
            triggerSource: 'MANUAL',
            requestedByUserId,
            priority: 10,
            maxAttempts: 1,
            payload: { imageId, relativePath: image.path.replace(/^[/\\]+/, ''), mode: 'SDR_1080P_V1' }
          },
          { $transaction: (operation) => operation(tx) }
        )
        return { imageId, jobId: job.id, reused: false }
      })
      results.push({ ...result, error: null })
    } catch (error) {
      results.push({
        imageId,
        jobId: null,
        reused: false,
        error: error instanceof TRPCError ? error.message : '提交失败，请重试'
      })
    }
  }
  return results
}

export async function videoPlaybackStatuses(imageIds: number[]) {
  const [copies, jobs] = await Promise.all([
    prisma.mediaVideoPlayback.findMany({
      where: { imageId: { in: imageIds } },
      select: { imageId: true, outputSize: true, width: true, height: true, publishedAt: true }
    }),
    latestMediaJobs('VIDEO_PLAYBACK_GENERATION', imageIds)
  ])
  return imageIds.map((imageId) => {
    const copy = copies.find((c) => c.imageId === imageId)
    const job = jobs.find((j) => j.targetImageId === imageId)
    return {
      imageId,
      copy: copy ? { ...copy, publishedAt: copy.publishedAt.toISOString(), outputSize: Number(copy.outputSize) } : null,
      job: job ? { id: job.id, status: job.status, progress: job.progress, message: job.error ?? job.message } : null
    }
  })
}

export async function removeVideoPlayback(imageId: number) {
  return prisma.$transaction(async (tx) => {
    if (await lockActiveVideoPlayback(tx, imageId)) {
      throw new TRPCError({ code: 'CONFLICT', message: '请先取消正在生成的任务，再清理副本' })
    }
    await tx.mediaVideoPlayback.deleteMany({ where: { imageId } })
    return { success: true }
  })
}

async function resolveSource(imageId: number) {
  const sourceRoot = await getScanPath()
  if (!sourceRoot) throw new VideoPlaybackUnavailable('MISSING')
  return inspectVideoPlaybackSource(
    prisma,
    { sourceRoot, archiveRoot: await requireArchiveStorageRoot() },
    imageId,
    AbortSignal.timeout(30_000)
  )
}

async function validPlayback(imageId: number, source: Awaited<ReturnType<typeof resolveSource>>) {
  const copy = await prisma.mediaVideoPlayback.findUnique({ where: { imageId } })
  if (!copy) return null
  if (playbackMatchesSource(copy, source)) {
    try {
      const file = await resolveExistingPathWithinRoot(VIDEO_PLAYBACK_STORAGE_ROOT, copy.relativePath)
      const metadata = await stat(file, { bigint: true })
      const relative = path.relative(await realpath(VIDEO_PLAYBACK_STORAGE_ROOT), file)
      if (
        metadata.isFile() &&
        metadata.size === copy.outputSize &&
        relative.split(path.sep).every((part) => !part.startsWith('.'))
      ) {
        return { copy, file }
      }
    } catch (error) {
      if (
        !(error instanceof UnsafePathError) &&
        !['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error
      }
    }
  }
  // Retire only the observed generation; the DB trigger records its GC intent.
  await prisma.mediaVideoPlayback.deleteMany({ where: { imageId, generationId: copy.generationId } })
  return null
}

export async function getVideoPlaybackSource(imageId: number) {
  try {
    const source = await resolveSource(imageId)
    const playback = await validPlayback(imageId, source)
    const base = `/api/v1/media/${imageId}/playback`
    return {
      status: 'READY' as const,
      originalUrl: `${base}?original=${source.version}`,
      playbackUrl: playback ? `${base}?generation=${playback.copy.generationId}` : null
    }
  } catch (error) {
    if (!(error instanceof VideoPlaybackUnavailable)) throw error
    if (error.reason === 'MISSING') await prisma.mediaVideoPlayback.deleteMany({ where: { imageId } })
    return { status: error.reason, originalUrl: null, playbackUrl: null }
  }
}

export async function openVideoPlayback(
  imageId: number,
  variant: { generation: string } | { original: string },
  range: string | null,
  signal?: AbortSignal
) {
  const source = await resolveSource(imageId)
  let filePath = source.file.absolutePath
  if ('generation' in variant) {
    const playback = await validPlayback(imageId, source)
    if (!playback || playback.copy.generationId !== variant.generation) throw new VideoPlaybackUnavailable('CHANGED')
    filePath = playback.file
  } else if (source.version !== variant.original) throw new VideoPlaybackUnavailable('CHANGED')
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = await handle.stat({ bigint: true })
    if (
      'original' in variant &&
      !sameContentFileState(source.file.state, {
        size: opened.size,
        mtimeNs: opened.mtimeNs,
        ctimeNs: opened.ctimeNs,
        deviceId: opened.dev,
        inode: opened.ino
      })
    ) {
      throw new VideoPlaybackUnavailable('CHANGED')
    }
    const metadata = { size: Number(opened.size), isFile: () => opened.isFile() }
    if (!metadata.isFile()) throw new VideoPlaybackUnavailable('MISSING')
    const bytes = parseByteRange(range, metadata.size)
    if (bytes === false) {
      await handle.close()
      return new Response(null, {
        status: 416,
        headers: { ...videoPlaybackHeaders, 'Content-Range': `bytes */${metadata.size}` }
      })
    }
    const headers: Record<string, string> = {
      ...videoPlaybackHeaders,
      'Content-Type': 'generation' in variant ? 'video/mp4' : videoContentType(source.image.path),
      'Accept-Ranges': 'bytes',
      'Content-Length': String(bytes ? bytes.end - bytes.start + 1 : metadata.size)
    }
    if (bytes) headers['Content-Range'] = `bytes ${bytes.start}-${bytes.end}/${metadata.size}`
    let offset = bytes ? bytes.start : 0
    let remaining = bytes ? bytes.end - bytes.start + 1 : metadata.size
    let closed = false
    let onAbort: () => void
    const close = async () => {
      closed = true
      signal?.removeEventListener('abort', onAbort)
      await handle.close()
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        onAbort = () => {
          if (closed) return
          controller.error(signal?.reason)
          void close()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) onAbort()
      },
      async pull(controller) {
        try {
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
          // A source switch can close the response during an outstanding disk read.
          if (closed) return
          offset += bytesRead
          remaining -= bytesRead
          if (bytesRead) controller.enqueue(buffer.subarray(0, bytesRead))
          if (!bytesRead || remaining === 0) {
            controller.close()
            await close()
          }
        } catch (error) {
          if (!closed) {
            controller.error(error)
            await close()
          }
        }
      },
      cancel: close
    })
    return new Response(body, { status: bytes ? 206 : 200, headers })
  } catch (error) {
    await handle.close()
    throw error
  }
}

function videoContentType(file: string) {
  const extension = path.extname(file).toLowerCase()
  return (
    (
      {
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo'
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  )
}
