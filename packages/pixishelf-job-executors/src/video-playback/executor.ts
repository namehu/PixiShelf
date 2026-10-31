import path from 'node:path'
import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  Prisma,
  captureMediaContentDirectory,
  assertMediaContentDirectorySnapshot,
  type PrismaClient
} from '@pixishelf/db'
import { videoPlaybackGenerationPayloadSchema } from '@pixishelf/job-contracts'
import type { ExecutorDefinition } from '@pixishelf/job-runtime'
import { runVideoProcess } from '../video-processing/process-runner.ts'
import type { VideoProcessRunner } from '../video-processing/types.ts'
import { resolvePosterOutput } from '../video-media/paths.ts'
import { inspectVideoPlaybackSource, VideoPlaybackUnavailable } from './source.ts'
import { playbackEncoding, probePlaybackFile, validatePlaybackOutput } from './media-process.ts'

type Payload = ReturnType<typeof videoPlaybackGenerationPayloadSchema.parse>
export function createVideoPlaybackExecutor(dependencies: {
  database: PrismaClient
  config: { sourceRoot: string; archiveRoot: string; playbackRoot: string; ffmpegPath?: string; ffprobePath?: string }
  processRunner?: VideoProcessRunner
}): ExecutorDefinition {
  const { database, config } = dependencies
  const runner = dependencies.processRunner ?? runVideoProcess
  const definition: ExecutorDefinition<Payload> = {
    jobType: 'VIDEO_PLAYBACK_GENERATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: 1,
    progressPolicy: 'STANDARD',
    parsePayload: (value) => videoPlaybackGenerationPayloadSchema.parse(value),
    async execute(context) {
      let finalizing = false
      let temporaryPath: string | undefined
      let progressWork = Promise.resolve()
      try {
        const source = await inspectVideoPlaybackSource(database, config, context.payload.imageId, context.signal)
        if (source.image.path.replace(/^[/\\]+/, '') !== context.payload.relativePath)
          throw new VideoPlaybackUnavailable('CHANGED')
        const directory = await context.mutateInTransaction<
          Prisma.TransactionClient,
          Awaited<ReturnType<typeof captureMediaContentDirectory>>
        >((tx) => captureMediaContentDirectory(tx, { directory: source.directory }))
        if (directory.status !== 'READY') throw new VideoPlaybackUnavailable('WRITING')
        const generationId = randomUUID()
        const relativePath = `${source.image.id}/${generationId}.mp4`
        const temporaryRelativePath = `${source.image.id}/${generationId}.tmp.mp4`
        // Intents survive a process crash or a rollback after filesystem rename.
        await context.mutateInTransaction<Prisma.TransactionClient>(async (tx) => {
          await tx.derivedMediaGcEntry.createMany({
            data: [relativePath, temporaryRelativePath].map((file) => ({
              mediaKind: 'VIDEO_PLAYBACK',
              relativePath: file,
              referenceType: 'MEDIA_VIDEO_PLAYBACK',
              referenceId: String(source.image.id),
              reason: 'PLAYBACK_ATTEMPT',
              notBefore: new Date(Date.now() + 24 * 60 * 60_000),
              lastSystemJobId: context.job.id
            }))
          })
        })
        const outputPath = await resolvePosterOutput(config.playbackRoot, relativePath)
        await fs.mkdir(path.dirname(outputPath), { recursive: true })
        temporaryPath = await resolvePosterOutput(config.playbackRoot, temporaryRelativePath)
        await context.progress({ progress: 1, stage: 'PROBING', message: '正在检查原视频' })
        const probe = await probePlaybackFile({
          file: source.file.absolutePath,
          runner,
          ffprobe: config.ffprobePath ?? 'ffprobe',
          signal: context.signal
        })
        const encoding = playbackEncoding(probe, source.file.absolutePath, temporaryPath)
        let pending = '',
          lastProgress = 0
        await runner({
          command: config.ffmpegPath ?? 'ffmpeg',
          args: encoding.args,
          timeoutMs: Math.max(30 * 60_000, probe.format.duration * 30_000),
          signal: context.signal,
          onStdout(chunk) {
            pending += chunk
            const lines = pending.split('\n')
            pending = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('out_time_us=') || Date.now() - lastProgress < 2000) continue
              const seconds = Number(line.slice(12)) / 1_000_000
              if (!Number.isFinite(seconds)) continue
              lastProgress = Date.now()
              progressWork = progressWork
                .then(() =>
                  context.progress({
                    progress: Math.round(Math.min(94, 2 + (seconds / probe.format.duration) * 92)),
                    stage: 'ENCODING',
                    message: '正在生成 1080p 播放副本'
                  })
                )
                .then(() => undefined)
              // Preserve the rejection for the awaited chain without an unhandled callback promise.
              void progressWork.catch(() => undefined)
            }
          }
        })
        await progressWork
        context.signal.throwIfAborted()
        const output = await probePlaybackFile({
          file: temporaryPath,
          runner,
          ffprobe: config.ffprobePath ?? 'ffprobe',
          signal: context.signal
        })
        validatePlaybackOutput(output, { ...encoding, duration: probe.format.duration })
        const outputStat = await fs.stat(temporaryPath, { bigint: true })
        if (outputStat.size >= source.file.state.size)
          return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '副本未小于原片，无需保留' }
        await context.progress({ progress: 96, stage: 'VALIDATING', message: '正在验证并发布播放副本' })
        finalizing = true
        return await context.finalizeInTransaction<Prisma.TransactionClient>(async (scope) => {
          if (scope.executionStatus === 'PAUSING') {
            await scope.pause({ reason: 'USER_REQUESTED', message: '副本生成已暂停，恢复后重新编码' })
            return
          }
          if (scope.executionStatus === 'CANCELLING') {
            await scope.cancel('副本生成已取消，原片未修改')
            return
          }
          if (context.signal.aborted) {
            await scope.release('Worker 已停止，副本未发布')
            return
          }
          const tx = scope.transaction
          const checked = await assertMediaContentDirectorySnapshot(tx, { snapshot: directory.value })
          if (checked.status !== 'READY') {
            await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '原视频目录已变化，请重新生成' })
            return
          }
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artwork" WHERE id = ${source.image.artworkId} FOR UPDATE`)
          let current
          try {
            current = await inspectVideoPlaybackSource(tx, config, source.image.id, context.signal)
          } catch (error) {
            if (!(error instanceof VideoPlaybackUnavailable)) throw error
            await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: error.message })
            return
          }
          if (current.version !== source.version || current.image.artworkId !== source.image.artworkId) {
            await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '原视频已变化，请重新生成播放副本' })
            return
          }
          await fs.rename(temporaryPath!, outputPath)
          const state = source.file.state
          const data = {
            generationId,
            sourcePath: source.image.path,
            sourceRevision: source.revision,
            sourceArtworkMediaEpoch: source.mediaEpoch,
            sourceSize: state.size,
            sourceMtimeNs: state.mtimeNs,
            sourceCtimeNs: state.ctimeNs,
            sourceDeviceId: state.deviceId,
            sourceInode: state.inode,
            profileVersion: 1,
            relativePath,
            outputSize: outputStat.size,
            duration: output.format.duration,
            width: encoding.width,
            height: encoding.height,
            publishedAt: new Date()
          }
          await tx.mediaVideoPlayback.upsert({
            where: { imageId: source.image.id },
            create: { imageId: source.image.id, ...data },
            update: data
          })
          await tx.derivedMediaGcEntry.deleteMany({
            where: {
              mediaKind: 'VIDEO_PLAYBACK',
              relativePath: { in: [relativePath, temporaryRelativePath] },
              reason: 'PLAYBACK_ATTEMPT'
            }
          })
          await scope.complete({
            message: '播放副本生成完成',
            result: {
              imageId: source.image.id,
              generationId,
              outputSize: Number(outputStat.size),
              sourceSize: Number(state.size)
            }
          })
        })
      } catch (error) {
        await progressWork.catch(() => undefined)
        if (finalizing) throw error
        if (context.signal.aborted)
          return context.finalizeInTransaction(async (scope) => {
            if (scope.executionStatus === 'CANCELLING') await scope.cancel('副本生成已取消，原片未修改')
            else if (scope.executionStatus === 'PAUSING')
              await scope.pause({ reason: 'USER_REQUESTED', message: '副本生成已暂停，恢复后重新编码' })
            else await scope.release('Worker 已停止，副本未发布')
          })
        const message =
          error instanceof VideoPlaybackUnavailable ||
          (error instanceof Error && /^(暂不支持 HDR|视频没有可转码|播放副本校验失败)/.test(error.message))
            ? error.message
            : '播放副本生成失败，请检查视频格式、FFmpeg 和存储空间'
        context.logger.error('video.playback.failed', error, { jobId: context.job.id })
        return { kind: 'failed', errorCode: 'PRECONDITION_FAILED', error: message, message }
      } finally {
        if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      }
    }
  }
  return definition as ExecutorDefinition
}
