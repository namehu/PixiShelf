import { Prisma, type PrismaClient } from '@prisma/client'

export const ANIMATION_DURATION_TIMING_POLICY_VERSION = 1

type AnimationDatabase = Pick<PrismaClient, 'image' | 'imageAnimationMetadata'>
type AnimationTransaction = Prisma.TransactionClient

export interface AnimationDurationFileState {
  size: bigint
  mtimeMs: bigint
  ctimeMs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

export type AnimationDurationProbeResult =
  | { status: 'READY'; format: 'WEBP'; durationMs: bigint; frameCount: number; loopCount: number }
  | { status: 'NOT_APPLICABLE'; format: 'WEBP' }
  | { status: 'FAILED'; format?: 'WEBP'; failureCode: string; transient: boolean }

const webpImageWhere = { path: { endsWith: '.webp', mode: 'insensitive' as const } }

function dueCandidateWhere(now: Date): Prisma.ImageWhereInput {
  return {
    ...webpImageWhere,
    OR: [
      { animationMetadata: { is: null } },
      {
        animationMetadata: {
          is: {
            writeInProgress: false,
            OR: [
              { status: 'PENDING' },
              { status: 'FAILED', nextRetryAt: { lte: now } },
              { status: { in: ['READY', 'NOT_APPLICABLE'] }, timingPolicyVersion: null },
              {
                status: { in: ['READY', 'NOT_APPLICABLE'] },
                timingPolicyVersion: { not: ANIMATION_DURATION_TIMING_POLICY_VERSION }
              }
            ]
          }
        }
      }
    ]
  }
}

/** Pages database identities only. A successful rescan does not stat NFS media. */
export async function listAnimationDurationCandidates(
  client: AnimationDatabase,
  input: { afterImageId: number; limit: number; now: Date }
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError('Animation duration candidate page size must be between 1 and 100')
  }
  return client.image.findMany({
    where: { ...dueCandidateWhere(input.now), id: { gt: input.afterImageId } },
    orderBy: { id: 'asc' },
    take: input.limit,
    select: {
      id: true,
      path: true,
      size: true,
      mediaType: true,
      webpAnimationStatus: true,
      animationMetadata: true
    }
  })
}

export type AnimationDurationCandidate = Awaited<ReturnType<typeof listAnimationDurationCandidates>>[number]

/** Retry queue is independent of the forward ID cursor so low-ID failures cannot starve. */
export async function listDueAnimationDurationRetries(
  client: AnimationDatabase,
  input: { limit: number; now: Date }
): Promise<AnimationDurationCandidate[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError('Animation duration retry page size must be between 1 and 100')
  }
  return client.image.findMany({
    where: {
      ...webpImageWhere,
      animationMetadata: {
        is: { status: 'FAILED', writeInProgress: false, nextRetryAt: { lte: input.now } }
      }
    },
    orderBy: [{ animationMetadata: { nextRetryAt: 'asc' } }, { id: 'asc' }],
    take: input.limit,
    select: {
      id: true,
      path: true,
      size: true,
      mediaType: true,
      webpAnimationStatus: true,
      animationMetadata: true
    }
  })
}

export async function getAnimationDurationInventory(client: AnimationDatabase, input: { now: Date }) {
  const [dueCount, retryPendingCount, nextRetry, failedPermanentCount, failedCount, totalCount, writePendingCount] = await Promise.all([
    client.image.count({ where: dueCandidateWhere(input.now) }),
    client.image.count({
      where: {
        ...webpImageWhere,
        animationMetadata: { is: { status: 'FAILED', writeInProgress: false, nextRetryAt: { gt: input.now } } }
      }
    }),
    client.imageAnimationMetadata.findFirst({
      where: {
        image: { is: webpImageWhere },
        status: 'FAILED',
        writeInProgress: false,
        nextRetryAt: { gt: input.now }
      },
      orderBy: { nextRetryAt: 'asc' },
      select: { nextRetryAt: true }
    }),
    client.image.count({
      where: {
        ...webpImageWhere,
        animationMetadata: { is: { status: 'FAILED', writeInProgress: false, nextRetryAt: null } }
      }
    }),
    client.image.count({
      where: { ...webpImageWhere, animationMetadata: { is: { status: 'FAILED' } } }
    }),
    client.image.count({ where: webpImageWhere }),
    client.image.count({
      where: { ...webpImageWhere, animationMetadata: { is: { writeInProgress: true } } }
    })
  ])
  return {
    dueCount,
    retryPendingCount,
    nextRetryAt: nextRetry?.nextRetryAt ?? null,
    failedPermanentCount,
    failedCount,
    totalCount,
    writePendingCount
  }
}

function resetSourceData(sourcePath?: string): Prisma.ImageAnimationMetadataUpdateInput {
  return {
    sourcePath: sourcePath ?? null,
    format: null,
    durationMs: null,
    frameCount: null,
    loopCount: null,
    status: 'PENDING',
    timingPolicyVersion: null,
    probedAt: null,
    sourceSize: null,
    sourceMtimeMs: null,
    sourceCtimeMs: null,
    sourceDeviceId: null,
    sourceInode: null,
    failureCode: null,
    attemptCount: 0,
    nextRetryAt: null,
    sourceRevision: { increment: 1 }
  }
}

/** Call in the same transaction as a known Image path/content mutation. */
export async function invalidateAnimationDurationSource(
  tx: AnimationTransaction,
  input: { imageId: number; sourcePath?: string; writeInProgress?: boolean }
) {
  // Serialize scan/migration invalidation with a file writer before checking its gate.
  // A scan may have read an old file stat before an upload opened the gate.
  const imageRows = await tx.$queryRaw<Array<{ path: string }>>(
    Prisma.sql`SELECT path FROM "Image" WHERE id = ${input.imageId} FOR UPDATE`
  )
  const image = imageRows[0]
  if (!image) return false
  const previous = await tx.imageAnimationMetadata.findUnique({
    where: { imageId: input.imageId },
    select: { sourceRevision: true, writeInProgress: true }
  })
  if (previous?.writeInProgress && input.writeInProgress !== true) return previous.sourceRevision
  const sourcePath = input.sourcePath ?? image.path
  await tx.imageAnimationMetadata.upsert({
    where: { imageId: input.imageId },
    create: {
      imageId: input.imageId,
      sourcePath,
      sourceRevision: 1,
      writeInProgress: input.writeInProgress ?? false
    },
    update: {
      ...resetSourceData(sourcePath),
      ...(input.writeInProgress === undefined ? {} : { writeInProgress: input.writeInProgress })
    }
  })
  const current = await tx.imageAnimationMetadata.findUnique({
    where: { imageId: input.imageId },
    select: { sourceRevision: true }
  })
  return current!.sourceRevision
}

/** A file writer calls this before its first byte or rename, including replace-session backup. */
export async function beginAnimationDurationSourceWrite(
  tx: AnimationTransaction,
  input: { imageId: number; sourcePath?: string }
) {
  return invalidateAnimationDurationSource(tx, { ...input, writeInProgress: true })
}

/** Only call after the final byte is durable or the original file has been restored. */
export async function finishAnimationDurationSourceWrite(
  tx: AnimationTransaction,
  input: { imageId: number; expectedRevision: number }
) {
  const updated = await tx.imageAnimationMetadata.updateMany({
    where: { imageId: input.imageId, sourceRevision: input.expectedRevision, writeInProgress: true },
    data: { writeInProgress: false }
  })
  return updated.count === 1
}

/** Admin retry resets the retry budget and fences any late result from an older attempt. */
export async function retryAnimationDurationFailures(
  tx: AnimationTransaction,
  input: { imageIds?: number[] } = {}
) {
  const updated = await tx.imageAnimationMetadata.updateMany({
    where: {
      status: 'FAILED',
      writeInProgress: false,
      image: { is: webpImageWhere },
      ...(input.imageIds ? { imageId: { in: input.imageIds } } : {})
    },
    data: {
      status: 'PENDING',
      attemptCount: 0,
      nextRetryAt: null,
      failureCode: null,
      sourceRevision: { increment: 1 }
    }
  })
  return updated.count
}

function sameFileState(left: AnimationDurationFileState, right: AnimationDurationFileState) {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId &&
    left.inode === right.inode
  )
}

function failureRetryAt(result: Extract<AnimationDurationProbeResult, { status: 'FAILED' }>, attempt: number, now: Date) {
  if (!result.transient || attempt >= 3) return null
  return new Date(now.getTime() + (attempt === 1 ? 60_000 : 600_000))
}

/** Must run inside the job's fenced mutateInTransaction transaction. */
export async function publishAnimationDurationProbe(
  tx: AnimationTransaction,
  input: {
    imageId: number
    expectedPath: string
    expectedRevision: number
    preState?: AnimationDurationFileState
    postState?: AnimationDurationFileState
    result: AnimationDurationProbeResult
    now: Date
  }
) {
  if (Boolean(input.preState) !== Boolean(input.postState)) return false
  if (input.preState && input.postState && !sameFileState(input.preState, input.postState)) return false
  if (
    input.result.status === 'READY' &&
    (input.result.durationMs < 0n ||
      input.result.durationMs > BigInt(Number.MAX_SAFE_INTEGER) ||
      !Number.isSafeInteger(input.result.frameCount) ||
      input.result.frameCount < 1 ||
      !Number.isSafeInteger(input.result.loopCount) ||
      input.result.loopCount < 0 ||
      !input.preState)
  ) {
    return false
  }
  if (input.result.status === 'NOT_APPLICABLE' && !input.preState) return false

  // A row lock serializes publication with Image.path updates in scan/migration transactions.
  const imageRows = await tx.$queryRaw<Array<{ id: number; path: string }>>(
    Prisma.sql`SELECT id, path FROM "Image" WHERE id = ${input.imageId} FOR UPDATE`
  )
  if (imageRows[0]?.path !== input.expectedPath) return false
  const previous = await tx.imageAnimationMetadata.findUnique({ where: { imageId: input.imageId } })
  if ((previous?.sourceRevision ?? 0) !== input.expectedRevision || previous?.writeInProgress) return false

  const attempt = (previous?.attemptCount ?? 0) + 1
  const retryAt = input.result.status === 'FAILED' ? failureRetryAt(input.result, attempt, input.now) : null
  const state = input.postState ?? null
  const data = {
    format: input.result.status === 'FAILED' ? (input.result.format ?? null) : input.result.format,
    durationMs: input.result.status === 'READY' ? input.result.durationMs : null,
    frameCount: input.result.status === 'READY' ? input.result.frameCount : null,
    loopCount: input.result.status === 'READY' ? input.result.loopCount : null,
    status: input.result.status,
    timingPolicyVersion: ANIMATION_DURATION_TIMING_POLICY_VERSION,
    probedAt: input.now,
    sourcePath: input.expectedPath,
    sourceSize: state?.size ?? null,
    sourceMtimeMs: state?.mtimeMs ?? null,
    sourceCtimeMs: state?.ctimeMs ?? null,
    sourceDeviceId: state?.deviceId ?? null,
    sourceInode: state?.inode ?? null,
    failureCode: input.result.status === 'FAILED' ? input.result.failureCode : null,
    attemptCount: attempt,
    nextRetryAt: retryAt
  } satisfies Prisma.ImageAnimationMetadataUncheckedUpdateInput

  if (previous) {
    const updated = await tx.imageAnimationMetadata.updateMany({
      where: { imageId: input.imageId, sourceRevision: input.expectedRevision, writeInProgress: false },
      data
    })
    return updated.count === 1
  }
  const created = await tx.imageAnimationMetadata.createMany({
    data: [{ imageId: input.imageId, ...data }],
    skipDuplicates: true
  })
  return created.count === 1
}
