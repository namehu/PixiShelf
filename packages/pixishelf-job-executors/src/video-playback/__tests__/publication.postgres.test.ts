import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, stat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import type { ExecutionContext, EnqueuedChildJob, FencedExecutionTransaction } from '@pixishelf/job-runtime'
import { executeDerivedMediaGc } from '../../video-media/gc.ts'
import { createVideoPlaybackExecutor } from '../executor.ts'
import { inspectVideoPlaybackSource, playbackMatchesSource } from '../source.ts'
import { runVideoProcess } from '../../video-processing/process-runner.ts'
import { spawnSync } from 'node:child_process'
import type { VideoProcessRunner } from '../../video-processing/types.ts'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback playback fixture')
afterAll(() => db?.$disconnect())

describe.skipIf(!db)('playback publication and retirement', () => {
  async function fixture(
    test: (input: {
      tx: Prisma.TransactionClient
      root: string
      imageId: number
      jobId: string
      sourceFile: string
    }) => Promise<void>
  ) {
    const root = await mkdtemp(path.join(tmpdir(), 'playback-publish-'))
    try {
      await expect(
        db!.$transaction(
          async (tx) => {
            const artwork = await tx.artwork.create({ data: { title: 'playback fixture' } })
            const relativePath = `${randomUUID()}/source.mp4`
            const image = await tx.image.create({
              data: { artworkId: artwork.id, path: relativePath, mediaType: 'VIDEO', size: 2000n }
            })
            const job = await tx.systemJob.create({ data: { type: 'VIDEO_PLAYBACK_GENERATION' } })
            const sourceFile = path.join(root, relativePath)
            await mkdir(path.dirname(sourceFile))
            await writeFile(sourceFile, Buffer.alloc(2000, 7))
            await test({ tx, root, imageId: image.id, jobId: job.id, sourceFile })
            throw rollback
          },
          { timeout: 30_000 }
        )
      ).rejects.toBe(rollback)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
  async function execute(
    input: { tx: Prisma.TransactionClient; root: string; imageId: number; jobId: string; sourceFile: string },
    options: {
      runner?: VideoProcessRunner
      afterEncode?: () => Promise<void>
      outputSize?: number
      abort?: boolean
      failPublication?: boolean
    } = {}
  ) {
    const { tx, root, imageId, jobId } = input
    const controller = new AbortController()
    const runner: VideoProcessRunner = async (request) => {
      if (request.command === 'ffmpeg') {
        await writeFile(request.args.at(-1)!, Buffer.alloc(options.outputSize ?? 400, 8))
        await options.afterEncode?.()
        if (options.abort) {
          controller.abort()
          throw new Error('aborted')
        }
        return { stdout: '', stderr: '' }
      }
      return {
        stdout: JSON.stringify({
          format: { duration: 2 },
          streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180 }]
        }),
        stderr: ''
      }
    }
    let outcome: unknown
    const context = {
      payload: { imageId, relativePath: path.relative(root, input.sourceFile), mode: 'SDR_1080P_V1' },
      job: { id: jobId, attempt: 1, maxAttempts: 1, executionToken: randomUUID() },
      signal: controller.signal,
      progress: vi.fn().mockResolvedValue(undefined),
      logger: { error: vi.fn() },
      mutateInTransaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => operation(tx),
      finalizeInTransaction: async (
        operation: (scope: FencedExecutionTransaction<Prisma.TransactionClient>) => Promise<void>
      ) => {
        const complete = vi.fn(async (value: unknown) => {
          if (options.failPublication) throw new Error('publication rollback')
          outcome = { kind: 'completed', value }
        })
        const scope = {
          transaction: tx,
          executionStatus: options.abort ? 'CANCELLING' : 'RUNNING',
          complete,
          skip: async (value: unknown) => {
            outcome = { kind: 'skipped', value }
          },
          cancel: async () => {
            outcome = { kind: 'cancelled' }
          },
          release: async () => {
            outcome = { kind: 'released' }
          }
        }
        if (options.failPublication) await tx.$executeRawUnsafe('SAVEPOINT playback_publication')
        try {
          await operation(scope as unknown as FencedExecutionTransaction<Prisma.TransactionClient>)
        } catch (error) {
          if (options.failPublication) await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT playback_publication')
          throw error
        }
        return outcome
      }
    } as unknown as ExecutionContext<unknown, EnqueuedChildJob>
    const executor = createVideoPlaybackExecutor({
      database: tx as PrismaClient,
      config: { sourceRoot: root, archiveRoot: root, playbackRoot: path.join(root, 'derived') },
      processRunner: options.runner
        ? (request) =>
            options.runner!({
              ...request,
              onStdout: (chunk) => {
                request.onStdout?.(chunk)
                if (options.abort && request.command === 'ffmpeg') controller.abort()
              }
            })
        : runner
    })
    return executor.execute(context)
  }
  it.skipIf(spawnSync('ffmpeg', ['-version']).status !== 0)(
    'runs the complete executor with real FFmpeg',
    async () => {
      await fixture(async (input) => {
        await runVideoProcess({
          command: 'ffmpeg',
          args: [
            '-v',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=1920x1080:rate=60',
            '-t',
            '3',
            '-c:v',
            'libx264',
            '-crf',
            '0',
            '-preset',
            'ultrafast',
            '-threads',
            '2',
            input.sourceFile
          ],
          signal: new AbortController().signal,
          timeoutMs: 30_000
        })
        const original = await readFile(input.sourceFile)
        expect(await execute(input, { runner: runVideoProcess })).toMatchObject({ kind: 'completed' })
        const copy = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
        expect(copy.outputSize).toBeLessThan(BigInt(original.length))
        expect(await execute(input, { runner: runVideoProcess, abort: true })).toMatchObject({ kind: 'cancelled' })
        expect(
          (await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })).generationId
        ).toBe(copy.generationId)
        expect(
          createHash('sha256')
            .update(await readFile(input.sourceFile))
            .digest('hex')
        ).toBe(createHash('sha256').update(original).digest('hex'))
      })
    },
    30_000
  )
  it('publishes only a validated smaller output, retains media identity and original bytes, and queues old generations', async () => {
    await fixture(async (input) => {
      const before = await readFile(input.sourceFile)
      expect(await execute(input)).toMatchObject({ kind: 'completed' })
      const first = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
      expect(first.outputSize).toBe(400n)
      expect(await readFile(input.sourceFile)).toEqual(before)
      expect(
        await input.tx.image.count({
          where: { artworkId: (await input.tx.image.findUniqueOrThrow({ where: { id: input.imageId } })).artworkId }
        })
      ).toBe(1)
      const current = await inspectVideoPlaybackSource(
        input.tx,
        { sourceRoot: input.root, archiveRoot: input.root },
        input.imageId,
        new AbortController().signal
      )
      expect(playbackMatchesSource(first, current)).toBe(true)
      expect(await execute(input)).toMatchObject({ kind: 'completed' })
      expect(
        await input.tx.derivedMediaGcEntry.findUnique({
          where: { mediaKind_relativePath: { mediaKind: 'VIDEO_PLAYBACK', relativePath: first.relativePath } }
        })
      ).toMatchObject({ reason: 'PLAYBACK_RETIRED', status: 'PENDING' })
      const second = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
      await input.tx.image.delete({ where: { id: input.imageId } })
      expect(await input.tx.mediaVideoPlayback.count({ where: { imageId: input.imageId } })).toBe(0)
      expect(
        await input.tx.derivedMediaGcEntry.findUnique({
          where: { mediaKind_relativePath: { mediaKind: 'VIDEO_PLAYBACK', relativePath: second.relativePath } }
        })
      ).not.toBeNull()
    })
  })
  it('supports legacy videos identified by path without backfilling their classification', async () => {
    await fixture(async (input) => {
      await input.tx.image.update({ where: { id: input.imageId }, data: { mediaType: 'UNKNOWN' } })
      expect(await execute(input)).toMatchObject({ kind: 'completed' })
      expect((await input.tx.image.findUniqueOrThrow({ where: { id: input.imageId } })).mediaType).toBe('UNKNOWN')
    })
  })

  it('GC removes retired files, retains current references, and never touches the original', async () => {
    await fixture(async (input) => {
      await execute(input)
      const first = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
      await execute(input)
      const current = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
      await input.tx.derivedMediaGcEntry.create({
        data: {
          mediaKind: 'VIDEO_PLAYBACK',
          relativePath: current.relativePath,
          referenceType: 'MEDIA_VIDEO_PLAYBACK',
          referenceId: String(input.imageId),
          reason: 'PLAYBACK_ATTEMPT',
          notBefore: new Date(0)
        }
      })
      await input.tx.derivedMediaGcEntry.updateMany({
        where: { mediaKind: 'VIDEO_PLAYBACK', relativePath: first.relativePath },
        data: { notBefore: new Date(0) }
      })
      const rows = await input.tx.derivedMediaGcEntry.findMany({
        where: { mediaKind: 'VIDEO_PLAYBACK', relativePath: { in: [first.relativePath, current.relativePath] } }
      })
      const context = {
        job: { id: input.jobId },
        signal: new AbortController().signal,
        payload: { dryRun: false, entryIds: rows.map((row) => row.id) },
        progress: vi.fn(),
        mutateInTransaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => operation(input.tx)
      } as unknown as Parameters<typeof executeDerivedMediaGc>[0]
      const outcome = await executeDerivedMediaGc(context, {
        database: input.tx as PrismaClient,
        config: {
          scanRoot: input.root,
          playbackStorageRoot: path.join(input.root, 'derived'),
          posterStorageRoot: input.root,
          chapterPreviewStorageRoot: input.root
        }
      })
      expect(outcome).toMatchObject({ kind: 'completed', result: { deleted: 1, referenced: 1, failed: 0 } })
      await expect(stat(path.join(input.root, 'derived', first.relativePath))).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await stat(path.join(input.root, 'derived', current.relativePath))).size).toBe(400)
      expect((await stat(input.sourceFile)).size).toBe(2000)
    })
  })

  it('rejects same-size external replacement during encoding', async () => {
    await fixture(async (input) => {
      const result = await execute(input, { afterEncode: () => writeFile(input.sourceFile, Buffer.alloc(2000, 9)) })
      expect(result).toMatchObject({ kind: 'skipped' })
      expect(await input.tx.mediaVideoPlayback.count({ where: { imageId: input.imageId } })).toBe(0)
      expect(await input.tx.derivedMediaGcEntry.count({ where: { lastSystemJobId: input.jobId } })).toBe(2)
    })
  })
  it('does not publish after deletion or an active write declaration', async () => {
    for (const writing of [true, false])
      await fixture(async (input) => {
        const result = await execute(input, {
          afterEncode: async () => {
            if (writing)
              await input.tx.mediaContentSource.upsert({
                where: { imageId: input.imageId },
                create: { imageId: input.imageId, writeToken: 'fixture-write', writeStartedAt: new Date() },
                update: { writeToken: 'fixture-write', writeStartedAt: new Date() }
              })
            else await input.tx.image.delete({ where: { id: input.imageId } })
          }
        })
        expect(result).toMatchObject({ kind: 'skipped' })
        expect(await input.tx.mediaVideoPlayback.count({ where: { imageId: input.imageId } })).toBe(0)
      })
  })
  it('keeps the original on cancellation and skips a larger output', async () => {
    for (const options of [{ abort: true }, { outputSize: 2500 }])
      await fixture(async (input) => {
        expect(await execute(input, options)).toMatchObject({ kind: options.abort ? 'cancelled' : 'skipped' })
        expect((await stat(input.sourceFile)).size).toBe(2000)
        expect(await input.tx.mediaVideoPlayback.count({ where: { imageId: input.imageId } })).toBe(0)
      })
  })
  it('retains attempt GC intents if publication rolls back after rename', async () => {
    await fixture(async (input) => {
      await expect(execute(input, { failPublication: true })).rejects.toThrow('publication rollback')
      expect(await input.tx.mediaVideoPlayback.count({ where: { imageId: input.imageId } })).toBe(0)
      const intents = await input.tx.derivedMediaGcEntry.findMany({ where: { lastSystemJobId: input.jobId } })
      expect(intents).toHaveLength(2)
      const output = intents.find((row) => !row.relativePath.endsWith('.tmp.mp4'))!
      expect((await stat(path.join(input.root, 'derived', output.relativePath))).size).toBe(400)
      expect((await stat(input.sourceFile)).size).toBe(2000)
    })
  })
  it('does not register physical cleanup when a publication change rolls back', async () => {
    let retiredPath = ''
    await fixture(async (input) => {
      await execute(input)
      const copy = await input.tx.mediaVideoPlayback.findUniqueOrThrow({ where: { imageId: input.imageId } })
      retiredPath = copy.relativePath
      await input.tx.mediaVideoPlayback.delete({ where: { imageId: input.imageId } })
      expect(await input.tx.derivedMediaGcEntry.count({ where: { relativePath: retiredPath } })).toBe(1)
    })
    expect(await db!.derivedMediaGcEntry.count({ where: { relativePath: retiredPath } })).toBe(0)
  })
})
