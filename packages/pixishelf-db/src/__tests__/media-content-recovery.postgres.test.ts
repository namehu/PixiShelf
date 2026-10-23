import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { beginMediaContentPathWrite, beginMediaContentSourceWrite } from '../media-content-writes'
import {
  consumeMediaContentRecovery,
  grantMediaContentRecovery,
  inspectMediaContentRecovery,
  parseMediaContentRecoverySnapshot,
  revokeMediaContentRecovery,
  resumeGrantedMediaContentRecovery,
  type MediaContentRecoveryDomainReader
} from '../media-content-recovery'
import type {
  MediaContentDirectoryKey,
  MediaContentOwner,
  MediaContentResult,
  MediaContentTransaction
} from '../media-content-types'
const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const now = new Date('2026-10-23T00:00:00Z')
const rollback = new Error('rollback offline recovery fixture')
const ready = <T>(result: MediaContentResult<T>): T => {
  expect(result.status).toBe('READY')
  if (result.status !== 'READY') throw new Error(result.status)
  return result.value
}
async function isolated(body: (tx: MediaContentTransaction) => Promise<void>) {
  await expect(
    database!.$transaction(
      async (tx) => {
        await body(tx)
        throw rollback
      },
      { timeout: 20_000 }
    )
  ).rejects.toBe(rollback)
}
async function fixture(tx: MediaContentTransaction) {
  const root = await tx.mediaContentDirectoryState.findUnique({
    where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
  })
  const directory: MediaContentDirectoryKey = {
    logicalRoot: 'source-media:v1',
    rootIdentity: root?.rootIdentity ?? 'test-root',
    relativeDirectory: `recovery-${randomUUID()}`
  }
  const artwork = await tx.artwork.create({ data: { title: 'offline recovery' } })
  const image = await tx.image.create({
    data: { path: `/${directory.relativeDirectory}/a.mp4`, artworkId: artwork.id, size: 5n }
  })
  const job = await tx.systemJob.create({
    data: {
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      status: 'FAILED',
      attempt: 1,
      payload: { imageId: image.id, imagePath: image.path }
    }
  })
  const owner: MediaContentOwner = {
    ownerUserId: null,
    sessionId: `video-remux:${job.id}`,
    sessionVersion: 1n,
    execution: { jobId: job.id, executionToken: randomUUID(), executionAttempt: 1 }
  }
  const scope = { kind: 'PATH' as const, relativePath: image.path.slice(1) }
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
  let domainVersion = 1
  const readDomainSnapshot: MediaContentRecoveryDomainReader = async () => ({
    kind: 'test-trusted-domain',
    imageId: image.id,
    domainVersion
  })
  const inspect = () =>
    inspectMediaContentRecovery(tx, { jobId: job.id, sessionId: owner.sessionId, now, readDomainSnapshot })
  const grant = async () => {
    const inspected = ready(await inspect())
    return ready(
      await grantMediaContentRecovery(tx, {
        snapshot: inspected.snapshot,
        expectedDigest: inspected.digest,
        backupCheckpointRef: 'backup/fixture-verified',
        operator: 'operator-fixture',
        confirmAllWritersStopped: true,
        now,
        readDomainSnapshot
      })
    )
  }
  const activate = async (attempt = 2) => {
    const executionToken = randomUUID(),
      expiresAt = new Date(now.getTime() + 60_000)
    await tx.systemJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        attempt,
        workerId: 'recovery-fixture',
        leaseToken: executionToken,
        leaseExpiresAt: expiresAt
      }
    })
    await tx.jobResourceLease.upsert({
      where: { resourceKey: 'lane/background-writer' },
      create: {
        resourceKey: 'lane/background-writer',
        ownerJobId: job.id,
        workerId: 'recovery-fixture',
        leaseToken: executionToken,
        expiresAt,
        heartbeatAt: now
      },
      update: {
        ownerJobId: job.id,
        workerId: 'recovery-fixture',
        leaseToken: executionToken,
        expiresAt,
        heartbeatAt: now
      }
    })
    return { ...owner, execution: { jobId: job.id, executionToken, executionAttempt: attempt } }
  }
  const consume = (newOwner: MediaContentOwner, scopes = [{ directory, scope }]) =>
    consumeMediaContentRecovery(tx, {
      owner: newOwner,
      expectedScopes: scopes,
      artworkIds: [],
      imageIds: [image.id],
      readDomainSnapshot,
      now
    })
  return {
    artwork,
    image,
    job,
    owner,
    handle,
    source,
    directory,
    scope,
    readDomainSnapshot,
    inspect,
    grant,
    activate,
    consume,
    changeDomain: () => {
      domainVersion++
    }
  }
}
describe.skipIf(!database)('explicit offline media recovery authorization', () => {
  afterAll(async () => database?.$disconnect())
  it('recovers a committed grant response by exact replay without creating a second grant or audit', async () => {
    const priorRoot = await database!.mediaContentDirectoryState.findUnique({
      where: {
        logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' }
      }
    })
    const value = await database!.$transaction(fixture)
    try {
      const inspected = ready(
        await database!.$transaction((tx) =>
          inspectMediaContentRecovery(tx, {
            jobId: value.job.id,
            sessionId: value.owner.sessionId,
            now,
            readDomainSnapshot: value.readDomainSnapshot
          })
        )
      )
      const input = {
        snapshot: inspected.snapshot,
        expectedDigest: inspected.digest,
        operator: 'committed-operator',
        backupCheckpointRef: 'backup/committed',
        confirmAllWritersStopped: true as const,
        now,
        readDomainSnapshot: value.readDomainSnapshot
      }
      // The first caller loses its result after commit; recover the ID from the repeated command only.
      await database!.$transaction(async (tx) => {
        ready(await grantMediaContentRecovery(tx, input))
      })
      const persisted = await database!.mediaContentRecoveryGrant.findFirstOrThrow({ where: { jobId: value.job.id } })
      const replay = ready(await database!.$transaction((tx) => grantMediaContentRecovery(tx, input)))
      expect(replay).toEqual({ grantId: persisted.id, nextAttempt: 2 })
      expect(await database!.mediaContentRecoveryGrant.count({ where: { jobId: value.job.id } })).toBe(1)
      expect(
        await database!.systemJobEvent.count({ where: { jobId: value.job.id, type: 'MEDIA_RECOVERY_GRANTED' } })
      ).toBe(1)
    } finally {
      await database!.mediaContentRecoveryGrant.deleteMany({ where: { jobId: value.job.id } })
      await database!.artwork.delete({ where: { id: value.artwork.id } })
      await database!.mediaContentPathWrite.deleteMany({ where: { jobId: value.job.id } })
      await database!.mediaContentDirectoryState.deleteMany({
        where: { logicalRoot: value.directory.logicalRoot, relativeDirectory: value.directory.relativeDirectory }
      })
      if (!priorRoot)
        await database!.mediaContentDirectoryState.deleteMany({
          where: {
            logicalRoot: value.directory.logicalRoot,
            relativeDirectory: '',
            rootIdentity: value.directory.rootIdentity
          }
        })
      await database!.systemJob.delete({ where: { id: value.job.id } })
    }
  })

  it.each([
    'operator',
    'backup',
    'snapshot',
    'attempt',
    'domain',
    'source',
    'root',
    'scope',
    'version',
    'worker',
    'lease',
    'revoked',
    'consumed'
  ] as const)('rejects grant replay after %s changes while preserving the original authorization', async (change) =>
    isolated(async (tx) => {
      const value = await fixture(tx),
        inspected = ready(await value.inspect())
      const input = {
        snapshot: inspected.snapshot,
        expectedDigest: inspected.digest,
        operator: 'operator-fixture',
        backupCheckpointRef: 'backup/fixture-verified',
        confirmAllWritersStopped: true as const,
        now,
        readDomainSnapshot: value.readDomainSnapshot
      }
      const original = ready(await grantMediaContentRecovery(tx, input))
      if (change === 'operator') input.operator = 'different-operator'
      if (change === 'backup') input.backupCheckpointRef = 'backup/different'
      if (change === 'snapshot') {
        input.snapshot.domainSha256 = 'f'.repeat(64)
        input.expectedDigest = recoveryDigest(input.snapshot)
      }
      if (change === 'attempt') await tx.systemJob.update({ where: { id: value.job.id }, data: { attempt: 2 } })
      if (change === 'domain') value.changeDomain()
      if (change === 'source')
        await tx.mediaContentSource.update({ where: { imageId: value.image.id }, data: { revision: { increment: 1 } } })
      if (change === 'root')
        await tx.mediaContentDirectoryState.update({
          where: { id: value.handle.directoryId },
          data: { rootIdentity: 'changed-root' }
        })
      if (change === 'scope')
        await tx.mediaContentPathWrite.update({
          where: { id: value.handle.writeId },
          data: { relativePath: `${value.directory.relativeDirectory}/other.mp4` }
        })
      if (change === 'version')
        await tx.mediaContentPathWrite.update({
          where: { id: value.handle.writeId },
          data: { declarationVersion: { increment: 1 } }
        })
      if (change === 'worker')
        await tx.workerInstance.create({
          data: {
            workerId: randomUUID(),
            status: 'READY',
            serviceVersion: 'test',
            hostname: 'test',
            processId: 1,
            heartbeatAt: now
          }
        })
      if (change === 'lease')
        await tx.jobResourceLease.create({
          data: {
            resourceKey: `test-replay-${randomUUID()}`,
            ownerJobId: value.job.id,
            workerId: 'test',
            leaseToken: randomUUID(),
            expiresAt: new Date(now.getTime() + 60_000),
            heartbeatAt: now
          }
        })
      if (change === 'revoked')
        ready(
          await revokeMediaContentRecovery(tx, {
            grantId: original.grantId,
            operator: input.operator,
            reason: 'stop',
            now
          })
        )
      if (change === 'consumed') {
        ready(await value.consume(await value.activate()))
        await tx.jobResourceLease.deleteMany({ where: { ownerJobId: value.job.id } })
        await tx.systemJob.update({
          where: { id: value.job.id },
          data: {
            status: 'FAILED',
            workerId: null,
            leaseToken: null,
            leaseExpiresAt: null
          }
        })
      }
      expect(await grantMediaContentRecovery(tx, input)).toEqual({
        status: change === 'worker' || change === 'lease' ? 'WRITING' : change === 'root' ? 'ROOT_CHANGED' : 'STALE'
      })
      expect(await tx.mediaContentRecoveryGrant.count({ where: { jobId: value.job.id } })).toBe(1)
      expect(await tx.systemJobEvent.count({ where: { jobId: value.job.id, type: 'MEDIA_RECOVERY_GRANTED' } })).toBe(1)
      if (change === 'revoked') {
        input.operator = 'different-operator'
        expect(await grantMediaContentRecovery(tx, input)).toEqual({ status: 'STALE' })
        input.backupCheckpointRef = 'backup/newly-verified-after-revocation'
        const replacement = ready(await grantMediaContentRecovery(tx, input))
        expect(replacement.grantId).not.toBe(original.grantId)
        expect(await tx.mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: original.grantId } })).toMatchObject(
          { status: 'REVOKED' }
        )
      }
    })
  )

  it('resumes the granted FAILED job in place, replays once, then consumes in its next execution', async () =>
    isolated(async (tx) => {
      const value = await fixture(tx)
      await tx.systemJob.update({
        where: { id: value.job.id },
        data: { maxAttempts: 1, deadlineAt: new Date(now.getTime() - 1) }
      })
      const granted = await value.grant()
      const resume = () =>
        resumeGrantedMediaContentRecovery(tx, {
          grantId: granted.grantId,
          operator: 'operator',
          confirmAllWritersStopped: true,
          now,
          readDomainSnapshot: value.readDomainSnapshot
        })
      expect(ready(await resume())).toMatchObject({
        jobId: value.job.id,
        status: 'PENDING',
        nextAttempt: 2,
        reused: false
      })
      expect(ready(await resume())).toMatchObject({ reused: true })
      expect(await tx.systemJob.findUniqueOrThrow({ where: { id: value.job.id } })).toMatchObject({
        status: 'PENDING',
        attempt: 1,
        maxAttempts: 2,
        triggerSource: 'RETRY',
        deadlineAt: null
      })
      expect(await tx.systemJobEvent.count({ where: { jobId: value.job.id, type: 'job.queued' } })).toBe(1)
      expect(await tx.mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: granted.grantId } })).toMatchObject({
        status: 'ACTIVE'
      })
      const next = await value.activate()
      expect(ready(await value.consume(next)).handles[0]!.declarationVersion).toBe(value.handle.declarationVersion + 1n)
      expect(await resume()).toEqual({ status: 'STALE' })
    }))
  it.each(['missing', 'revoked', 'changed'] as const)(
    'rejects %s recovery grants before requeueing the failed job',
    async (kind) =>
      isolated(async (tx) => {
        const value = await fixture(tx)
        const grantId = kind === 'missing' ? randomUUID() : (await value.grant()).grantId
        if (kind === 'revoked')
          ready(
            await revokeMediaContentRecovery(tx, { grantId, operator: 'operator', reason: 'replaced checkpoint', now })
          )
        if (kind === 'changed') value.changeDomain()
        expect(
          await resumeGrantedMediaContentRecovery(tx, {
            grantId,
            operator: 'operator',
            confirmAllWritersStopped: true,
            now,
            readDomainSnapshot: value.readDomainSnapshot
          })
        ).toEqual({ status: kind === 'missing' ? 'MISSING' : 'STALE' })
        expect(await tx.systemJob.findUniqueOrThrow({ where: { id: value.job.id } })).toMatchObject({
          status: 'FAILED',
          attempt: 1
        })
        expect(await tx.systemJobEvent.count({ where: { jobId: value.job.id, type: 'job.queued' } })).toBe(0)
      })
  )
  it('returns MISSING without imposing recovery clocks, job types, or job existence on ordinary writes', async () =>
    isolated(async (tx) => {
      const value = await fixture(tx)
      expect(await value.consume(value.owner)).toEqual({ status: 'MISSING' })
      const ordinaryJob = await tx.systemJob.create({ data: { type: 'ARCHIVE_PUBLISH', payload: {} } })
      expect(
        await value.consume({
          ...value.owner,
          execution: { ...value.owner.execution!, jobId: ordinaryJob.id }
        })
      ).toEqual({ status: 'MISSING' })
      expect(
        await value.consume({
          ...value.owner,
          execution: { ...value.owner.execution!, jobId: `missing-${randomUUID()}` }
        })
      ).toEqual({ status: 'MISSING' })
      expect(await tx.systemJobEvent.count({ where: { jobId: value.job.id } })).toBe(0)
    }))
  it.each(['worker', 'other-lane-job', 'other-lane-lease'] as const)(
    'rejects inspect and grant while a global %s proves writers are not stopped',
    async (blocker) =>
      isolated(async (tx) => {
        const value = await fixture(tx),
          inspected = ready(await value.inspect())
        if (blocker === 'worker') {
          await tx.workerInstance.create({
            data: {
              workerId: randomUUID(),
              status: 'READY',
              serviceVersion: 'test',
              hostname: 'test',
              processId: 1,
              heartbeatAt: now
            }
          })
        } else {
          const other = await tx.systemJob.create({
            data: {
              type: 'ARCHIVE_DOWNLOAD',
              executionLane: 'ARCHIVE_DOWNLOAD',
              status: blocker === 'other-lane-job' ? 'RUNNING' : 'FAILED',
              ...(blocker === 'other-lane-job'
                ? {
                    attempt: 1,
                    workerId: 'other-worker',
                    leaseToken: randomUUID(),
                    leaseExpiresAt: new Date(now.getTime() + 60_000)
                  }
                : {}),
              payload: {}
            }
          })
          if (blocker === 'other-lane-lease')
            await tx.jobResourceLease.create({
              data: {
                resourceKey: 'lane/archive-download',
                ownerJobId: other.id,
                workerId: 'test',
                leaseToken: randomUUID(),
                expiresAt: new Date(now.getTime() + 60_000),
                heartbeatAt: now
              }
            })
        }
        expect(await value.inspect()).toEqual({ status: 'WRITING' })
        expect(
          await grantMediaContentRecovery(tx, {
            snapshot: inspected.snapshot,
            expectedDigest: inspected.digest,
            backupCheckpointRef: 'backup',
            operator: 'operator',
            confirmAllWritersStopped: true,
            now,
            readDomainSnapshot: value.readDomainSnapshot
          })
        ).toEqual({ status: 'WRITING' })
        expect(await tx.mediaContentRecoveryGrant.count({ where: { jobId: value.job.id } })).toBe(0)
      })
  )
  it.each(['lane/archive-download', 'lane/archive-resolve', 'lane/background-writer'])(
    'refuses the %s claim race even with no lease row',
    async (resourceKey) => {
      let release!: () => void, locked!: () => void
      const untilReleased = new Promise<void>((resolve) => {
          release = resolve
        }),
        whenLocked = new Promise<void>((resolve) => {
          locked = resolve
        })
      const dispatcher = database!.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resourceKey}, 0))::text`
          locked()
          await untilReleased
        },
        { timeout: 20_000 }
      )
      try {
        await whenLocked
        await isolated(async (tx) => {
          const value = await fixture(tx)
          expect(await value.inspect()).toEqual({ status: 'WRITING' })
        })
      } finally {
        release()
        await dispatcher
      }
    }
  )
  it('freezes exact evidence, consumes once for the next attempt, and resumes the same execution after legitimate progress', async () =>
    isolated(async (tx) => {
      const value = await fixture(tx)
      const inspected = ready(await value.inspect())
      expect(parseMediaContentRecoverySnapshot(JSON.parse(JSON.stringify(inspected.snapshot)))).toEqual(
        inspected.snapshot
      )
      expect(inspected.snapshot.artworkStates[0]!.memberCount).toBe('1')
      const granted = await value.grant()
      expect(granted.nextAttempt).toBe(2)
      const before = await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: value.artwork.id } })
      const newOwner = await value.activate()
      const consumed = ready(await value.consume(newOwner))
      expect(consumed.source).toEqual(value.source)
      expect(consumed.handles[0]!.declarationVersion).toBe(value.handle.declarationVersion + 1n)
      expect(await tx.artworkContentSource.findUniqueOrThrow({ where: { artworkId: value.artwork.id } })).toEqual(
        before
      )
      value.changeDomain()
      await tx.image.update({ where: { id: value.image.id }, data: { size: 6n } })
      expect(ready(await value.consume(newOwner))).toEqual(consumed)
      expect(await tx.systemJobEvent.count({ where: { jobId: value.job.id, type: 'MEDIA_RECOVERY_CONSUMED' } })).toBe(1)
      expect(
        await revokeMediaContentRecovery(tx, {
          grantId: granted.grantId,
          operator: 'operator',
          reason: 'too late',
          now
        })
      ).toEqual({ status: 'STALE' })
      expect(await value.consume(await value.activate(3))).toEqual({ status: 'MISSING' })
      expect(await tx.mediaContentPathWrite.findUnique({ where: { id: value.handle.writeId } })).toMatchObject({
        executionAttempt: 2,
        status: 'ACTIVE'
      })
    }))
  it.each(['domain', 'source', 'root', 'scope', 'payload', 'wrong-attempt', 'expired-lease'] as const)(
    'keeps every gate when first consumption rejects %s changes',
    async (failure) =>
      isolated(async (tx) => {
        const value = await fixture(tx),
          granted = await value.grant(),
          owner = await value.activate(failure === 'wrong-attempt' ? 3 : 2)
        if (failure === 'domain') value.changeDomain()
        if (failure === 'source') await tx.image.update({ where: { id: value.image.id }, data: { size: 8n } })
        if (failure === 'payload')
          await tx.systemJob.update({ where: { id: value.job.id }, data: { payload: { changed: true } } })
        if (failure === 'expired-lease')
          await tx.jobResourceLease.update({
            where: { resourceKey: 'lane/background-writer' },
            data: { expiresAt: now }
          })
        const scopes = [
          {
            directory: { ...value.directory, ...(failure === 'root' ? { rootIdentity: 'changed-root' } : {}) },
            scope: {
              ...value.scope,
              ...(failure === 'scope' ? { relativePath: `${value.directory.relativeDirectory}/different.mp4` } : {})
            }
          }
        ]
        expect(await value.consume(owner, scopes)).toEqual({ status: 'STALE' })
        expect(await tx.mediaContentRecoveryGrant.findUnique({ where: { id: granted.grantId } })).toMatchObject({
          status: 'ACTIVE',
          consumedAt: null
        })
        expect(await tx.mediaContentPathWrite.findUnique({ where: { id: value.handle.writeId } })).toMatchObject({
          executionToken: value.owner.execution!.executionToken,
          declarationVersion: value.handle.declarationVersion,
          status: 'ACTIVE'
        })
      })
  )
  it('rejects changed inspect evidence and live writers, and revokes without releasing gates', async () =>
    isolated(async (tx) => {
      const value = await fixture(tx),
        inspected = ready(await value.inspect())
      value.changeDomain()
      expect(
        await grantMediaContentRecovery(tx, {
          snapshot: inspected.snapshot,
          expectedDigest: inspected.digest,
          backupCheckpointRef: 'backup',
          operator: 'operator',
          confirmAllWritersStopped: true,
          now,
          readDomainSnapshot: value.readDomainSnapshot
        })
      ).toEqual({ status: 'STALE' })
      const granted = await value.grant()
      expect(
        ready(
          await revokeMediaContentRecovery(tx, {
            grantId: granted.grantId,
            operator: 'operator',
            reason: 'backup changed',
            now
          })
        ).status
      ).toBe('REVOKED')
      expect(await tx.mediaContentPathWrite.findUnique({ where: { id: value.handle.writeId } })).toMatchObject({
        status: 'ACTIVE',
        executionAttempt: 1
      })
      const newOwner = await value.activate()
      expect(await value.inspect()).toEqual({ status: 'WRITING' })
      expect(await value.consume(newOwner)).toEqual({ status: 'MISSING' })
    }))
  it('rejects partial multi-session inspection and cancelled or unsupported jobs', async () =>
    isolated(async (tx) => {
      const value = await fixture(tx)
      ready(
        await beginMediaContentPathWrite(tx, {
          directory: value.directory,
          scope: { kind: 'PATH', relativePath: `${value.directory.relativeDirectory}/b.mp4` },
          owner: { ...value.owner, sessionId: 'other-session' },
          writeToken: randomUUID(),
          upload: null,
          parent: null,
          now
        })
      )
      expect(await value.inspect()).toEqual({ status: 'STALE' })
      await tx.mediaContentPathWrite.deleteMany({ where: { jobId: value.job.id, sessionId: 'other-session' } })
      await tx.systemJob.update({ where: { id: value.job.id }, data: { status: 'CANCELLED' } })
      expect(await value.inspect()).toEqual({ status: 'WRITING' })
    }))
  it('applies the separate grant migration without rewriting existing jobs', async () => {
    const sql = await readFile(
        new URL('../../prisma/migrations/20261023003000_media_content_recovery_grants/migration.sql', import.meta.url),
        'utf8'
      ),
      schema = `recovery_migration_${randomUUID().replaceAll('-', '')}`
    await isolated(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      await tx.$executeRawUnsafe('CREATE TABLE system_jobs (id TEXT PRIMARY KEY)')
      await tx.$executeRawUnsafe("INSERT INTO system_jobs VALUES ('retained-job')")
      for (const statement of sql.trim().split(/;\s*(?=CREATE\b)/)) await tx.$executeRawUnsafe(statement)
      expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}".system_jobs`)).toEqual([{ id: 'retained-job' }])
      expect(await tx.$queryRawUnsafe(`SELECT * FROM "${schema}"."MediaContentRecoveryGrant"`)).toEqual([])
    })
  })
})

function recoveryDigest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    if (item !== null && typeof item === 'object')
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`)
        .join(',')}}`
    return JSON.stringify(item)
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}
