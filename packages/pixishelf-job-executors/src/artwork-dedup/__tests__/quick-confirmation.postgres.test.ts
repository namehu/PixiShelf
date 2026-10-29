import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  prepareArtworkDedupQuickConfirmation,
  authorizeArtworkDedupDirectDelete,
  artworkDedupDirectDeleteScopeDigest,
  retryArtworkDedupDirectDelete
} from '@pixishelf/db'
import type { ArtworkDedupMaintenancePayload } from '@pixishelf/job-contracts'
import { ControlledDedupReader } from '../reader.ts'
import { executeArtworkDedupDirectDelete, matchesVerificationResume } from '../direct-delete.ts'
import {
  db,
  fixture,
  repository,
  executionContext,
  readerOptions,
  root,
  clock,
  trackMaintenanceJob
} from './maintenance-executor-fixture.ts'

type Options = Parameters<typeof fixture>[2]
async function quick(count = 2, options: Options = {}) {
  const f = await fixture(count, 'MANUAL_CREATE', { ...options, purpose: 'DIRECT_DELETE' })
  await f.close()
  const reads = vi.spyOn(ControlledDedupReader.prototype, 'read')
  const inspections = vi.spyOn(ControlledDedupReader.prototype, 'inspectMaintenance')
  const sources = vi.spyOn(ControlledDedupReader.prototype, 'inspectSource')
  try {
    const op = await db!.$transaction(
      async (tx) => {
        await tx.artworkDedupOperation.update({
          where: { id: f.context.execution.operationId },
          data: { jobId: null, status: 'BUILDING' }
        })
        return prepareArtworkDedupQuickConfirmation(tx, f.context.execution.operationId)
      },
      { timeout: 20000 }
    )
    expect(op).toMatchObject({
      preparationVersion: 2,
      status: 'READY',
      stage: 'CONFIRM',
      jobId: null,
      verifiedFiles: 0n
    })
    expect(reads).not.toHaveBeenCalled()
    expect(inspections).not.toHaveBeenCalled()
    expect(sources).not.toHaveBeenCalled()
    return op
  } finally {
    reads.mockRestore()
    inspections.mockRestore()
    sources.mockRestore()
  }
}
type Op = Awaited<ReturnType<typeof quick>>
const command = (op: Op) => ({
  userId: op.requestedBy,
  expectedUserId: op.requestedBy,
  operationId: op.id,
  expectedVersion: op.version,
  idempotencyKey: randomUUID()
})
const capabilities = [
  {
    jobType: 'ARTWORK_DEDUP_MAINTENANCE' as const,
    executionLane: 'BACKGROUND_WRITER' as const,
    definitionVersions: [6]
  }
]
async function start(op: Op, retry = false) {
  const id = await db!.$transaction(
    async (tx) => {
      const result = retry
        ? await retryArtworkDedupDirectDelete(tx, command(op))
        : await authorizeArtworkDedupDirectDelete(tx, {
            ...command(op),
            purpose: 'DIRECT_DELETE',
            protocolVersion: op.protocolVersion as 1 | 2 | 3 | 4,
            scopeDigest: op.scopeDigest!,
            externalWritesStopped: true,
            permanentDeleteConfirmed: true,
            organizationImpactConfirmed: true,
            ...([3, 4].includes(op.protocolVersion!) ? { differentContentLossConfirmed: true as const } : {})
          })
      const job = await tx.systemJob.create({
        data: {
          type: 'ARTWORK_DEDUP_MAINTENANCE',
          definitionVersion: 6,
          executionLane: 'BACKGROUND_WRITER',
          triggerSource: 'SYSTEM',
          queuePriority: 900,
          effectivePriority: 900,
          availableAt: clock.now(),
          payload: { operationId: op.id, executionVersion: result.operation.executionVersion, mode: 'DIRECT_DELETE' }
        }
      })
      trackMaintenanceJob(job.id)
      await tx.artworkDedupOperation.update({ where: { id: op.id }, data: { jobId: job.id } })
      return job.id
    },
    { timeout: 20000 }
  )
  const job = await repository!.claim('quick-confirm-test', capabilities)
  expect(job?.id).toBe(id)
  return job!
}
const current = (op: Op) => db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: op.id } })
const dependencies = () => ({
  database: db!,
  sourceRoot: root,
  archiveRoot: root,
  readerOptions,
  now: () => clock.now().getTime()
})
async function continueJob() {
  clock.advance(4000)
  return (await repository!.claim('quick-confirm-test', capabilities))!
}
const execute = (job: NonNullable<Awaited<ReturnType<typeof continueJob>>>, sliceBytes?: bigint) =>
  executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
    ...dependencies(),
    ...(sliceBytes ? { sliceBytes } : {})
  })

describe('verification continuation identity', () => {
  it('binds the grant to process, attempt, job and domain execution', () => {
    const identity = { jobId: 'job', executionVersion: 2, attempt: 1, processSession: 'process' }
    expect(matchesVerificationResume(identity, identity)).toBe(true)
    for (const change of [{ processSession: 'restarted' }, { attempt: 2 }, { jobId: 'new' }, { executionVersion: 3 }])
      expect(matchesVerificationResume({ ...identity, ...change }, identity)).toBe(false)
    expect(matchesVerificationResume(null, identity)).toBe(false)
  })
})
describe.skipIf(!db).sequential('quick confirmation and single verification', () => {
  it('freezes DB scope without reader I/O, retains digest after observed facts and reads each original once across clean yields', async () => {
    const op = await quick(3)
    const files = await db!.artworkDedupOperationFile.findMany({
      where: { operationId: op.id },
      orderBy: { fileId: 'asc' }
    })
    const specs = files.map((f) => f.verificationSpec)
    const read = vi.spyOn(ControlledDedupReader.prototype, 'read')
    try {
      let job = await start(op)
      for (let i = 0; i < 20; i++) {
        await execute(job, 1n)
        const next = await current(op)
        expect(await db!.$transaction((tx) => artworkDedupDirectDeleteScopeDigest(tx, op.id))).toBe(op.scopeDigest)
        if (next.status === 'DELETED') break
        expect(next.status).not.toBe('RECOVERY_REQUIRED')
        expect(next.verificationResume).not.toBeNull()
        const previousAttempt = job.attempt
        job = await continueJob()
        expect(job.attempt).toBe(previousAttempt)
      }
      expect(await current(op)).toMatchObject({ status: 'DELETED', deletedFiles: 3n, verifiedFiles: 6n })
      expect(read).toHaveBeenCalledTimes(6)
      expect(
        (
          await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id }, orderBy: { fileId: 'asc' } })
        ).map((f) => f.verificationSpec)
      ).toEqual(specs)
    } finally {
      read.mockRestore()
    }
  }, 60000)
  it.each(['restart', 'expired-lease'] as const)(
    'does not reuse full-read evidence after %s',
    async (mode) => {
      const op = await quick(2),
        first = await start(op)
      const read = vi.spyOn(ControlledDedupReader.prototype, 'read')
      try {
        await execute(first, 1n)
        expect(read).toHaveBeenCalledTimes(1)
        const yielded = await current(op)
        const grant = yielded.verificationResume as Prisma.JsonObject
        if (mode === 'restart')
          await db!.artworkDedupOperation.update({
            where: { id: op.id },
            data: { verificationResume: { ...grant, processSession: 'a-different-process' } }
          })
        else {
          // Claim the clean continuation, then lose its lease before consuming the grant.
          const abandoned = await continueJob()
          expect(abandoned.attempt).toBe(first.attempt)
          clock.advance(120000)
          expect(await repository!.recoverExpiredExecution()).toMatchObject({ jobId: abandoned.id, status: 'RETRY_WAIT' })
        }
        const resumed = await continueJob()
        expect(resumed.attempt).toBe(mode === 'restart' ? first.attempt : first.attempt + 1)
        await execute(resumed)
        expect(await current(op)).toMatchObject({ status: 'DELETED', verifiedFiles: 4n })
        expect(read).toHaveBeenCalledTimes(5)
      } finally {
        read.mockRestore()
      }
    },
    30000
  )
  it.each(['bytes', 'unknown-attachment', 'registered-member', 'source-path'] as const)(
    'rejects %s after consent before the first deletion',
    async (mode) => {
      const op = await quick(),
        job = await start(op)
      const file = await db!.artworkDedupOperationFile.findFirstOrThrow({
        where: { operationId: op.id, artwork: { role: 'COPY' } }
      })
      if (mode === 'bytes') await fs.writeFile(path.join(root, file.canonicalPath), 'changed')
      if (mode === 'unknown-attachment')
        await fs.writeFile(path.join(root, path.posix.dirname(file.canonicalPath), 'unknown.bin'), 'unreviewed')
      if (mode === 'registered-member')
        await db!.image.create({
          data: { artworkId: file.artworkId, path: `${path.posix.dirname(file.canonicalPath)}/new.bin` }
        })
      if (mode === 'source-path')
        await db!.artwork.update({
          where: { id: file.artworkId },
          data: { metaSource: `${path.posix.dirname(file.canonicalPath)}/new-meta.json` }
        })
      await execute(job)
      expect(await current(op)).toMatchObject({ status: 'RECOVERY_REQUIRED', deletedFiles: 0n })
      expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id, step: 'DELETE' } })).toBe(0)
      expect((await fs.stat(path.join(root, file.canonicalPath))).isFile()).toBe(true)
    },
    30000
  )
  it('verifies mixed visual originals once and retains the keeper unchanged', async () => {
    const op = await quick(5, {
      mixedVisualMedia: true,
      visualKeeperIndex: 0,
      beforeScan: async (ids) => {
        const images = await db!.image.findMany({
          where: { artworkId: { in: ids } },
          orderBy: [{ artworkId: 'asc' }, { sortOrder: 'asc' }]
        })
        const pixels = Buffer.from(
          Array.from(
            { length: 192 * 192 * 3 },
            (_, i) =>
              (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71) % 255
          )
        )
        const still = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } })
          .png()
          .toBuffer()
        for (const [i, image] of images.entries()) {
          const bytes =
            i % 5 === 0
              ? Buffer.from(`animation ${i}`)
              : i === 9
                ? await sharp(still)
                    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' })
                    .png()
                    .toBuffer()
                : still
          await fs.writeFile(path.join(root, image.path), bytes)
          await db!.image.update({ where: { id: image.id }, data: { mediaType: i % 5 === 0 ? 'ANIMATION' : 'IMAGE' } })
        }
      }
    })
    const kept = await db!.artworkDedupOperationFile.findMany({
      where: { operationId: op.id, artwork: { role: 'KEEPER' } }
    })
    const bytes = await Promise.all(kept.map((f) => fs.readFile(path.join(root, f.canonicalPath))))
    const read = vi.spyOn(ControlledDedupReader.prototype, 'read')
    try {
      await execute(await start(op))
      expect(await current(op)).toMatchObject({ status: 'DELETED', deletedFiles: 5n, verifiedFiles: 10n })
      expect(read).toHaveBeenCalledTimes(10)
      for (const [i, file] of kept.entries())
        expect(await fs.readFile(path.join(root, file.canonicalPath))).toEqual(bytes[i])
    } finally {
      read.mockRestore()
    }
  }, 60000)
  it.each(['PIXIV_SCAN', 'URL_ARCHIVE'] as const)(
    'freezes %s sidecars without fabricated bytes and fills the verified final total',
    async (source) => {
      const op = await quick(1, { kinds: [source, source], archiveBytes: source === 'URL_ARCHIVE' })
      expect(op.logicalBytes).toBeNull()
      await execute(await start(op))
      const completed = await current(op)
      expect(completed).toMatchObject({ status: 'DELETED', verifiedFiles: completed.preparedFiles })
      const files = await db!.artworkDedupOperationFile.findMany({
        where: { operationId: op.id, artwork: { role: 'COPY' } }
      })
      expect(files.some((file) => file.role === 'SOURCE_FILE')).toBe(true)
      expect(completed.logicalBytes).toBe(files.reduce((sum, file) => sum + file.size!, 0n))
    },
    60000
  )
  it('retries a partially receipted deletion with a fresh execution and immutable consent', async () => {
    const op = await quick(2),
      job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
      ...dependencies(),
      onDirectDeleteBoundary: async (boundary) => {
        if (boundary === 'RECEIPTED') throw new Error('synthetic interruption')
      }
    })
    const stopped = await current(op)
    expect(stopped).toMatchObject({ status: 'RECOVERY_REQUIRED', deletedFiles: 1n, verificationResume: null })
    const read = vi.spyOn(ControlledDedupReader.prototype, 'read')
    try {
      await execute(await start(stopped, true))
      expect(await current(op)).toMatchObject({
        status: 'DELETED',
        verifiedFiles: 4n,
        deletedFiles: 2n,
        scopeDigest: op.scopeDigest
      })
      expect(read).toHaveBeenCalledTimes(3)
    } finally {
      read.mockRestore()
    }
  }, 30000)
  it('maintenance v6 SQL rejects slow PREPARE payloads', async () => {
    await expect(
      db!.systemJob.create({
        data: {
          type: 'ARTWORK_DEDUP_MAINTENANCE',
          definitionVersion: 6,
          executionLane: 'BACKGROUND_WRITER',
          triggerSource: 'SYSTEM',
          queuePriority: 900,
          effectivePriority: 900,
          payload: {
            operationId: 'unused',
            executionVersion: 1,
            mode: 'PREPARE',
            purpose: 'DIRECT_DELETE',
            protocolVersion: 4
          }
        }
      })
    ).rejects.toThrow()
  })
})
