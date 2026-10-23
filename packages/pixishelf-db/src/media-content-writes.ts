import { Prisma, type MediaContentPathWrite } from '@prisma/client'
import {
  ACTIVE_CONTENT_WRITES,
  advanceArtworkContent,
  advanceDirectoryContent,
  assertContentHash,
  assertContentInteger,
  assertContentLimit,
  assertContentPath,
  assertContentText,
  contentIds,
  directorySnapshot,
  insideDirectory,
  lockContentArtworks,
  lockContentDirectories,
  lockContentImages
} from './media-content-common'
import {
  MediaContentConflictError,
  type MediaContentChildResolution,
  type MediaContentChunkReceipt,
  type MediaContentDirectoryKey,
  type MediaContentOwner,
  type MediaContentResult,
  type MediaContentSourceWriteToken,
  type MediaContentTransaction,
  type MediaContentUploadCheckpoint,
  type MediaContentWriteHandle,
  type MediaContentWriteScope
} from './media-content-types'

function ownerData(owner: MediaContentOwner) {
  assertContentText(owner.sessionId, 'session ID')
  assertContentInteger(owner.sessionVersion, 'session version', true)
  if (owner.ownerUserId !== null) assertContentText(owner.ownerUserId, 'owner user ID')
  if (owner.execution) {
    assertContentText(owner.execution.jobId, 'job ID')
    assertContentText(owner.execution.executionToken, 'execution token')
    assertContentLimit(owner.execution.executionAttempt, 2_147_483_647)
  }
  return {
    ownerUserId: owner.ownerUserId,
    sessionId: owner.sessionId,
    sessionVersion: owner.sessionVersion,
    jobId: owner.execution?.jobId ?? null,
    executionToken: owner.execution?.executionToken ?? null,
    executionAttempt: owner.execution?.executionAttempt ?? null
  }
}
function sameOwner(row: MediaContentPathWrite, owner: MediaContentOwner) {
  const data = ownerData(owner)
  return (
    row.ownerUserId === data.ownerUserId &&
    row.sessionId === data.sessionId &&
    row.sessionVersion === data.sessionVersion &&
    row.jobId === data.jobId &&
    row.executionToken === data.executionToken &&
    row.executionAttempt === data.executionAttempt
  )
}
function handleOf(row: MediaContentPathWrite): MediaContentWriteHandle {
  return {
    writeId: row.id,
    directoryId: row.directoryId,
    writeToken: row.writeToken,
    declarationVersion: row.declarationVersion,
    scope: row.scope === 'DIRECTORY' ? { kind: 'DIRECTORY' } : { kind: 'PATH', relativePath: row.relativePath! },
    parentWriteId: row.parentWriteId
  }
}
function sameHandle(row: MediaContentPathWrite, handle: MediaContentWriteHandle, version = true) {
  return (
    row.id === handle.writeId &&
    row.directoryId === handle.directoryId &&
    row.writeToken === handle.writeToken &&
    (!version || row.declarationVersion === handle.declarationVersion) &&
    row.parentWriteId === handle.parentWriteId &&
    row.scope === handle.scope.kind &&
    (handle.scope.kind === 'DIRECTORY' || row.relativePath === handle.scope.relativePath)
  )
}
function receiptOf(row: MediaContentPathWrite): MediaContentChunkReceipt | null {
  return row.lastRequestId === null
    ? null
    : {
        requestId: row.lastRequestId,
        chunkIndex: row.lastChunkIndex!,
        offset: row.lastChunkOffset!,
        byteLength: row.lastChunkBytes!,
        sha256: row.lastChunkSha256!
      }
}
function checkpointOf(row: MediaContentPathWrite): MediaContentUploadCheckpoint {
  if (row.declaredFileSize === null || row.totalChunks === null) throw new TypeError('Declaration is not an upload')
  return {
    handle: handleOf(row),
    status: row.status,
    declaredFileSize: row.declaredFileSize,
    totalChunks: row.totalChunks,
    nextChunkIndex: row.nextChunkIndex,
    committedBytes: row.committedBytes,
    lastReceipt: receiptOf(row)
  }
}
function sameReceipt(left: MediaContentChunkReceipt | null, right: MediaContentChunkReceipt) {
  return (
    left !== null &&
    left.requestId === right.requestId &&
    left.chunkIndex === right.chunkIndex &&
    left.offset === right.offset &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256
  )
}
async function ownedRow(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; writeId: string; writeToken: string }
) {
  assertContentText(input.writeToken, 'write token')
  const row = await tx.mediaContentPathWrite.findUnique({ where: { id: input.writeId } })
  return row && row.writeToken === input.writeToken && sameOwner(row, input.owner) ? row : null
}
async function lockOwnedRow(
  tx: MediaContentTransaction,
  owner: MediaContentOwner,
  handle: MediaContentWriteHandle,
  version = true
) {
  const row = await tx.mediaContentPathWrite.findUnique({ where: { id: handle.writeId }, include: { directory: true } })
  if (!row || !sameOwner(row, owner) || !sameHandle(row, handle, version)) throw new MediaContentConflictError('STALE')
  await lockContentDirectories(tx, [directorySnapshot(row.directory)])
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaContentPathWrite" WHERE id = ${row.id} FOR UPDATE`)
  const current = await tx.mediaContentPathWrite.findUniqueOrThrow({ where: { id: row.id } })
  if (!sameOwner(current, owner) || !sameHandle(current, handle, version)) throw new MediaContentConflictError('STALE')
  if (current.parentWriteId) {
    const parent = await tx.mediaContentPathWrite.findUnique({ where: { id: current.parentWriteId } })
    if (!parent || !sameOwner(parent, owner) || parent.status !== 'ACTIVE')
      throw new MediaContentConflictError('WRITING')
  }
  return { row: current, directory: directorySnapshot(row.directory) }
}
async function rejected<T>(operation: () => Promise<T>): Promise<MediaContentResult<T>> {
  try {
    return { status: 'READY', value: await operation() }
  } catch (error) {
    if (error instanceof MediaContentConflictError) return { status: error.status }
    throw error
  }
}
async function hasOverlap(
  tx: MediaContentTransaction,
  directory: MediaContentDirectoryKey,
  scope: MediaContentWriteScope,
  exceptIds: readonly string[] = []
) {
  return hasAnyOverlap(tx, [{ directory, scope }], exceptIds)
}
async function hasAnyOverlap(
  tx: MediaContentTransaction,
  targets: Array<{ directory: MediaContentDirectoryKey; scope: MediaContentWriteScope }>,
  exceptIds: readonly string[]
) {
  const contains = (ancestor: Prisma.Sql, descendant: Prisma.Sql) =>
    Prisma.sql`(${ancestor} = '' OR ${ancestor} = ${descendant} OR left(${descendant}, length(${ancestor}) + 1) = ${ancestor} || '/')`
  const otherDirectory = Prisma.sql`d."relativeDirectory"`
  const otherPath = Prisma.sql`w."relativePath"`
  const overlaps = targets.map(({ directory, scope }) => {
    const target = scope.kind === 'PATH' ? scope.relativePath : directory.relativeDirectory
    const own = Prisma.sql`${target}`
    const overlap =
      scope.kind === 'PATH'
        ? Prisma.sql`((w.scope = 'PATH' AND ${otherPath} = ${target}) OR (w.scope = 'DIRECTORY' AND ${contains(otherDirectory, own)}))`
        : Prisma.sql`((w.scope = 'PATH' AND ${contains(own, otherPath)}) OR (w.scope = 'DIRECTORY' AND (${contains(own, otherDirectory)} OR ${contains(otherDirectory, own)})))`
    return Prisma.sql`(d."logicalRoot" = ${directory.logicalRoot} AND ${overlap})`
  })
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(SELECT 1 FROM "MediaContentPathWrite" w JOIN "MediaContentDirectoryState" d ON d.id = w."directoryId" WHERE w."parentWriteId" IS NULL AND w.status IN ('ACTIVE','READY','RECOVERY_REQUIRED') AND (${Prisma.join(overlaps, ' OR ')}) ${exceptIds.length ? Prisma.sql`AND w.id NOT IN (${Prisma.join(exceptIds)})` : Prisma.empty}) AS "exists"`
  )
  return rows[0]!.exists
}

export async function beginMediaContentPathWrite(
  tx: MediaContentTransaction,
  input: {
    directory: MediaContentDirectoryKey
    scope: MediaContentWriteScope
    owner: MediaContentOwner
    writeToken: string
    upload: null | { declaredFileSize: bigint; totalChunks: number }
    parent: MediaContentWriteHandle | null
    now: Date
  }
): Promise<MediaContentResult<MediaContentWriteHandle>> {
  return rejected(async () => {
    const owner = ownerData(input.owner)
    assertContentText(input.writeToken, 'write token')
    if (input.scope.kind === 'PATH') {
      assertContentPath(input.scope.relativePath)
      if (
        !insideDirectory(input.directory.relativeDirectory, input.scope.relativePath) ||
        input.scope.relativePath === input.directory.relativeDirectory
      )
        throw new TypeError('Path is outside the declared directory')
    } else if (input.upload) throw new TypeError('Directory declarations cannot be chunked uploads')
    if (input.upload) {
      if (input.owner.ownerUserId === null) throw new TypeError('Uploads require a Session owner')
      assertContentInteger(input.upload.declaredFileSize, 'declared file size', true)
      assertContentLimit(input.upload.totalChunks, 2_147_483_647)
    }
    const dirs = await lockContentDirectories(tx, [input.directory])
    const directory = dirs.get(`${input.directory.logicalRoot}\0${input.directory.relativeDirectory}`)!
    const existing = await tx.mediaContentPathWrite.findUnique({ where: { writeToken: input.writeToken } })
    if (existing) {
      if (
        !sameOwner(existing, input.owner) ||
        existing.directoryId !== directory.id ||
        existing.scope !== input.scope.kind ||
        existing.relativePath !== (input.scope.kind === 'PATH' ? input.scope.relativePath : null) ||
        existing.parentWriteId !== (input.parent?.writeId ?? null) ||
        existing.declaredFileSize !== (input.upload?.declaredFileSize ?? null) ||
        existing.totalChunks !== (input.upload?.totalChunks ?? null)
      )
        throw new MediaContentConflictError('STALE')
      if (existing.status === 'RECOVERY_REQUIRED') throw new MediaContentConflictError('WRITING')
      if (existing.status !== 'ACTIVE' && existing.status !== 'READY') throw new MediaContentConflictError('STALE')
      return handleOf(existing)
    }
    if (input.parent) {
      if (input.scope.kind !== 'PATH') throw new TypeError('Only path uploads may be directory children')
      const parent = await tx.mediaContentPathWrite.findUnique({
        where: { id: input.parent.writeId },
        include: { directory: true }
      })
      if (
        !parent ||
        !sameOwner(parent, input.owner) ||
        !sameHandle(parent, input.parent) ||
        parent.scope !== 'DIRECTORY' ||
        parent.status !== 'ACTIVE' ||
        parent.directory.logicalRoot !== input.directory.logicalRoot ||
        !insideDirectory(parent.directory.relativeDirectory, input.scope.relativePath)
      )
        throw new MediaContentConflictError('STALE')
      const child = await tx.mediaContentPathWrite.findFirst({
        where: {
          parentWriteId: parent.id,
          relativePath: input.scope.relativePath,
          status: { in: [...ACTIVE_CONTENT_WRITES] }
        },
        select: { id: true }
      })
      if (child) throw new MediaContentConflictError('WRITING')
    }
    if (await hasOverlap(tx, input.directory, input.scope, input.parent ? [input.parent.writeId] : []))
      throw new MediaContentConflictError('WRITING')
    const row = await tx.mediaContentPathWrite.create({
      data: {
        directoryId: directory.id,
        scope: input.scope.kind,
        relativePath: input.scope.kind === 'PATH' ? input.scope.relativePath : null,
        parentWriteId: input.parent?.writeId ?? null,
        ...owner,
        writeToken: input.writeToken,
        declaredFileSize: input.upload?.declaredFileSize ?? null,
        totalChunks: input.upload?.totalChunks ?? null,
        startedAt: input.now
      }
    })
    await advanceDirectoryContent(tx, [directory.id], input.scope.kind === 'DIRECTORY' ? [directory.id] : [])
    return handleOf(row)
  })
}

export async function getMediaContentWriteHandle(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; writeId: string; writeToken: string }
): Promise<MediaContentResult<MediaContentWriteHandle>> {
  const row = await ownedRow(tx, input)
  return row ? { status: 'READY', value: handleOf(row) } : { status: 'MISSING' }
}
export async function getMediaContentUploadCheckpoint(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; writeId: string; writeToken: string }
): Promise<MediaContentResult<MediaContentUploadCheckpoint>> {
  const row = await ownedRow(tx, input)
  return row ? { status: 'READY', value: checkpointOf(row) } : { status: 'MISSING' }
}
export async function prepareMediaContentUploadChunk(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    handle: MediaContentWriteHandle
    declaredFileSize: bigint
    totalChunks: number
    requestId: string
    chunkIndex: number
    offset: bigint
    observedFileSize: bigint | null
  }
): Promise<MediaContentResult<{ action: 'WRITE' | 'REPLAY'; checkpoint: MediaContentUploadCheckpoint }>> {
  return rejected(async () => {
    assertContentText(input.requestId, 'chunk request ID')
    assertContentInteger(input.offset, 'chunk offset')
    const { row } = await lockOwnedRow(tx, input.owner, input.handle, false)
    if (row.declaredFileSize !== input.declaredFileSize || row.totalChunks !== input.totalChunks)
      throw new MediaContentConflictError('STALE')
    const receipt = receiptOf(row)
    if (
      receipt &&
      receipt.requestId === input.requestId &&
      receipt.chunkIndex === input.chunkIndex &&
      receipt.offset === input.offset &&
      row.status !== 'RECOVERY_REQUIRED' &&
      row.status !== 'ROLLED_BACK'
    )
      return { action: 'REPLAY', checkpoint: checkpointOf(row) }
    if (
      !sameHandle(row, input.handle) ||
      row.status !== 'ACTIVE' ||
      row.nextChunkIndex !== input.chunkIndex ||
      row.committedBytes !== input.offset
    )
      throw new MediaContentConflictError('STALE')
    // The first block may deliberately replace an existing file under the source gate.
    if (input.chunkIndex > 0 && input.observedFileSize !== row.committedBytes)
      throw new MediaContentConflictError('INCOMPLETE')
    return { action: 'WRITE', checkpoint: checkpointOf(row) }
  })
}
export async function ackMediaContentUploadChunk(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    handle: MediaContentWriteHandle
    receipt: MediaContentChunkReceipt
    verifiedFileSize: bigint
    now: Date
  }
): Promise<MediaContentResult<MediaContentUploadCheckpoint>> {
  return rejected(async () => {
    assertContentHash(input.receipt.sha256)
    assertContentText(input.receipt.requestId, 'receipt request ID')
    assertContentInteger(input.receipt.offset, 'receipt offset')
    assertContentInteger(input.receipt.byteLength, 'receipt length', true)
    const { row } = await lockOwnedRow(tx, input.owner, input.handle, false)
    if (
      sameReceipt(receiptOf(row), input.receipt) &&
      row.status !== 'RECOVERY_REQUIRED' &&
      row.status !== 'ROLLED_BACK'
    )
      return checkpointOf(row)
    if (
      !sameHandle(row, input.handle) ||
      row.status !== 'ACTIVE' ||
      row.declaredFileSize === null ||
      row.totalChunks === null ||
      input.receipt.chunkIndex !== row.nextChunkIndex ||
      input.receipt.offset !== row.committedBytes
    )
      throw new MediaContentConflictError('STALE')
    const bytes = row.committedBytes + input.receipt.byteLength
    const next = row.nextChunkIndex + 1
    if (
      bytes !== input.verifiedFileSize ||
      bytes > row.declaredFileSize ||
      next > row.totalChunks ||
      (next === row.totalChunks) !== (bytes === row.declaredFileSize)
    )
      throw new MediaContentConflictError('INCOMPLETE')
    const updated = await tx.mediaContentPathWrite.update({
      where: { id: row.id },
      data: {
        declarationVersion: { increment: 1n },
        nextChunkIndex: next,
        committedBytes: bytes,
        lastRequestId: input.receipt.requestId,
        lastChunkIndex: input.receipt.chunkIndex,
        lastChunkOffset: input.receipt.offset,
        lastChunkBytes: input.receipt.byteLength,
        lastChunkSha256: input.receipt.sha256,
        status: next === row.totalChunks ? 'READY' : 'ACTIVE'
      }
    })
    return checkpointOf(updated)
  })
}
export async function markMediaContentWriteRecoveryRequired(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; handle: MediaContentWriteHandle; failureCode: string; now: Date }
): Promise<MediaContentResult<MediaContentWriteHandle>> {
  return rejected(async () => {
    const { row } = await lockOwnedRow(tx, input.owner, input.handle)
    if (!ACTIVE_CONTENT_WRITES.includes(row.status as (typeof ACTIVE_CONTENT_WRITES)[number]))
      throw new MediaContentConflictError('STALE')
    assertContentText(input.failureCode, 'failure code')
    return handleOf(
      await tx.mediaContentPathWrite.update({
        where: { id: row.id },
        data: { status: 'RECOVERY_REQUIRED', failureCode: input.failureCode, declarationVersion: { increment: 1n } }
      })
    )
  })
}

/** The App holds the exact path's filesystem lock and has observed the prior
 * writer exit. This discards upload progress, never claims old bytes restored. */
export async function restartMediaContentUploadFromStart(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; handle: MediaContentWriteHandle; now: Date }
): Promise<MediaContentResult<MediaContentUploadCheckpoint>> {
  return rejected(async () => {
    if (
      input.owner.ownerUserId === null ||
      input.owner.execution !== null ||
      input.handle.parentWriteId !== null ||
      input.handle.scope.kind !== 'PATH'
    )
      throw new MediaContentConflictError('STALE')
    const { row } = await lockOwnedRow(tx, input.owner, input.handle)
    if (row.status !== 'RECOVERY_REQUIRED' || row.declaredFileSize === null || row.totalChunks === null)
      throw new MediaContentConflictError('STALE')
    const changed = await tx.mediaContentPathWrite.updateMany({
      where: {
        id: row.id,
        declarationVersion: row.declarationVersion,
        writeToken: row.writeToken,
        status: 'RECOVERY_REQUIRED',
        ...ownerData(input.owner)
      },
      data: {
        status: 'ACTIVE',
        declarationVersion: { increment: 1n },
        nextChunkIndex: 0,
        committedBytes: 0n,
        lastRequestId: null,
        lastChunkIndex: null,
        lastChunkOffset: null,
        lastChunkBytes: null,
        lastChunkSha256: null,
        failureCode: null,
        childDisposition: null,
        resolutionEvidenceId: null,
        resolvedAt: null,
        finishedAt: null
      }
    })
    if (changed.count !== 1) throw new MediaContentConflictError('STALE')
    return checkpointOf(await tx.mediaContentPathWrite.findUniqueOrThrow({ where: { id: row.id } }))
  })
}
export async function resolveMediaContentChildWrites(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    parent: MediaContentWriteHandle
    children: Array<{ handle: MediaContentWriteHandle; resolution: MediaContentChildResolution }>
    now: Date
  }
): Promise<MediaContentResult<{ children: MediaContentWriteHandle[] }>> {
  return rejected(async () => {
    assertContentLimit(input.children.length, 100)
    if (new Set(input.children.map((child) => child.handle.writeId)).size !== input.children.length)
      throw new TypeError('Repeated child declaration')
    const ids = input.children.map((child) => child.handle.writeId)
    const allIds = [input.parent.writeId, ...ids]
    const initial = await tx.mediaContentPathWrite.findMany({
      where: { id: { in: allIds } },
      include: { directory: true }
    })
    const parent = initial.find((row) => row.id === input.parent.writeId)
    if (!parent || initial.length !== allIds.length) throw new MediaContentConflictError('STALE')
    const childRows = initial.filter((row) => row.id !== parent.id)
    for (const child of childRows)
      if (
        child.parentWriteId !== parent.id ||
        child.directory.logicalRoot !== parent.directory.logicalRoot ||
        child.directory.rootIdentity !== parent.directory.rootIdentity ||
        !insideDirectory(parent.directory.relativeDirectory, child.directory.relativeDirectory)
      )
        throw new MediaContentConflictError('STALE')
    // Every child's ancestor list includes the parent; lock all directories before
    // any declaration row, with a constant number of queries for the whole batch.
    await lockContentDirectories(
      tx,
      childRows.map((row) => directorySnapshot(row.directory))
    )
    const locked = await tx.$queryRaw<MediaContentPathWrite[]>(
      Prisma.sql`SELECT * FROM "MediaContentPathWrite" WHERE id IN (${Prisma.join(allIds)}) ORDER BY id FOR UPDATE`
    )
    const byId = new Map(locked.map((row) => [row.id, row]))
    const lockedParent = byId.get(parent.id)!
    if (!sameHandle(lockedParent, input.parent) || !sameOwner(lockedParent, input.owner))
      throw new MediaContentConflictError('STALE')
    if (lockedParent.scope !== 'DIRECTORY' || lockedParent.status !== 'ACTIVE')
      throw new MediaContentConflictError('WRITING')
    const verified: Array<{ row: MediaContentPathWrite; resolution: MediaContentChildResolution }> = []
    for (const child of input.children) {
      const row = byId.get(child.handle.writeId)!
      if (row.parentWriteId !== parent.id || !sameHandle(row, child.handle) || !sameOwner(row, input.owner))
        throw new MediaContentConflictError('STALE')
      if (child.resolution.kind === 'PUBLISH') {
        if (row.status !== 'READY' || !sameReceipt(receiptOf(row), child.resolution.receipt))
          throw new MediaContentConflictError('INCOMPLETE')
      } else assertContentText(child.resolution.evidenceId, 'rollback evidence ID')
      verified.push({ row, resolution: child.resolution })
    }
    await tx.$executeRaw(
      Prisma.sql`UPDATE "MediaContentPathWrite" w SET "declarationVersion"=w."declarationVersion"+1,"childDisposition"=v.disposition::"MediaContentChildDisposition","resolutionEvidenceId"=v.evidence,"resolvedAt"=${input.now},status=v.status::"MediaContentWriteStatus","finishedAt"=v.finished::timestamp,"updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${Prisma.join(verified.map(({ row, resolution }) => Prisma.sql`(${row.id},${resolution.kind === 'PUBLISH' ? 'PUBLISH' : resolution.disposition},${resolution.kind === 'PUBLISH' ? null : resolution.evidenceId}::text,${resolution.kind === 'PUBLISH' ? row.status : 'ROLLED_BACK'},${resolution.kind === 'PUBLISH' ? row.finishedAt : input.now}::timestamp)`))}) AS v(id,disposition,evidence,status,finished) WHERE w.id=v.id`
    )
    const updated = await tx.mediaContentPathWrite.findMany({ where: { id: { in: ids } } })
    const handles = new Map(updated.map((row) => [row.id, handleOf(row)]))
    return { children: ids.map((id) => handles.get(id)!) }
  })
}

async function lockOwnerPublication(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; handles: MediaContentWriteHandle[] }
) {
  assertContentLimit(input.handles.length, 100)
  const ids = input.handles.map((handle) => handle.writeId)
  if (new Set(ids).size !== ids.length || input.handles.some((handle) => handle.parentWriteId !== null))
    throw new TypeError('Expected unique top-level write declarations')
  const rows = await tx.mediaContentPathWrite.findMany({ where: { id: { in: ids } }, include: { directory: true } })
  if (rows.length !== ids.length) throw new MediaContentConflictError('MISSING')
  await lockContentDirectories(
    tx,
    rows.map((row) => directorySnapshot(row.directory))
  )
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaContentPathWrite" WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`
  )
  const current = await tx.mediaContentPathWrite.findMany({ where: { id: { in: ids } }, include: { directory: true } })
  for (const row of current) {
    const handle = input.handles.find((value) => value.writeId === row.id)!
    if (
      !sameHandle(row, handle) ||
      !sameOwner(row, input.owner) ||
      !ACTIVE_CONTENT_WRITES.includes(row.status as (typeof ACTIVE_CONTENT_WRITES)[number])
    )
      throw new MediaContentConflictError('STALE')
  }
  if (
    await hasAnyOverlap(
      tx,
      current.map((row) => ({ directory: directorySnapshot(row.directory), scope: handleOf(row).scope })),
      ids
    )
  )
    throw new MediaContentConflictError('WRITING')
  return current
}

export async function assertMediaContentOwnerPublication(
  tx: MediaContentTransaction,
  input: { owner: MediaContentOwner; handles: MediaContentWriteHandle[] }
): Promise<void> {
  await lockOwnerPublication(tx, input)
}

export async function withMediaContentOwnerPublication<T>(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    handles: MediaContentWriteHandle[]
    outcome: 'committed' | 'verified-rollback'
    now: Date
  },
  publish: (tx: MediaContentTransaction) => Promise<T>
): Promise<{ result: T; finishedWriteIds: string[] }> {
  const locked = await lockOwnerPublication(tx, input)
  const ids = input.handles.map((h) => h.writeId)
  for (const row of locked) {
    if (
      input.outcome === 'committed' &&
      (row.status === 'RECOVERY_REQUIRED' || (row.declaredFileSize !== null && row.status !== 'READY'))
    )
      throw new MediaContentConflictError('INCOMPLETE')
  }
  const directoryIds = locked.filter((row) => row.scope === 'DIRECTORY').map((row) => row.id)
  if (directoryIds.length) {
    const unresolved = await tx.mediaContentPathWrite.count({
      where: {
        parentWriteId: { in: directoryIds },
        NOT: {
          OR: [
            ...(input.outcome === 'committed'
              ? [{ status: 'READY' as const, childDisposition: 'PUBLISH' as const, resolvedAt: { not: null } }]
              : []),
            {
              status: 'ROLLED_BACK',
              childDisposition: { in: ['RESTORED', 'REMOVED', 'ISOLATED'] },
              resolutionEvidenceId: { not: null },
              resolvedAt: { not: null }
            }
          ]
        }
      }
    })
    if (unresolved) throw new MediaContentConflictError('INCOMPLETE')
  }
  const result = await publish(tx)
  // A failed final CAS throws, so domain DML and gate release share the caller's rollback.
  const updated = await tx.mediaContentPathWrite.updateMany({
    where: {
      ...ownerData(input.owner),
      OR: locked.map((row) => ({
        id: row.id,
        writeToken: row.writeToken,
        declarationVersion: row.declarationVersion,
        status: row.status
      }))
    },
    data: {
      status: input.outcome === 'committed' ? 'COMPLETED' : 'ROLLED_BACK',
      declarationVersion: { increment: 1n },
      finishedAt: input.now
    }
  })
  if (updated.count !== locked.length) throw new MediaContentConflictError('STALE')
  await tx.mediaContentPathWrite.updateMany({
    where: { parentWriteId: { in: ids }, status: 'READY', childDisposition: 'PUBLISH' },
    data: { status: 'COMPLETED', declarationVersion: { increment: 1n }, finishedAt: input.now }
  })
  await advanceDirectoryContent(
    tx,
    [...new Set(locked.map((row) => row.directoryId))],
    locked.filter((row) => row.scope === 'DIRECTORY').map((row) => row.directoryId)
  )
  return { result, finishedWriteIds: ids }
}

async function lockSourceToken(tx: MediaContentTransaction, token: string) {
  assertContentText(token, 'write token')
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media-content-source:${token}`}, 0))::text`
}

/** Only the archive publisher's sealed, drained rename checkpoint permits this
 * handoff. The trusted executor has already verified the final manifest and the
 * absence of staging; this helper never performs or authorizes further file I/O. */
export async function rebindCompletedArchivePublicationMediaWrite(
  tx: MediaContentTransaction,
  input: {
    owner: MediaContentOwner
    previous: { owner: MediaContentOwner; handle: MediaContentWriteHandle; source: MediaContentSourceWriteToken }
    expectedArtworkId: number | null
    proof: {
      kind: 'FINAL_VERIFIED_STAGING_ABSENT'
      archiveImportId: string
      generationToken: string
      manifestSha256: string
      stagingPath: string
      finalDirectory: MediaContentDirectoryKey
    }
    now: Date
  }
): Promise<
  MediaContentResult<{
    owner: MediaContentOwner
    handle: MediaContentWriteHandle
    source: MediaContentSourceWriteToken
  }>
> {
  return rejected(async () => {
    const { owner, previous, proof } = input
    ownerData(owner)
    ownerData(previous.owner)
    assertContentHash(proof.manifestSha256)
    if (input.expectedArtworkId !== null) contentIds([input.expectedArtworkId])
    const execution = owner.execution
    const oldExecution = previous.owner.execution
    const sessionId = `archive-publish:${proof.archiveImportId}`
    const sameExecution =
      execution &&
      oldExecution &&
      execution.jobId === oldExecution.jobId &&
      execution.executionToken === oldExecution.executionToken &&
      execution.executionAttempt === oldExecution.executionAttempt
    if (
      proof.kind !== 'FINAL_VERIFIED_STAGING_ABSENT' ||
      !execution ||
      !oldExecution ||
      owner.ownerUserId !== null ||
      previous.owner.ownerUserId !== null ||
      owner.sessionId !== sessionId ||
      previous.owner.sessionId !== sessionId ||
      owner.sessionVersion !== previous.owner.sessionVersion ||
      execution.jobId !== oldExecution.jobId ||
      (!sameExecution &&
        (oldExecution.executionAttempt >= execution.executionAttempt ||
          oldExecution.executionToken === execution.executionToken)) ||
      previous.handle.scope.kind !== 'DIRECTORY' ||
      previous.handle.parentWriteId !== null ||
      previous.source.writeToken !== previous.handle.writeToken ||
      previous.source.imageIds.length !== 0 ||
      previous.source.artworkIds.length !== (input.expectedArtworkId === null ? 0 : 1) ||
      (input.expectedArtworkId !== null && previous.source.artworkIds[0] !== input.expectedArtworkId)
    )
      throw new MediaContentConflictError('STALE')

    // Use the runtime's resource -> job order and independently verify its fence.
    const leases = await tx.$queryRaw<Array<{ workerId: string }>>(
      Prisma.sql`SELECT "workerId" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' AND "ownerJobId"=${execution.jobId} AND "leaseToken"::text=${execution.executionToken} AND "expiresAt">${input.now} FOR UPDATE`
    )
    if (leases.length !== 1) throw new MediaContentConflictError('STALE')
    await tx.$queryRaw(Prisma.sql`SELECT id FROM system_jobs WHERE id=${execution.jobId} FOR UPDATE`)
    const job = await tx.systemJob.findUnique({ where: { id: execution.jobId } })
    if (
      !job ||
      job.type !== 'ARCHIVE_PUBLISH' ||
      job.executionLane !== 'BACKGROUND_WRITER' ||
      job.status !== 'RUNNING' ||
      job.workerId !== leases[0]!.workerId ||
      job.leaseToken !== execution.executionToken ||
      job.attempt !== execution.executionAttempt ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= input.now ||
      job.cancelRequestedAt ||
      job.pauseRequestedAt
    )
      throw new MediaContentConflictError('STALE')
    await tx.$queryRaw(Prisma.sql`SELECT id FROM archive_imports WHERE id=${proof.archiveImportId} FOR UPDATE`)
    await tx.$queryRaw(
      Prisma.sql`SELECT token FROM archive_staging_generations WHERE token::text=${proof.generationToken} FOR UPDATE`
    )
    const [archiveImport, publication, generation] = await Promise.all([
      tx.archiveImport.findUnique({ where: { id: proof.archiveImportId } }),
      tx.archiveImportExecution.findUnique({ where: { jobId: execution.jobId } }),
      tx.archiveStagingGeneration.findUnique({ where: { token: proof.generationToken } })
    ])
    if (
      !archiveImport ||
      archiveImport.systemJobId !== execution.jobId ||
      archiveImport.phase !== 'PUBLISH' ||
      archiveImport.status !== 'RUNNING' ||
      archiveImport.cleanupRequestedAt ||
      archiveImport.publishedArtworkDeletedAt ||
      archiveImport.publishedArtworkPurgedAt ||
      archiveImport.generationToken !== proof.generationToken ||
      archiveImport.sealedManifestSha256 !== proof.manifestSha256 ||
      archiveImport.stagingPath !== proof.stagingPath ||
      publication?.archiveImportId !== archiveImport.id ||
      publication.phase !== 'PUBLISH' ||
      generation?.archiveImportId !== archiveImport.id ||
      generation.path !== proof.stagingPath ||
      !generation.sealedAt ||
      !generation.drainedAt ||
      generation.cleanedAt ||
      generation.manifestSha256 !== proof.manifestSha256
    )
      throw new MediaContentConflictError('STALE')
    const [download, deletion, sourceRef] = await Promise.all([
      tx.archiveImportExecution.findUnique({ where: { jobId: generation.jobId } }),
      tx.archiveDeletedIdentity.findUnique({
        where: {
          providerKey_externalId: { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId }
        }
      }),
      tx.artworkExternalRef.findUnique({
        where: {
          providerKey_externalId: { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId }
        },
        include: { artwork: true }
      })
    ])
    if (
      download?.archiveImportId !== archiveImport.id ||
      download.phase !== 'DOWNLOAD' ||
      (deletion && (!deletion.purgedAt || archiveImport.createdAt <= deletion.purgedAt)) ||
      (sourceRef?.artworkId ?? null) !== input.expectedArtworkId ||
      (sourceRef && (sourceRef.artwork.deletedAt || sourceRef.artwork.archiveLifecycleState !== 'ACTIVE'))
    )
      throw new MediaContentConflictError('STALE')
    const locked = await lockOwnerPublication(tx, { owner: previous.owner, handles: [previous.handle] })
    const row = locked[0]!
    if (
      row.status !== 'ACTIVE' ||
      row.declaredFileSize !== null ||
      row.totalChunks !== null ||
      row.directory.logicalRoot !== proof.finalDirectory.logicalRoot ||
      row.directory.rootIdentity !== proof.finalDirectory.rootIdentity ||
      row.directory.relativeDirectory !== proof.finalDirectory.relativeDirectory ||
      (await tx.mediaContentPathWrite.count({ where: { parentWriteId: row.id } }))
    )
      throw new MediaContentConflictError('STALE')
    const source = await resumeMediaContentSourceWrite(tx, { token: previous.source })
    if (source.status !== 'READY') throw new MediaContentConflictError('STALE')
    if (sameExecution) return { owner, handle: handleOf(row), source: source.value }
    const changed = await tx.mediaContentPathWrite.updateMany({
      where: {
        id: row.id,
        writeToken: row.writeToken,
        declarationVersion: row.declarationVersion,
        status: 'ACTIVE',
        ...ownerData(previous.owner)
      },
      data: { ...ownerData(owner), declarationVersion: { increment: 1n } }
    })
    if (changed.count !== 1) throw new MediaContentConflictError('STALE')
    return {
      owner,
      handle: { ...handleOf(row), declarationVersion: row.declarationVersion + 1n },
      source: source.value
    }
  })
}

async function lockImageSources(tx: MediaContentTransaction, imageIds: number[]) {
  if (!imageIds.length) return
  await tx.$queryRaw(
    Prisma.sql`SELECT "imageId" FROM "MediaContentSource" WHERE "imageId" IN (${Prisma.join(imageIds)}) ORDER BY "imageId" FOR UPDATE`
  )
}

export async function resumeMediaContentSourceWrite(
  tx: MediaContentTransaction,
  input: { token: MediaContentSourceWriteToken }
): Promise<MediaContentResult<MediaContentSourceWriteToken>> {
  return rejected(async () => {
    const artworkIds = contentIds(input.token.artworkIds)
    const imageIds = contentIds(input.token.imageIds)
    await lockSourceToken(tx, input.token.writeToken)
    const images = await tx.image.findMany({ where: { id: { in: imageIds } }, select: { id: true, artworkId: true } })
    const allArtworkIds = [
      ...new Set([...artworkIds, ...images.flatMap((row) => (row.artworkId === null ? [] : [row.artworkId]))])
    ]
    const artworks = await lockContentArtworks(tx, allArtworkIds)
    if (artworks.length !== allArtworkIds.length || images.length !== imageIds.length)
      throw new MediaContentConflictError('STALE')
    const locked = await lockContentImages(tx, imageIds)
    if (
      locked.length !== images.length ||
      locked.some((row) => row.artworkId !== images.find((image) => image.id === row.id)?.artworkId)
    )
      throw new MediaContentConflictError('STALE')
    await lockImageSources(tx, imageIds)
    const [heldArtworks, heldImages, otherArtworks, otherImages] = await Promise.all([
      tx.artworkContentSource.findMany({
        where: { writeToken: input.token.writeToken },
        select: { artworkId: true },
        orderBy: { artworkId: 'asc' },
        take: 101
      }),
      tx.mediaContentSource.findMany({
        where: { writeToken: input.token.writeToken },
        select: { imageId: true },
        orderBy: { imageId: 'asc' },
        take: 101
      }),
      tx.artworkContentSource.count({
        where: {
          artworkId: { in: allArtworkIds },
          writeToken: { not: null },
          NOT: { writeToken: input.token.writeToken }
        }
      }),
      tx.mediaContentSource.count({
        where: {
          writeToken: { not: null },
          NOT: { writeToken: input.token.writeToken },
          OR: [{ imageId: { in: imageIds } }, { image: { artworkId: { in: artworkIds } } }]
        }
      })
    ])
    if (otherArtworks || otherImages) throw new MediaContentConflictError('STALE')
    if (!heldArtworks.length && !heldImages.length && (artworkIds.length || imageIds.length))
      throw new MediaContentConflictError('MISSING')
    if (
      heldArtworks.length !== artworkIds.length ||
      heldImages.length !== imageIds.length ||
      heldArtworks.some((row, i) => row.artworkId !== artworkIds[i]) ||
      heldImages.some((row, i) => row.imageId !== imageIds[i])
    )
      throw new MediaContentConflictError('STALE')
    return input.token
  })
}

export async function beginMediaContentSourceWrite(
  tx: MediaContentTransaction,
  input: { artworkIds: number[]; imageIds: number[]; writeToken: string; now: Date }
): Promise<MediaContentSourceWriteToken> {
  const artworkIds = contentIds(input.artworkIds)
  const imageIds = contentIds(input.imageIds)
  await lockSourceToken(tx, input.writeToken)
  const existing = await Promise.all([
    tx.artworkContentSource.count({ where: { writeToken: input.writeToken } }),
    tx.mediaContentSource.count({ where: { writeToken: input.writeToken } })
  ])
  if (existing.some((count) => count > 0)) throw new MediaContentConflictError('WRITING')
  const candidates = await tx.image.findMany({ where: { id: { in: imageIds } }, select: { id: true, artworkId: true } })
  if (candidates.length !== imageIds.length) throw new MediaContentConflictError('MISSING')
  const allArtworkIds = [
    ...new Set([...artworkIds, ...candidates.flatMap((row) => (row.artworkId === null ? [] : [row.artworkId]))])
  ]
  const artworks = await lockContentArtworks(tx, allArtworkIds)
  if (artworks.length !== allArtworkIds.length) throw new MediaContentConflictError('MISSING')
  const images = await lockContentImages(tx, imageIds)
  if (
    images.length !== imageIds.length ||
    images.some((row) => row.artworkId !== candidates.find((c) => c.id === row.id)?.artworkId)
  )
    throw new MediaContentConflictError('STALE')
  // Orphan Images have no Artwork row to serialize writers. Their source row
  // must be established and locked before checking/claiming the token.
  await tx.mediaContentSource.createMany({ data: imageIds.map((imageId) => ({ imageId })), skipDuplicates: true })
  await lockImageSources(tx, imageIds)
  const writingArtworks = await tx.artworkContentSource.count({
    where: { artworkId: { in: allArtworkIds }, writeToken: { not: null } }
  })
  const writingImages = await tx.mediaContentSource.count({
    where: {
      writeToken: { not: null },
      OR: [{ imageId: { in: imageIds } }, { image: { artworkId: { in: artworkIds } } }]
    }
  })
  if (writingArtworks || writingImages) throw new MediaContentConflictError('WRITING')
  await advanceArtworkContent(tx, allArtworkIds)
  await tx.artworkContentSource.updateMany({
    where: { artworkId: { in: artworkIds } },
    data: { mediaEpoch: { increment: 1n }, writeToken: input.writeToken, writeStartedAt: input.now }
  })
  await tx.mediaContentSource.updateMany({
    where: { imageId: { in: imageIds } },
    data: { revision: { increment: 1n }, writeToken: input.writeToken, writeStartedAt: input.now }
  })
  await tx.mediaContentFingerprint.deleteMany({ where: { imageId: { in: imageIds } } })
  return { writeToken: input.writeToken, artworkIds, imageIds }
}
export async function finishMediaContentSourceWrite(
  tx: MediaContentTransaction,
  input: { token: MediaContentSourceWriteToken; outcome: 'committed' | 'verified-rollback' }
): Promise<boolean> {
  const { token } = input
  contentIds(token.artworkIds)
  contentIds(token.imageIds)
  assertContentText(token.writeToken, 'write token')
  const images = await tx.image.findMany({ where: { id: { in: token.imageIds } }, select: { artworkId: true } })
  await lockContentArtworks(tx, [
    ...token.artworkIds,
    ...images.flatMap((row) => (row.artworkId === null ? [] : [row.artworkId]))
  ])
  await lockContentImages(tx, token.imageIds)
  await lockImageSources(tx, token.imageIds)
  const [artworks, sources] = await Promise.all([
    tx.artworkContentSource.findMany({ where: { artworkId: { in: token.artworkIds } } }),
    tx.mediaContentSource.findMany({ where: { imageId: { in: token.imageIds } } })
  ])
  if (
    artworks.some((row) => row.writeToken !== token.writeToken) ||
    sources.some((row) => row.writeToken !== token.writeToken)
  )
    return false
  await tx.artworkContentSource.updateMany({
    where: { artworkId: { in: token.artworkIds }, writeToken: token.writeToken },
    data: { writeToken: null, writeStartedAt: null }
  })
  await tx.mediaContentSource.updateMany({
    where: { imageId: { in: token.imageIds }, writeToken: token.writeToken },
    data: { writeToken: null, writeStartedAt: null }
  })
  return true
}
