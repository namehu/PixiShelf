import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  PrismaClient,
  beginMediaContentPathWrite,
  beginMediaContentSourceWrite,
  consumeMediaContentRecovery,
  type MediaContentResult,
  type Prisma
} from '@pixishelf/db'
import { readExecutorMediaRecoveryDomainSnapshot, resolveMediaContentRoots } from '@pixishelf/job-executors'
import { MutableQueueClock, PostgresQueueRepository, type QueueDatabase } from '@pixishelf/job-runtime'

const databaseUrl = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const run = promisify(execFile)
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const ready = <T>(result: MediaContentResult<T>) => {
  expect(result.status).toBe('READY')
  if (result.status !== 'READY') throw new Error(result.status)
  return result.value
}

describe.skipIf(!databaseUrl)('offline recovery CLI with PostgreSQL and physical roots', () => {
  it('inspects, rejects a changed root, grants, revokes, resumes the original FAILED job and consumes its next attempt', async () => {
    const db = new PrismaClient({ datasourceUrl: databaseUrl! })
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-real-cli-'))
    const sourceRoot = await fs.realpath(temporary)
    const jobId = `dedup-cli-${randomUUID()}`
    const sessionId = `video-remux:${jobId}`
    let artworkId: number | null = null
    let rootIdentity: string | null = null
    try {
      const inventory = await db.pixivMetadataInventoryState.findUnique({
        where: { id: 'pixiv' },
        select: { rootIdentity: true }
      })
      if (inventory?.rootIdentity)
        await fs.writeFile(
          path.join(sourceRoot, '.pixishelf-root'),
          JSON.stringify({ version: 1, id: inventory.rootIdentity })
        )
      const roots = await resolveMediaContentRoots({
        sourceRoot,
        archiveRoot: sourceRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      })
      rootIdentity = roots.source.rootIdentity
      const binary = path.join(sourceRoot, 'media-content-recovery.cjs')
      await build({
        entryPoints: ['src/media-content-recovery.ts'],
        absWorkingDir: packageRoot,
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile: binary,
        external: ['@prisma/client', '.prisma/client', 'sharp'],
        logLevel: 'silent'
      })
      const cli = async (args: string[], overrideRoot = sourceRoot) => {
        const result = await run(process.execPath, [binary, ...args], {
          cwd: packageRoot,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl!,
            SOURCE_MEDIA_ROOT: overrideRoot,
            ARCHIVE_ROOT: overrideRoot,
            NODE_PATH: path.join(packageRoot, 'node_modules')
          },
          timeout: 20_000
        })
        return JSON.parse(result.stdout.trim()) as Record<string, unknown>
      }
      const now = new Date()
      const fixture = await db.$transaction(async (tx) => {
        const artwork = await tx.artwork.create({ data: { title: jobId } })
        artworkId = artwork.id
        const image = await tx.image.create({
          data: { artworkId: artwork.id, path: `${jobId}/original.mp4`, mediaType: 'VIDEO', size: 5n }
        })
        await tx.systemJob.create({
          data: {
            id: jobId,
            type: 'VIDEO_STREAMING_OPTIMIZATION',
            status: 'FAILED',
            attempt: 1,
            maxAttempts: 1,
            payload: { imageId: image.id, relativePath: image.path, mode: 'REMUX_FASTSTART' },
            finishedAt: now,
            deadlineAt: new Date(now.getTime() - 1000)
          }
        })
        const directory = {
          logicalRoot: roots.source.logicalRoot,
          rootIdentity: roots.source.rootIdentity,
          relativeDirectory: jobId
        }
        const scope = { kind: 'PATH' as const, relativePath: image.path }
        const owner = {
          ownerUserId: null,
          sessionId,
          sessionVersion: 1n,
          execution: { jobId, executionToken: randomUUID(), executionAttempt: 1 }
        }
        const handle = ready(
          await beginMediaContentPathWrite(tx, {
            directory,
            scope,
            owner,
            writeToken: randomUUID(),
            upload: null,
            parent: null,
            now
          })
        )
        const source = await beginMediaContentSourceWrite(tx, {
          artworkIds: [],
          imageIds: [image.id],
          writeToken: handle.writeToken,
          now
        })
        return { owner, directory, scope, source }
      })
      const output = path.join(sourceRoot, 'inspection.json')
      const inspected = await cli(['inspect', '--job', jobId, '--session', sessionId, '--output', output])
      expect((await fs.stat(output)).mode & 0o777).toBe(0o600)
      expect(inspected.digest).toMatch(/^[a-f0-9]{64}$/)
      const grantArgs = [
        'grant',
        '--snapshot',
        output,
        '--expect',
        String(inspected.digest),
        '--backup-checkpoint',
        'disposable-fixture',
        '--operator',
        'fixture',
        '--confirm-all-writers-stopped'
      ]
      const otherRoot = path.join(sourceRoot, 'other-root')
      await fs.mkdir(otherRoot)
      if (inventory?.rootIdentity)
        await fs.writeFile(
          path.join(otherRoot, '.pixishelf-root'),
          JSON.stringify({ version: 1, id: inventory.rootIdentity })
        )
      await expect(cli(grantArgs, otherRoot)).rejects.toMatchObject({
        stderr: expect.stringContaining('Media root differs')
      })
      expect(await db.mediaContentRecoveryGrant.count({ where: { jobId } })).toBe(0)
      const first = await cli(grantArgs)
      expect(await cli(grantArgs)).toEqual(first)
      expect(await db.mediaContentRecoveryGrant.count({ where: { jobId } })).toBe(1)
      expect(await db.systemJobEvent.count({ where: { jobId, type: 'MEDIA_RECOVERY_GRANTED' } })).toBe(1)
      await expect(cli(grantArgs, otherRoot)).rejects.toMatchObject({
        stderr: expect.stringContaining('Media root differs')
      })
      expect(
        await cli(['revoke', '--grant', String(first.grantId), '--operator', 'fixture', '--reason', 'fixture replay'])
      ).toMatchObject({ status: 'REVOKED' })
      await expect(
        cli(['resume', '--grant', String(first.grantId), '--operator', 'fixture', '--confirm-all-writers-stopped'])
      ).rejects.toMatchObject({ stderr: expect.stringContaining('STALE') })
      await expect(cli(grantArgs)).rejects.toMatchObject({ stderr: expect.stringContaining('STALE') })
      // This is a new authorization, backed by an explicitly reverified checkpoint.
      const newGrantArgs = grantArgs.map((argument) =>
        argument === 'disposable-fixture' ? 'disposable-fixture-reverified' : argument
      )
      const granted = await cli(newGrantArgs)
      expect(granted.grantId).not.toBe(first.grantId)
      expect(await cli(newGrantArgs)).toEqual(granted)
      const resumeArgs = [
        'resume',
        '--grant',
        String(granted.grantId),
        '--operator',
        'fixture',
        '--confirm-all-writers-stopped'
      ]
      expect(await cli(resumeArgs)).toMatchObject({ jobId, status: 'PENDING', nextAttempt: 2, reused: false })
      expect(await cli(resumeArgs)).toMatchObject({ jobId, reused: true })
      const clock = new MutableQueueClock(new Date())
      const queue = new PostgresQueueRepository(db as unknown as QueueDatabase, { clock })
      const claimed = await queue.claim('dedup-cli-worker', [
        { jobType: 'VIDEO_STREAMING_OPTIMIZATION', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
      ])
      expect(claimed).toMatchObject({ id: jobId, attempt: 2 })
      await queue.withFencedMutationTransaction<Prisma.TransactionClient>(
        { jobId, workerId: claimed!.workerId, executionToken: claimed!.executionToken, attempt: claimed!.attempt },
        async (transaction) => {
          const result = await consumeMediaContentRecovery(transaction, {
            owner: {
              ...fixture.owner,
              execution: { jobId, executionToken: claimed!.executionToken, executionAttempt: claimed!.attempt }
            },
            expectedScopes: [{ directory: fixture.directory, scope: fixture.scope }],
            artworkIds: [],
            imageIds: fixture.source.imageIds,
            now: clock.now(),
            readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
          })
          expect(ready(result).handles[0]!.declarationVersion).toBe(2n)
        }
      )
      expect(
        await db.mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: String(granted.grantId) } })
      ).toMatchObject({ status: 'CONSUMED', targetAttempt: 2 })
    } finally {
      await db.mediaContentRecoveryGrant.deleteMany({ where: { jobId } })
      if (artworkId !== null) await db.artwork.deleteMany({ where: { id: artworkId } })
      await db.mediaContentPathWrite.deleteMany({ where: { jobId } })
      if (rootIdentity !== null) await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
      await db.systemJob.deleteMany({ where: { id: jobId } })
      await db.$disconnect()
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }, 60_000)
})
