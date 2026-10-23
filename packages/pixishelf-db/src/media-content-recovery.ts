import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  assertContentHash,
  assertContentInteger,
  assertContentPath,
  assertContentText,
  contentIds,
  lockContentArtworks,
  lockContentDirectories,
  lockContentImages
} from './media-content-common'
import {
  MediaContentConflictError,
  type MediaContentDirectoryKey,
  type MediaContentOwner,
  type MediaContentResult,
  type MediaContentSourceWriteToken,
  type MediaContentTransaction,
  type MediaContentWriteHandle,
  type MediaContentWriteScope
} from './media-content-types'
import { assertMediaContentOwnerPublication, resumeMediaContentSourceWrite } from './media-content-writes'

export type MediaContentRecoveryDomainReader = (
  tx: MediaContentTransaction,
  input: { jobId: string; sessionId: string }
) => Promise<Prisma.JsonValue>
type SerializedOwner = Omit<MediaContentOwner, 'sessionVersion'> & { sessionVersion: string }
type SerializedHandle = Omit<MediaContentWriteHandle, 'declarationVersion'> & { declarationVersion: string }
export interface MediaContentRecoverySnapshot {
  version: 1
  job: { id: string; type: string; attempt: number; status: string; payloadSha256: string }
  sessionId: string
  domainSha256: string
  claims: Array<{
    handle: SerializedHandle
    owner: SerializedOwner
    directory: MediaContentDirectoryKey
    status: 'ACTIVE' | 'RECOVERY_REQUIRED'
  }>
  source: MediaContentSourceWriteToken
  artworkStates: Array<{
    artworkId: number
    revision: string
    mediaEpoch: string
    memberCount: string
    writeToken: string | null
  }>
  imageStates: Array<{
    imageId: number
    revision: string
    writeToken: string
    artworkId: number | null
    sourcePath: string
    size: string | null
  }>
}
const allowedTypes = new Set([
  'PENDING_REPLACE',
  'MIGRATION',
  'VIDEO_STREAMING_OPTIMIZATION',
  'ARCHIVE_MAINTENANCE',
  'ARCHIVE_PUBLISH'
])
const offlineStatuses = new Set(['PENDING', 'PAUSED', 'FAILED'])
const maxBytes = 1_048_576
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new TypeError('Recovery snapshot exceeds maximum depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`)
      .join(',')}}`
  throw new TypeError('Recovery snapshot must contain plain JSON')
}
function digest(value: unknown) {
  const encoded = canonical(value)
  if (Buffer.byteLength(encoded) > maxBytes) throw new TypeError('Recovery snapshot exceeds 1 MiB')
  return createHash('sha256').update(encoded).digest('hex')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid recovery snapshot object')
  return value as Record<string, unknown>
}
function text(value: unknown): asserts value is string {
  assertContentText(value as string, 'recovery snapshot field')
}
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError('Invalid recovery integer')
}
function decimal(value: unknown, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new TypeError('Invalid recovery bigint')
  assertContentInteger(BigInt(value), 'recovery bigint', positive)
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError('Invalid recovery scope size')
  return value
}

/** Files supplied to the offline CLI are untrusted until parsed and compared to a
 * fresh, locked database snapshot. No snapshot field is applied as a mutation. */
export function parseMediaContentRecoverySnapshot(value: unknown): MediaContentRecoverySnapshot {
  digest(value)
  const input = object(value),
    job = object(input.job),
    source = object(input.source)
  if (input.version !== 1) throw new TypeError('Unsupported recovery snapshot version')
  text(job.id)
  text(job.type)
  integer(job.attempt)
  text(job.status)
  text(input.sessionId)
  if (!allowedTypes.has(job.type) || !offlineStatuses.has(job.status)) throw new TypeError('Unsupported recovery job')
  assertContentHash(job.payloadSha256 as string)
  assertContentHash(input.domainSha256 as string)
  const claims = list(input.claims, 100)
  if (!claims.length) throw new TypeError('Recovery requires a complete nonempty declaration scope')
  const ids = new Set<string>()
  for (const value of claims) {
    const claim = object(value),
      handle = object(claim.handle),
      owner = object(claim.owner),
      execution = object(owner.execution),
      directory = object(claim.directory),
      scope = object(handle.scope)
    text(handle.writeId)
    text(handle.directoryId)
    text(handle.writeToken)
    decimal(handle.declarationVersion, true)
    if (ids.has(handle.writeId)) throw new TypeError('Repeated recovery declaration')
    ids.add(handle.writeId)
    if (
      handle.parentWriteId !== null ||
      owner.ownerUserId !== null ||
      owner.sessionId !== input.sessionId ||
      execution.jobId !== job.id ||
      !['ACTIVE', 'RECOVERY_REQUIRED'].includes(claim.status as string)
    )
      throw new TypeError('Recovery owner/scope mismatch')
    decimal(owner.sessionVersion, true)
    text(execution.executionToken)
    integer(execution.executionAttempt)
    if (execution.executionAttempt > job.attempt) throw new TypeError('Recovery attempt mismatch')
    if (directory.logicalRoot !== 'source-media:v1' && directory.logicalRoot !== 'archive-media:v1')
      throw new TypeError('Invalid recovery root')
    text(directory.rootIdentity)
    assertContentPath(directory.relativeDirectory as string, true)
    if (scope.kind === 'PATH') assertContentPath(scope.relativePath as string)
    else if (scope.kind !== 'DIRECTORY') throw new TypeError('Invalid recovery scope')
  }
  text(source.writeToken)
  contentIds(list(source.artworkIds, 100) as number[])
  contentIds(list(source.imageIds, 100) as number[])
  for (const value of list(input.artworkStates, 200)) {
    const state = object(value)
    integer(state.artworkId)
    decimal(state.revision)
    decimal(state.mediaEpoch)
    decimal(state.memberCount)
    if (state.writeToken !== null) text(state.writeToken)
  }
  for (const value of list(input.imageStates, 100)) {
    const state = object(value)
    integer(state.imageId)
    decimal(state.revision)
    text(state.writeToken)
    if (state.artworkId !== null) integer(state.artworkId)
    text(state.sourcePath)
    if (state.size !== null) decimal(state.size)
  }
  return value as MediaContentRecoverySnapshot
}
async function resultOf<T>(run: () => Promise<T>): Promise<MediaContentResult<T>> {
  try {
    return { status: 'READY', value: await run() }
  } catch (error) {
    if (error instanceof MediaContentConflictError) return { status: error.status }
    throw error
  }
}
async function lockJob(tx: MediaContentTransaction, jobId: string) {
  text(jobId)
  await tx.$queryRaw`SELECT "resourceKey" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM system_jobs WHERE id=${jobId} FOR UPDATE`
  const job = await tx.systemJob.findUnique({ where: { id: jobId } })
  if (!job) throw new MediaContentConflictError('MISSING')
  if (!allowedTypes.has(job.type) || job.executionLane !== 'BACKGROUND_WRITER' || job.attempt < 1)
    throw new MediaContentConflictError('STALE')
  return job
}
export async function lockMediaContentOfflineDispatchers(tx: MediaContentTransaction) {
  // These are the queue runtime's claim keys. Locking even absent lease rows
  // prevents a new execution from starting between the idle check and grant.
  for (const resourceKey of ['lane/archive-download', 'lane/archive-resolve', 'lane/background-writer']) {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${resourceKey}, 0)) AS locked`
    if (!lock?.locked) throw new MediaContentConflictError('WRITING')
  }
}
export async function assertMediaContentWritersStopped(tx: MediaContentTransaction, now: Date) {
  if (
    (await tx.systemJob.findFirst({
      where: { status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] } },
      select: { id: true }
    })) ||
    (await tx.jobResourceLease.findFirst({ where: { expiresAt: { gt: now } }, select: { resourceKey: true } })) ||
    (await tx.workerInstance.findFirst({
      where: {
        status: { in: ['STARTING', 'READY', 'DEGRADED'] },
        heartbeatAt: { gte: new Date(now.getTime() - 60_000) }
      },
      select: { workerId: true }
    }))
  )
    throw new MediaContentConflictError('WRITING')
}
async function assertOffline(tx: MediaContentTransaction, job: Awaited<ReturnType<typeof lockJob>>, now: Date) {
  if (!offlineStatuses.has(job.status) || job.cancelRequestedAt || (job.leaseExpiresAt && job.leaseExpiresAt > now))
    throw new MediaContentConflictError('WRITING')
  await assertMediaContentWritersStopped(tx, now)
}
async function snapshotFromLockedJob(
  tx: MediaContentTransaction,
  job: Awaited<ReturnType<typeof lockJob>>,
  sessionId: string,
  readDomainSnapshot: MediaContentRecoveryDomainReader
): Promise<MediaContentRecoverySnapshot> {
  text(sessionId)
  const initial = await tx.mediaContentPathWrite.findMany({
    where: { jobId: job.id, status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] } },
    include: { directory: true },
    orderBy: { id: 'asc' },
    take: 101
  })
  if (!initial.length) throw new MediaContentConflictError('MISSING')
  if (
    initial.length > 100 ||
    initial.some(
      (row) =>
        row.sessionId !== sessionId ||
        row.parentWriteId !== null ||
        row.ownerUserId !== null ||
        row.declaredFileSize !== null ||
        row.totalChunks !== null ||
        row.status === 'READY' ||
        !row.executionToken ||
        !row.executionAttempt
    )
  )
    throw new MediaContentConflictError('STALE')
  await lockContentDirectories(
    tx,
    initial.map((row) => ({
      logicalRoot: row.directory.logicalRoot as MediaContentDirectoryKey['logicalRoot'],
      rootIdentity: row.directory.rootIdentity,
      relativeDirectory: row.directory.relativeDirectory
    }))
  )
  const ids = initial.map((row) => row.id)
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaContentPathWrite" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
  )
  const rows = await tx.mediaContentPathWrite.findMany({
    where: { id: { in: ids } },
    include: { directory: true },
    orderBy: { id: 'asc' }
  })
  if (
    rows.some(
      (row) =>
        !['ACTIVE', 'RECOVERY_REQUIRED'].includes(row.status) || row.sessionId !== sessionId || row.ownerUserId !== null
    )
  )
    throw new MediaContentConflictError('STALE')
  const tokens = rows.map((row) => row.writeToken)
  for (const token of [...tokens].sort())
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media-content-source:${token}`}, 0))::text`
  const [artSources, imageSources] = await Promise.all([
    tx.artworkContentSource.findMany({
      where: { writeToken: { in: tokens } },
      orderBy: { artworkId: 'asc' },
      take: 101
    }),
    tx.mediaContentSource.findMany({
      where: { writeToken: { in: tokens } },
      include: { image: { select: { artworkId: true } } },
      orderBy: { imageId: 'asc' },
      take: 101
    })
  ])
  if (artSources.length > 100 || imageSources.length > 100) throw new MediaContentConflictError('STALE')
  const heldTokens = [...new Set([...artSources, ...imageSources].map((row) => row.writeToken!))]
  if (heldTokens.length > 1) throw new MediaContentConflictError('STALE')
  const artworkIds = [
    ...new Set([
      ...artSources.map((row) => row.artworkId),
      ...imageSources.flatMap((row) => (row.image.artworkId === null ? [] : [row.image.artworkId]))
    ])
  ].sort((a, b) => a - b)
  await lockContentArtworks(tx, artworkIds)
  await lockContentImages(
    tx,
    imageSources.map((row) => row.imageId)
  )
  const [artworks, images] = await Promise.all([
    tx.artwork.findMany({
      where: { id: { in: artworkIds } },
      select: { id: true, contentSource: true, _count: { select: { images: true } } },
      orderBy: { id: 'asc' }
    }),
    tx.mediaContentSource.findMany({
      where: { imageId: { in: imageSources.map((row) => row.imageId) } },
      include: { image: { select: { artworkId: true, path: true, size: true } } },
      orderBy: { imageId: 'asc' }
    })
  ])
  if (
    artworks.length !== artworkIds.length ||
    images.length !== imageSources.length ||
    images.some((row) => row.writeToken !== heldTokens[0])
  )
    throw new MediaContentConflictError('STALE')
  return {
    version: 1,
    job: { id: job.id, type: job.type, attempt: job.attempt, status: job.status, payloadSha256: digest(job.payload) },
    sessionId,
    domainSha256: digest(await readDomainSnapshot(tx, { jobId: job.id, sessionId })),
    claims: rows.map((row) => ({
      handle: {
        writeId: row.id,
        directoryId: row.directoryId,
        writeToken: row.writeToken,
        declarationVersion: row.declarationVersion.toString(),
        scope: row.scope === 'DIRECTORY' ? { kind: 'DIRECTORY' } : { kind: 'PATH', relativePath: row.relativePath! },
        parentWriteId: null
      },
      owner: {
        ownerUserId: null,
        sessionId: row.sessionId,
        sessionVersion: row.sessionVersion.toString(),
        execution: { jobId: job.id, executionToken: row.executionToken!, executionAttempt: row.executionAttempt! }
      },
      directory: {
        logicalRoot: row.directory.logicalRoot as MediaContentDirectoryKey['logicalRoot'],
        rootIdentity: row.directory.rootIdentity,
        relativeDirectory: row.directory.relativeDirectory
      },
      status: row.status as 'ACTIVE' | 'RECOVERY_REQUIRED'
    })),
    source: {
      writeToken: heldTokens[0] ?? rows[0]!.writeToken,
      artworkIds: artSources.map((row) => row.artworkId),
      imageIds: images.map((row) => row.imageId)
    },
    artworkStates: artworks.map((row) => ({
      artworkId: row.id,
      revision: (row.contentSource?.revision ?? 0n).toString(),
      mediaEpoch: (row.contentSource?.mediaEpoch ?? 0n).toString(),
      memberCount: row._count.images.toString(),
      writeToken: row.contentSource?.writeToken ?? null
    })),
    imageStates: images.map((row) => ({
      imageId: row.imageId,
      revision: row.revision.toString(),
      writeToken: row.writeToken!,
      artworkId: row.image.artworkId,
      sourcePath: row.image.path,
      size: row.image.size?.toString() ?? null
    }))
  }
}
export async function inspectMediaContentRecovery(
  tx: MediaContentTransaction,
  input: { jobId: string; sessionId: string; now: Date; readDomainSnapshot: MediaContentRecoveryDomainReader }
): Promise<MediaContentResult<{ snapshot: MediaContentRecoverySnapshot; digest: string }>> {
  return resultOf(async () => {
    await lockMediaContentOfflineDispatchers(tx)
    const job = await lockJob(tx, input.jobId)
    await assertOffline(tx, job, input.now)
    const snapshot = await snapshotFromLockedJob(tx, job, input.sessionId, input.readDomainSnapshot)
    parseMediaContentRecoverySnapshot(snapshot)
    return { snapshot, digest: digest(snapshot) }
  })
}
export async function grantMediaContentRecovery(
  tx: MediaContentTransaction,
  input: {
    snapshot: unknown
    expectedDigest: string
    backupCheckpointRef: string
    operator: string
    confirmAllWritersStopped: true
    now: Date
    readDomainSnapshot: MediaContentRecoveryDomainReader
  }
): Promise<MediaContentResult<{ grantId: string; nextAttempt: number }>> {
  const snapshot = parseMediaContentRecoverySnapshot(input.snapshot)
  text(input.backupCheckpointRef)
  text(input.operator)
  assertContentHash(input.expectedDigest)
  if (input.confirmAllWritersStopped !== true) throw new TypeError('Explicit offline confirmation is required')
  return resultOf(async () => {
    if (digest(snapshot) !== input.expectedDigest) throw new MediaContentConflictError('STALE')
    const inspected = await inspectMediaContentRecovery(tx, {
      jobId: snapshot.job.id,
      sessionId: snapshot.sessionId,
      now: input.now,
      readDomainSnapshot: input.readDomainSnapshot
    })
    if (inspected.status !== 'READY') throw new MediaContentConflictError(inspected.status)
    if (inspected.value.digest !== input.expectedDigest) throw new MediaContentConflictError('STALE')
    const active = await tx.mediaContentRecoveryGrant.findFirst({
      where: { jobId: snapshot.job.id, sessionId: snapshot.sessionId, status: 'ACTIVE' }
    })
    if (active) {
      if (
        active.expectedAttempt !== snapshot.job.attempt ||
        active.targetAttempt !== snapshot.job.attempt + 1 ||
        active.snapshotSha256 !== input.expectedDigest ||
        canonical(active.snapshot) !== canonical(snapshot) ||
        active.operator !== input.operator ||
        active.backupCheckpointRef !== input.backupCheckpointRef
      )
        throw new MediaContentConflictError('STALE')
      return { grantId: active.id, nextAttempt: active.targetAttempt }
    }
    // A lost response may be replayed only while that exact authorization remains active.
    const retired = await tx.mediaContentRecoveryGrant.findFirst({
      where: {
        jobId: snapshot.job.id,
        sessionId: snapshot.sessionId,
        backupCheckpointRef: input.backupCheckpointRef,
        status: { in: ['CONSUMED', 'REVOKED'] }
      }
    })
    if (retired) throw new MediaContentConflictError('STALE')
    const grant = await tx.mediaContentRecoveryGrant.create({
      data: {
        jobId: snapshot.job.id,
        sessionId: snapshot.sessionId,
        expectedAttempt: snapshot.job.attempt,
        targetAttempt: snapshot.job.attempt + 1,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotSha256: input.expectedDigest,
        backupCheckpointRef: input.backupCheckpointRef,
        operator: input.operator,
        createdAt: input.now
      }
    })
    await audit(
      tx,
      grant.jobId,
      'MEDIA_RECOVERY_GRANTED',
      grant.expectedAttempt,
      { grantId: grant.id, snapshotSha256: grant.snapshotSha256, operator: input.operator },
      input.now
    )
    return { grantId: grant.id, nextAttempt: grant.targetAttempt }
  })
}
export async function resumeGrantedMediaContentRecovery(
  tx: MediaContentTransaction,
  input: {
    grantId: string
    operator: string
    confirmAllWritersStopped: true
    now: Date
    readDomainSnapshot: MediaContentRecoveryDomainReader
  }
): Promise<
  MediaContentResult<{ grantId: string; jobId: string; status: 'PENDING'; nextAttempt: number; reused: boolean }>
> {
  text(input.grantId)
  text(input.operator)
  if (input.confirmAllWritersStopped !== true) throw new TypeError('Explicit offline confirmation is required')
  return resultOf(async () => {
    await lockMediaContentOfflineDispatchers(tx)
    const found = await tx.mediaContentRecoveryGrant.findUnique({ where: { id: input.grantId } })
    if (!found) throw new MediaContentConflictError('MISSING')
    const job = await lockJob(tx, found.jobId)
    await tx.$queryRaw`SELECT id FROM "MediaContentRecoveryGrant" WHERE id=${found.id} FOR UPDATE`
    const grant = await tx.mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: found.id } })
    const snapshot = parseMediaContentRecoverySnapshot(grant.snapshot)
    if (
      grant.status !== 'ACTIVE' ||
      grant.jobId !== snapshot.job.id ||
      grant.sessionId !== snapshot.sessionId ||
      grant.expectedAttempt !== job.attempt ||
      grant.expectedAttempt !== snapshot.job.attempt ||
      grant.targetAttempt !== job.attempt + 1 ||
      digest(snapshot) !== grant.snapshotSha256
    ) {
      throw new MediaContentConflictError('STALE')
    }
    await assertOffline(tx, job, input.now)
    if (job.type === 'ARCHIVE_PUBLISH') {
      await tx.$queryRaw`SELECT id FROM archive_imports WHERE "systemJobId"=${job.id} FOR UPDATE`
    }
    const publication =
      job.type === 'ARCHIVE_PUBLISH' ? await tx.archiveImport.findUnique({ where: { systemJobId: job.id } }) : null
    if (
      job.type === 'ARCHIVE_PUBLISH' &&
      (!publication ||
        publication.phase !== 'PUBLISH' ||
        publication.cleanupRequestedAt ||
        grant.sessionId !== `archive-publish:${publication.id}` ||
        !['PENDING', 'PAUSED', 'FAILED'].includes(publication.status))
    ) {
      throw new MediaContentConflictError('STALE')
    }
    const resumedEvent = await tx.systemJobEvent.findFirst({
      where: {
        jobId: job.id,
        type: 'job.queued',
        attempt: job.attempt,
        AND: [
          { data: { path: ['reason'], equals: 'MEDIA_CONTENT_RECOVERY_GRANTED' } },
          { data: { path: ['grantId'], equals: grant.id } }
        ]
      },
      select: { id: true }
    })
    const reused = job.status === 'PENDING' && resumedEvent !== null
    if (reused && publication && publication.status !== 'PENDING') throw new MediaContentConflictError('STALE')
    if (job.status !== snapshot.job.status && !reused) throw new MediaContentConflictError('STALE')
    const current = await snapshotFromLockedJob(tx, job, grant.sessionId, input.readDomainSnapshot)
    if (reused) current.job.status = snapshot.job.status
    if (digest(current) !== grant.snapshotSha256) throw new MediaContentConflictError('STALE')
    if (!reused) {
      const priority = Math.min(job.queuePriority, 99)
      const changed = await tx.systemJob.updateMany({
        where: { id: job.id, status: job.status, attempt: grant.expectedAttempt },
        data: {
          status: 'PENDING',
          availableAt: input.now,
          finishedAt: null,
          errorCode: null,
          error: null,
          pauseRequestedAt: null,
          cancelRequestedAt: null,
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          maxAttempts: Math.max(job.maxAttempts, grant.targetAttempt),
          triggerSource: 'RETRY',
          queuePriority: priority,
          effectivePriority: priority,
          deadlineAt: null,
          message: 'Media recovery authorized; waiting for the original job to continue'
        }
      })
      if (changed.count !== 1) throw new MediaContentConflictError('STALE')
      if (publication) {
        const resumedPublication = await tx.archiveImport.updateMany({
          where: {
            id: publication.id,
            systemJobId: job.id,
            phase: 'PUBLISH',
            status: publication.status,
            cleanupRequestedAt: null
          },
          data: {
            status: 'PENDING',
            decisionCode: null,
            errorCode: null,
            errorMessage: null,
            finishedAt: null,
            retainUntil: null
          }
        })
        if (resumedPublication.count !== 1) throw new Error('Archive publication resume CAS lost; rollback required')
      }
      await tx.systemJobFailureAcknowledgement.deleteMany({ where: { jobId: job.id } })
      await audit(
        tx,
        job.id,
        'job.queued',
        job.attempt,
        {
          reason: 'MEDIA_CONTENT_RECOVERY_GRANTED',
          grantId: grant.id,
          operator: input.operator,
          previousStatus: snapshot.job.status,
          nextAttempt: grant.targetAttempt
        },
        input.now
      )
    }
    return { grantId: grant.id, jobId: job.id, status: 'PENDING', nextAttempt: grant.targetAttempt, reused }
  })
}

function handleOf(value: SerializedHandle): MediaContentWriteHandle {
  return { ...value, declarationVersion: BigInt(value.declarationVersion) }
}
function scopeDigest(scopes: Array<{ directory: MediaContentDirectoryKey; scope: MediaContentWriteScope }>) {
  return digest(scopes.map((scope) => canonical(scope)).sort())
}
async function assertRunning(
  tx: MediaContentTransaction,
  job: Awaited<ReturnType<typeof lockJob>>,
  owner: MediaContentOwner,
  now: Date
) {
  if (
    !owner.execution ||
    owner.ownerUserId !== null ||
    job.status !== 'RUNNING' ||
    job.id !== owner.execution.jobId ||
    job.attempt !== owner.execution.executionAttempt ||
    job.leaseToken !== owner.execution.executionToken ||
    !job.workerId ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= now ||
    job.cancelRequestedAt ||
    job.pauseRequestedAt
  )
    throw new MediaContentConflictError('STALE')
  const lease = await tx.jobResourceLease.findUnique({ where: { resourceKey: 'lane/background-writer' } })
  if (
    !lease ||
    lease.ownerJobId !== job.id ||
    lease.workerId !== job.workerId ||
    lease.leaseToken !== owner.execution.executionToken ||
    lease.expiresAt <= now
  )
    throw new MediaContentConflictError('STALE')
}
export async function consumeMediaContentRecovery(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    expectedScopes: Array<{ directory: MediaContentDirectoryKey; scope: MediaContentWriteScope }>
    artworkIds: number[]
    imageIds: number[]
    readDomainSnapshot: MediaContentRecoveryDomainReader
    now: Date
  }
): Promise<
  MediaContentResult<{
    owner: MediaContentOwner
    handles: MediaContentWriteHandle[]
    source: MediaContentSourceWriteToken
  }>
> {
  contentIds(input.artworkIds)
  contentIds(input.imageIds)
  if (!input.expectedScopes.length || input.expectedScopes.length > 100 || !input.owner.execution)
    throw new TypeError('Invalid recovery execution scope')
  return resultOf(async () => {
    const candidateWhere: Prisma.MediaContentRecoveryGrantWhereInput = {
      jobId: input.owner.execution!.jobId,
      sessionId: input.owner.sessionId,
      OR: [
        { status: 'ACTIVE' },
        {
          status: 'CONSUMED',
          targetAttempt: input.owner.execution!.executionAttempt,
          consumedExecutionToken: input.owner.execution!.executionToken
        }
      ]
    }
    // Ordinary writes still rely on their existing runtime fence. Recovery
    // adds no clock, job-type or locking requirement when there is no grant.
    if (!(await tx.mediaContentRecoveryGrant.findFirst({ where: candidateWhere, select: { id: true } })))
      throw new MediaContentConflictError('MISSING')
    const job = await lockJob(tx, input.owner.execution!.jobId)
    await assertRunning(tx, job, input.owner, input.now)
    const candidates = await tx.mediaContentRecoveryGrant.findMany({
      where: candidateWhere,
      orderBy: { createdAt: 'desc' },
      take: 2
    })
    if (!candidates.length) throw new MediaContentConflictError('MISSING')
    if (candidates.length !== 1) throw new MediaContentConflictError('STALE')
    const grant = candidates[0]!
    await tx.$queryRaw`SELECT id FROM "MediaContentRecoveryGrant" WHERE id=${grant.id} FOR UPDATE`
    const snapshot = parseMediaContentRecoverySnapshot(grant.snapshot)
    if (
      grant.targetAttempt !== job.attempt ||
      snapshot.job.type !== job.type ||
      snapshot.job.payloadSha256 !== digest(job.payload) ||
      digest(snapshot) !== grant.snapshotSha256 ||
      scopeDigest(input.expectedScopes) !==
        scopeDigest(snapshot.claims.map((claim) => ({ directory: claim.directory, scope: claim.handle.scope }))) ||
      digest([...input.artworkIds].sort((a, b) => a - b)) !== digest(snapshot.source.artworkIds) ||
      digest([...input.imageIds].sort((a, b) => a - b)) !== digest(snapshot.source.imageIds)
    )
      throw new MediaContentConflictError('STALE')
    if (snapshot.claims.some((claim) => claim.owner.sessionVersion !== input.owner.sessionVersion.toString()))
      throw new MediaContentConflictError('STALE')
    if (grant.status === 'CONSUMED') {
      const current = await snapshotFromLockedJob(tx, job, input.owner.sessionId, input.readDomainSnapshot)
      if (
        current.claims.length !== snapshot.claims.length ||
        scopeDigest(current.claims.map((claim) => ({ directory: claim.directory, scope: claim.handle.scope }))) !==
          scopeDigest(input.expectedScopes) ||
        current.claims.some(
          (claim, i) =>
            claim.handle.writeId !== snapshot.claims[i]!.handle.writeId ||
            claim.handle.writeToken !== snapshot.claims[i]!.handle.writeToken ||
            BigInt(claim.handle.declarationVersion) !== BigInt(snapshot.claims[i]!.handle.declarationVersion) + 1n
        )
      )
        throw new MediaContentConflictError('STALE')
      const handles = current.claims.map((claim) => handleOf(claim.handle))
      await assertMediaContentOwnerPublication(tx, { owner: input.owner, handles })
      const resumed = await resumeMediaContentSourceWrite(tx, { token: snapshot.source })
      if (resumed.status !== 'READY') throw new MediaContentConflictError('STALE')
      return { owner: input.owner, handles, source: resumed.value }
    }
    const current = await snapshotFromLockedJob(tx, job, input.owner.sessionId, input.readDomainSnapshot)
    current.job = snapshot.job
    if (digest(current) !== grant.snapshotSha256) throw new MediaContentConflictError('STALE')
    const changed = await tx.mediaContentPathWrite.updateMany({
      where: {
        OR: snapshot.claims.map((claim) => ({
          id: claim.handle.writeId,
          writeToken: claim.handle.writeToken,
          declarationVersion: BigInt(claim.handle.declarationVersion),
          status: claim.status,
          ownerUserId: null,
          sessionId: claim.owner.sessionId,
          sessionVersion: BigInt(claim.owner.sessionVersion),
          jobId: claim.owner.execution!.jobId,
          executionToken: claim.owner.execution!.executionToken,
          executionAttempt: claim.owner.execution!.executionAttempt
        }))
      },
      data: {
        executionToken: input.owner.execution!.executionToken,
        executionAttempt: job.attempt,
        status: 'ACTIVE',
        declarationVersion: { increment: 1n }
      }
    })
    if (changed.count !== snapshot.claims.length) throw new Error('Recovery declaration CAS lost; rollback required')
    const consumed = await tx.mediaContentRecoveryGrant.updateMany({
      where: { id: grant.id, status: 'ACTIVE', targetAttempt: job.attempt },
      data: { status: 'CONSUMED', consumedAt: input.now, consumedExecutionToken: input.owner.execution!.executionToken }
    })
    if (consumed.count !== 1) throw new Error('Recovery grant CAS lost; rollback required')
    await audit(
      tx,
      job.id,
      'MEDIA_RECOVERY_CONSUMED',
      job.attempt,
      {
        grantId: grant.id,
        snapshotSha256: grant.snapshotSha256,
        executionToken: input.owner.execution!.executionToken
      },
      input.now
    )
    return {
      owner: input.owner,
      handles: snapshot.claims.map((claim) => ({
        ...handleOf(claim.handle),
        declarationVersion: BigInt(claim.handle.declarationVersion) + 1n
      })),
      source: snapshot.source
    }
  })
}
export async function revokeMediaContentRecovery(
  tx: MediaContentTransaction,
  input: { grantId: string; operator: string; reason: string; now: Date }
): Promise<MediaContentResult<{ grantId: string; status: 'REVOKED' }>> {
  text(input.operator)
  text(input.reason)
  return resultOf(async () => {
    const found = await tx.mediaContentRecoveryGrant.findUnique({ where: { id: input.grantId } })
    if (!found) throw new MediaContentConflictError('MISSING')
    await lockJob(tx, found.jobId)
    await tx.$queryRaw`SELECT id FROM "MediaContentRecoveryGrant" WHERE id=${found.id} FOR UPDATE`
    const current = await tx.mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: found.id } })
    if (current.status === 'CONSUMED') throw new MediaContentConflictError('STALE')
    if (current.status === 'ACTIVE') {
      await tx.mediaContentRecoveryGrant.update({
        where: { id: current.id },
        data: { status: 'REVOKED', revokedAt: input.now, revokedBy: input.operator, revocationReason: input.reason }
      })
      await audit(
        tx,
        current.jobId,
        'MEDIA_RECOVERY_REVOKED',
        current.expectedAttempt,
        { grantId: current.id, operator: input.operator, reason: input.reason },
        input.now
      )
    }
    return { grantId: current.id, status: 'REVOKED' }
  })
}
async function audit(
  tx: MediaContentTransaction,
  jobId: string,
  type: string,
  attempt: number,
  data: Prisma.InputJsonObject,
  now: Date
) {
  await tx.systemJobEvent.create({ data: { jobId, type, level: 'INFO', attempt, data, createdAt: now } })
}
