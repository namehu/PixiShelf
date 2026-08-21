import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Prisma } from '@pixishelf/db'
import type { ScanPayload, ScanV2Payload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { mapBounded, throwIfAborted } from './bounded.ts'
import { hashStableFile, type StableFileState } from './content-reader.ts'
import { createMetadataDigestAccumulator } from './digests.ts'
import { discoverMetadataStatCandidatePages, type StattedMetadataCandidate } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import {
  classifyInventoryFailure,
  decideInventoryBeforeHash,
  hashScanRootIdentity,
  inventoryStatData,
  isKnownPermanentContent,
  shouldProcessHashedInventory,
  type PixivInventoryRecord
} from './inventory.ts'
import { logFrozenSnapshotPage } from './progress.ts'
import type { ScanRunRecord } from './run-store.ts'
import type { ScanDatabase, ScanExecutorLimits, ScanTransaction } from './types.ts'
import type { SafeScanRoot } from './paths.ts'

export type InventoryDecision = 'BASELINE_EXISTING' | 'PENDING_SOURCE_REFRESH'

interface FrozenInventoryCandidate {
  relativePath: string
  externalId: string
  contentHash: string
  state: StableFileState
}

interface ObservedInventoryCandidate extends FrozenInventoryCandidate {
  inventory: PixivInventoryRecord | undefined
  shouldProcess: boolean
}

interface DiscoveryFailure {
  candidate: StattedMetadataCandidate
  inventory: PixivInventoryRecord | undefined
  code: string
  summary: string
  retryable: boolean
  contentDeterministic: boolean
  contentHash?: string | null
}

export async function ensurePixivInventoryRootIdentity(input: {
  context: ExecutionContext<ScanPayload | ScanV2Payload, EnqueuedChildJob>
  rootPathHash: string
  rootDeviceId: bigint
  rootInode: bigint
  now: Date
}) {
  return mutate(input.context, async (transaction) => {
    const state = await transaction.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
    if (
      state &&
      (state.rootPathHash !== input.rootPathHash ||
        (state.rootDeviceId !== null && state.rootDeviceId !== input.rootDeviceId) ||
        (state.rootInode !== null && state.rootInode !== input.rootInode))
    ) {
      throw new ScanExecutorError(
        'STATE_CONFLICT',
        'The configured Pixiv scan root does not match the existing metadata inventory'
      )
    }
    if (!state) {
      return transaction.pixivMetadataInventoryState.create({
        data: {
          id: 'pixiv',
          rootPathHash: input.rootPathHash,
          rootDeviceId: input.rootDeviceId,
          rootInode: input.rootInode,
          status: 'INITIALIZING',
          baselineStartedAt: input.now
        }
      })
    }
    if (state.rootDeviceId === null || state.rootInode === null) {
      return transaction.pixivMetadataInventoryState.update({
        where: { id: state.id },
        data: { rootDeviceId: input.rootDeviceId, rootInode: input.rootInode }
      })
    }
    return state
  })
}

export async function freezeIncrementalInventorySnapshot(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  database: ScanDatabase
  root: SafeScanRoot
  run: ScanRunRecord
  now: Date
  limits: ScanExecutorLimits
}): Promise<ScanRunRecord> {
  if (input.run.inputFrozenAt) return input.run

  const rootPathHash = hashScanRootIdentity(input.root.absolutePath)
  // The first complete traversal owns INITIALIZING. A different resolved root must never inherit that baseline.
  const inventoryState = await mutate(input.context, async (transaction) => {
    const existing = await transaction.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
    if (
      existing &&
      (existing.rootPathHash !== rootPathHash ||
        (existing.rootDeviceId !== null && existing.rootDeviceId !== input.root.deviceId) ||
        (existing.rootInode !== null && existing.rootInode !== input.root.inode))
    ) {
      throw new ScanExecutorError(
        'STATE_CONFLICT',
        'The configured Pixiv scan root does not match the existing metadata inventory'
      )
    }
    if (!existing) {
      return transaction.pixivMetadataInventoryState.create({
        data: {
          id: 'pixiv',
          rootPathHash,
          rootDeviceId: input.root.deviceId,
          rootInode: input.root.inode,
          status: 'INITIALIZING',
          baselineStartedAt: input.now
        }
      })
    }
    if (existing.rootDeviceId === null || existing.rootInode === null) {
      return transaction.pixivMetadataInventoryState.update({
        where: { id: existing.id },
        data: { rootDeviceId: input.root.deviceId, rootInode: input.root.inode }
      })
    }
    return existing
  })
  const baselineGeneration = inventoryState.status === 'INITIALIZING' ? inventoryState.baselineGeneration : null

  const prepared = await mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return { shouldFreeze: false, run: current }
    // An unfrozen snapshot is intentionally rebuildable. Page commits may survive a crash, so
    // retry replaces their run-local rows while retaining reusable observations in the inventory.
    await transaction.scanRunMetadataInput.deleteMany({ where: { scanRunId: input.run.id } })
    await transaction.scanRunItem.deleteMany({
      where: { scanRunId: input.run.id, checkpointKey: { startsWith: 'inventory-discovery:' } }
    })
    const run = await transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        inputCount: 0,
        inputDigest: null,
        checkpointStage: 'DISCOVERY',
        checkpointOrdinal: 0,
        inventoryBaselineGeneration: baselineGeneration,
        walkedEntries: 0,
        metadataCandidates: 0,
        inventoryUnchanged: 0,
        contentHashed: 0,
        contentChanged: 0,
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0,
        missingInputs: 0,
        discoveryDurationMs: 0,
        hashDurationMs: 0,
        publishDurationMs: 0
      }
    })
    return { shouldFreeze: true, run }
  })
  if (!prepared.shouldFreeze) return prepared.run

  const discoveryStarted = performance.now()
  let hashDurationMs = 0
  let walkedEntries = 0
  let metadataCandidates = 0
  let inventoryUnchanged = 0
  let contentHashed = 0
  let contentChanged = 0
  let failedInputs = 0
  let retryableDiscoveryFailures = 0
  let ordinal = 0
  const digest = createMetadataDigestAccumulator()

  for await (const page of discoverMetadataStatCandidatePages(input.root, input.limits, input.context.signal, () => {
    walkedEntries += 1
  })) {
    throwIfAborted(input.context.signal)
    metadataCandidates += page.length
    const existing = await input.database.pixivMetadataInventory.findMany({
      where: { relativePath: { in: page.map((candidate) => candidate.relativePath) } }
    })
    const inventoryByPath = new Map(existing.map((row) => [row.relativePath, row]))
    const observed: ObservedInventoryCandidate[] = []
    const failures: DiscoveryFailure[] = []
    const toHash: Array<{ candidate: StattedMetadataCandidate; inventory: PixivInventoryRecord | undefined }> = []

    for (const candidate of page) {
      const inventory = inventoryByPath.get(candidate.relativePath)
      const decision = decideInventoryBeforeHash(
        inventory,
        candidate.state,
        baselineGeneration !== null || inventory?.baselineEligible === true
      )
      if (decision.kind === 'UNCHANGED') {
        inventoryUnchanged += 1
      } else if (decision.kind === 'KNOWN_FAILURE') {
        failures.push({
          candidate,
          inventory,
          code: decision.code,
          summary: decision.summary,
          retryable: false,
          contentDeterministic: true,
          contentHash: decision.contentHash
        })
        failedInputs += 1
      } else if (decision.kind === 'PROCESS_STORED_HASH') {
        observed.push({
          relativePath: candidate.relativePath,
          externalId: candidate.artworkId,
          contentHash: decision.contentHash,
          state: candidate.state,
          inventory,
          shouldProcess: true
        })
        contentChanged += 1
      } else {
        toHash.push({ candidate, inventory })
      }
    }

    const hashStarted = performance.now()
    const hashed = await mapBounded(toHash, input.limits.concurrency, input.context.signal, async (item) => {
      try {
        const result = await hashStableFile({
          absolutePath: item.candidate.absolutePath,
          maxBytes: input.limits.maxMetadataBytes,
          signal: input.context.signal
        })
        return { item, result } as const
      } catch (error) {
        throwIfAborted(input.context.signal)
        return { item, error } as const
      }
    })
    hashDurationMs += Math.max(0, performance.now() - hashStarted)

    for (const result of hashed) {
      contentHashed += 1
      if ('error' in result) {
        const classified = classifyInventoryFailure(result.error)
        failures.push({
          candidate: result.item.candidate,
          inventory: result.item.inventory,
          ...classified
        })
        failedInputs += 1
        if (classified.retryable) retryableDiscoveryFailures += 1
        continue
      }
      if (isKnownPermanentContent(result.item.inventory, result.result.sha256)) {
        failures.push({
          candidate: { ...result.item.candidate, state: result.result.state },
          inventory: result.item.inventory,
          code: result.item.inventory!.lastErrorCode!,
          summary: result.item.inventory!.lastErrorSummary!,
          retryable: false,
          contentDeterministic: true,
          contentHash: result.result.sha256
        })
        failedInputs += 1
        continue
      }
      const shouldProcess = shouldProcessHashedInventory(result.item.inventory, result.result.sha256)
      observed.push({
        relativePath: result.item.candidate.relativePath,
        externalId: result.item.candidate.artworkId,
        contentHash: result.result.sha256,
        state: result.result.state,
        inventory: result.item.inventory,
        shouldProcess
      })
      if (shouldProcess) contentChanged += 1
      else inventoryUnchanged += 1
    }

    const frozenRows = observed
      .filter((candidate) => candidate.shouldProcess)
      .map((candidate) => ({
        scanRunId: input.run.id,
        ordinal: ordinal++,
        relativePath: candidate.relativePath,
        contentHash: candidate.contentHash,
        ...inventoryStatData(candidate.state)
      }))
    if (ordinal > input.limits.maxEntries) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen snapshot exceeds the configured row limit')
    }
    for (const row of frozenRows) digest.update(row)

    await mutate(input.context, async (transaction) => {
      // One transaction makes each discovery page replay-safe: its observed state, failures,
      // frozen inputs, and aggregate counters either advance together or not at all.
      for (const candidate of observed) {
        // Discovery advances only observed state. processedContentHash is reserved for the fenced domain commit.
        const stat = inventoryStatData(candidate.state)
        const clearsResolvedError = candidate.inventory?.processedContentHash === candidate.contentHash
        const baselineEligible =
          baselineGeneration !== null
            ? candidate.shouldProcess
            : candidate.inventory?.baselineEligible === true &&
              candidate.inventory.observedContentHash === candidate.contentHash
        await transaction.pixivMetadataInventory.upsert({
          where: { relativePath: candidate.relativePath },
          create: {
            relativePath: candidate.relativePath,
            externalId: candidate.externalId,
            ...stat,
            observedContentHash: candidate.contentHash,
            baselineGeneration: inventoryState.baselineGeneration,
            baselineEligible,
            lastSeenScanRunId: input.run.id
          },
          update: {
            externalId: candidate.externalId,
            ...stat,
            observedContentHash: candidate.contentHash,
            ...(baselineGeneration !== null ? { baselineGeneration: inventoryState.baselineGeneration } : {}),
            baselineEligible,
            lastSeenScanRunId: input.run.id,
            ...(clearsResolvedError ? { lastErrorCode: null, lastErrorSummary: null, lastErrorRetryable: null } : {})
          }
        })
      }
      for (const failure of failures) {
        if (!failure.inventory) {
          await transaction.pixivMetadataInventory.create({
            data: {
              relativePath: failure.candidate.relativePath,
              externalId: failure.candidate.artworkId,
              ...inventoryStatData(failure.candidate.state),
              observedContentHash: failure.contentHash ?? null,
              lastAttemptedContentHash: failure.contentHash ?? null,
              baselineGeneration: inventoryState.baselineGeneration,
              baselineEligible: false,
              lastSeenScanRunId: input.run.id,
              lastAttemptedAt: input.now,
              lastErrorCode: failure.code,
              lastErrorSummary: failure.summary,
              lastErrorRetryable: failure.retryable ? true : failure.contentDeterministic ? false : null
            }
          })
        } else {
          await transaction.pixivMetadataInventory.update({
            where: { id: failure.inventory.id },
            data: {
              ...(failure.contentHash
                ? {
                    ...inventoryStatData(failure.candidate.state),
                    observedContentHash: failure.contentHash,
                    lastAttemptedContentHash: failure.contentHash
                  }
                : {}),
              ...(baselineGeneration !== null ? { baselineGeneration: inventoryState.baselineGeneration } : {}),
              lastSeenScanRunId: input.run.id,
              baselineEligible: false,
              lastAttemptedAt: input.now,
              lastErrorCode: failure.code,
              lastErrorSummary: failure.summary,
              lastErrorRetryable: failure.retryable ? true : failure.contentDeterministic ? false : null
            }
          })
        }
        await transaction.scanRunItem.upsert({
          where: {
            scanRunId_checkpointKey: {
              scanRunId: input.run.id,
              checkpointKey: discoveryFailureCheckpoint(failure.candidate.relativePath)
            }
          },
          create: {
            scanRunId: input.run.id,
            checkpointKey: discoveryFailureCheckpoint(failure.candidate.relativePath),
            externalId: failure.candidate.artworkId,
            metadataRelativePath: failure.candidate.relativePath,
            status: 'FAILED',
            action: 'FAILED_PARSE',
            attempt: 1,
            errorMessage: failure.summary,
            finishedAt: input.now
          },
          update: {
            status: 'FAILED',
            action: 'FAILED_PARSE',
            attempt: { increment: 1 },
            errorMessage: failure.summary,
            finishedAt: input.now
          }
        })
      }
      if (frozenRows.length > 0) {
        await transaction.scanRunMetadataInput.createMany({ data: frozenRows })
      }
      await transaction.scanRun.update({
        where: { id: input.run.id },
        data: {
          inputCount: ordinal,
          walkedEntries,
          metadataCandidates,
          inventoryUnchanged,
          contentHashed,
          contentChanged,
          failedInputs,
          hashDurationMs: boundedMilliseconds(hashDurationMs)
        }
      })
    })
    logFrozenSnapshotPage({ logger: input.context.logger, frozen: ordinal, pageItems: frozenRows.length })
  }

  const discoveryDurationMs = boundedMilliseconds(performance.now() - discoveryStarted)
  if (retryableDiscoveryFailures > 0) {
    await mutate(input.context, (transaction) =>
      transaction.scanRun.update({
        where: { id: input.run.id },
        data: { discoveryDurationMs, hashDurationMs: boundedMilliseconds(hashDurationMs) }
      })
    )
    throw new ScanExecutorError(
      'SOURCE_NOT_READABLE',
      `${retryableDiscoveryFailures} metadata inputs could not be inspected or read`,
      true
    )
  }
  return mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return current
    if (baselineGeneration !== null) {
      // READY is the global trust barrier: no row from a partial first traversal can establish
      // an existing Artwork baseline, even though page-level inventory writes are already durable.
      await transaction.pixivMetadataInventoryState.update({
        where: { id: inventoryState.id },
        data: { status: 'READY', baselineCompletedAt: input.now }
      })
    }
    return transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        inputCount: ordinal,
        inputDigest: digest.digest(),
        inputFrozenAt: input.now,
        totalArtworks: metadataCandidates,
        checkpointStage: 'PROCESSING',
        walkedEntries,
        metadataCandidates,
        inventoryUnchanged,
        contentHashed,
        contentChanged,
        failedInputs,
        discoveryDurationMs,
        hashDurationMs: boundedMilliseconds(hashDurationMs)
      }
    })
  })
}

function discoveryFailureCheckpoint(relativePath: string): string {
  return `inventory-discovery:${createHash('sha256').update(relativePath).digest('hex')}`
}

function boundedMilliseconds(value: number): number {
  return Math.min(2_147_483_647, Math.max(0, Math.round(value)))
}

function mutate<TResult>(
  context: ExecutionContext<ScanPayload | ScanV2Payload, EnqueuedChildJob>,
  operation: (transaction: ScanTransaction) => Promise<TResult>
) {
  return context.mutateInTransaction<ScanTransaction & QueueSqlExecutor, TResult>((transaction) =>
    operation(transaction)
  )
}

export async function recordExistingInventoryDecision(input: {
  transaction: ScanTransaction
  runId: string
  checkpointOrdinal: number
  checkpointKey: string
  relativePath: string
  contentHash: string
  state: StableFileState
  externalId: string
  title: string
  artistName: string
  inventoryBaselineGeneration: number | null
  inventoryRootPathHash: string
  now: Date
}) {
  const previousCheckpoint = await input.transaction.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    select: { status: true, action: true }
  })
  // Besides recording the full-reconcile sighting, this update locks the source reference before
  // the exact Artwork/metaSource check below, keeping baseline classification inside one CAS boundary.
  const locked = await input.transaction.artworkExternalRef.updateMany({
    where: { providerKey: 'pixiv', externalId: input.externalId },
    data: { lastSeenScanRunId: input.runId }
  })
  if (locked.count === 0) return null
  const sourceRef = await input.transaction.artworkExternalRef.findUniqueOrThrow({
    where: { providerKey_externalId: { providerKey: 'pixiv', externalId: input.externalId } },
    select: { id: true, artworkId: true }
  })
  const existingInventory = await input.transaction.pixivMetadataInventory.findUnique({
    where: { relativePath: input.relativePath },
    select: { processedContentHash: true, baselineEligible: true, baselineGeneration: true }
  })
  const candidateGeneration =
    input.inventoryBaselineGeneration ??
    (existingInventory?.baselineEligible === true ? existingInventory.baselineGeneration : null)
  const baselineState =
    candidateGeneration === null
      ? null
      : await input.transaction.pixivMetadataInventoryState.findUnique({
          where: { id: 'pixiv' },
          select: { status: true, baselineGeneration: true, rootPathHash: true }
        })
  const baselineCandidate =
    baselineState?.status === 'READY' &&
    baselineState.baselineGeneration === candidateGeneration &&
    baselineState.rootPathHash === input.inventoryRootPathHash
  const exactBaselineArtwork = !baselineCandidate
    ? []
    : await input.transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT "id"
          FROM "Artwork"
          WHERE "id" = ${sourceRef.artworkId}
            AND "metaSource" = ${input.relativePath}
          FOR UPDATE
        `)
  const decision: InventoryDecision | null =
    exactBaselineArtwork.length === 1
      ? 'BASELINE_EXISTING'
      : existingInventory?.processedContentHash === input.contentHash
        ? null
        : 'PENDING_SOURCE_REFRESH'
  // A row-level eligibility marker becomes trustworthy only after the matching full traversal reaches READY.
  // This prevents an interleaved CLIENT_LIST request from consuming a partially discovered baseline.
  const processed = decision === 'BASELINE_EXISTING'
  await input.transaction.pixivMetadataInventory.upsert({
    where: { relativePath: input.relativePath },
    create: {
      relativePath: input.relativePath,
      externalId: input.externalId,
      ...inventoryStatData(input.state),
      observedContentHash: input.contentHash,
      ...(processed ? { processedContentHash: input.contentHash, lastProcessedAt: input.now } : {}),
      lastAttemptedContentHash: input.contentHash,
      baselineEligible: false,
      externalRefId: sourceRef.id,
      lastSeenScanRunId: input.runId,
      lastAttemptedAt: input.now
    },
    update: {
      externalId: input.externalId,
      ...inventoryStatData(input.state),
      observedContentHash: input.contentHash,
      ...(processed ? { processedContentHash: input.contentHash, lastProcessedAt: input.now } : {}),
      lastAttemptedContentHash: input.contentHash,
      baselineEligible: false,
      externalRefId: sourceRef.id,
      lastSeenScanRunId: input.runId,
      lastAttemptedAt: input.now,
      lastErrorCode: null,
      lastErrorSummary: null,
      lastErrorRetryable: null
    }
  })
  await input.transaction.scanRunItem.upsert({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    create: {
      scanRunId: input.runId,
      checkpointKey: input.checkpointKey,
      externalId: input.externalId,
      title: input.title,
      artistName: input.artistName,
      metadataRelativePath: input.relativePath,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      inventoryDecision: decision,
      attempt: 1,
      finishedAt: input.now
    },
    update: {
      externalId: input.externalId,
      title: input.title,
      artistName: input.artistName,
      metadataRelativePath: input.relativePath,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      inventoryDecision: decision,
      attempt: { increment: 1 },
      errorMessage: null,
      finishedAt: input.now
    }
  })
  await advanceRunCheckpoint(input.transaction, input.runId, input.checkpointOrdinal)
  await applyRunInputMetricTransition(input.transaction, input.runId, previousCheckpoint, {
    status: 'SKIPPED',
    action: 'SKIP_EXISTING'
  })
  return { status: 'SKIPPED' as const, newImages: 0, artworkId: sourceRef.artworkId }
}

export async function recordPublishedInventory(input: {
  transaction: ScanTransaction
  runId: string
  checkpointOrdinal: number
  checkpointKey: string
  relativePath: string
  contentHash: string
  state: StableFileState
  externalId: string
  publishStatus: 'SUCCESS' | 'SKIPPED'
  publishDurationMs: number
  previousCheckpoint: MetricCheckpoint | null
  now: Date
}) {
  const externalRef = await input.transaction.artworkExternalRef.findUnique({
    where: { providerKey_externalId: { providerKey: 'pixiv', externalId: input.externalId } },
    select: { id: true }
  })
  const published = input.publishStatus === 'SUCCESS' && externalRef !== null
  // This runs in the same fenced transaction as publishPixivArtwork, so a domain write can never outrun its checkpoint.
  await input.transaction.pixivMetadataInventory.upsert({
    where: { relativePath: input.relativePath },
    create: {
      relativePath: input.relativePath,
      externalId: input.externalId,
      ...inventoryStatData(input.state),
      observedContentHash: input.contentHash,
      ...(published ? { processedContentHash: input.contentHash, lastProcessedAt: input.now } : {}),
      lastAttemptedContentHash: input.contentHash,
      baselineEligible: false,
      ...(externalRef ? { externalRef: { connect: { id: externalRef.id } } } : {}),
      lastSeenScanRunId: input.runId,
      lastAttemptedAt: input.now
    },
    update: {
      externalId: input.externalId,
      ...inventoryStatData(input.state),
      observedContentHash: input.contentHash,
      ...(published ? { processedContentHash: input.contentHash, lastProcessedAt: input.now } : {}),
      lastAttemptedContentHash: input.contentHash,
      baselineEligible: false,
      externalRef: externalRef ? { connect: { id: externalRef.id } } : { disconnect: true },
      lastSeenScanRunId: input.runId,
      lastAttemptedAt: input.now,
      lastErrorCode: null,
      lastErrorSummary: null,
      lastErrorRetryable: null
    }
  })
  if (!published) {
    await input.transaction.scanRunItem.update({
      where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
      data: { inventoryDecision: 'PENDING_SOURCE_REFRESH' }
    })
  }
  const currentCheckpoint = await input.transaction.scanRunItem.findUniqueOrThrow({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    select: { status: true, action: true }
  })
  await applyRunInputMetricTransition(
    input.transaction,
    input.runId,
    input.previousCheckpoint,
    currentCheckpoint,
    input.previousCheckpoint?.status === 'SUCCESS' || input.previousCheckpoint?.status === 'SKIPPED'
      ? 0
      : boundedMilliseconds(input.publishDurationMs)
  )
}

export async function recordInventoryFailure(input: {
  transaction: ScanTransaction
  runId: string
  checkpointOrdinal: number
  checkpointKey: string
  relativePath: string
  contentHash: string
  externalId: string
  state: StableFileState | undefined
  error: unknown
  parsed: boolean
  now: Date
}) {
  const classified = classifyInventoryFailure(input.error)
  const existing = await input.transaction.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    select: { status: true, action: true, newImageCount: true }
  })
  // A transaction can commit even if its acknowledgement is lost. Never turn an already
  // committed publication into a failure when the caller subsequently records the error.
  if (existing?.status === 'SUCCESS' || existing?.status === 'SKIPPED') {
    return { status: existing.status, newImages: existing.newImageCount }
  }
  const inventoryErrorData = {
    externalId: input.externalId,
    observedContentHash: input.contentHash,
    lastAttemptedContentHash: input.contentHash,
    baselineEligible: false,
    lastSeenScanRunId: input.runId,
    lastAttemptedAt: input.now,
    lastErrorCode: classified.code,
    lastErrorSummary: classified.summary,
    // false is reserved for failures proven to be determined by this exact content hash.
    // A terminal external-state conflict uses null so a later ScanRun can reevaluate it.
    lastErrorRetryable: classified.retryable ? true : classified.contentDeterministic ? false : null
  }
  if (input.state) {
    await input.transaction.pixivMetadataInventory.upsert({
      where: { relativePath: input.relativePath },
      create: { relativePath: input.relativePath, ...inventoryStatData(input.state), ...inventoryErrorData },
      update: { ...inventoryStatData(input.state), ...inventoryErrorData }
    })
  } else {
    await input.transaction.pixivMetadataInventory.updateMany({
      where: { relativePath: input.relativePath },
      data: inventoryErrorData
    })
  }
  await input.transaction.scanRunItem.upsert({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: input.checkpointKey } },
    create: {
      scanRunId: input.runId,
      checkpointKey: input.checkpointKey,
      externalId: input.externalId,
      metadataRelativePath: input.relativePath,
      status: 'FAILED',
      action: input.parsed ? 'FAILED_COLLECT' : 'FAILED_PARSE',
      attempt: 1,
      errorMessage: classified.summary,
      finishedAt: input.now
    },
    update: {
      status: 'FAILED',
      action: input.parsed ? 'FAILED_COLLECT' : 'FAILED_PARSE',
      attempt: { increment: 1 },
      errorMessage: classified.summary,
      finishedAt: input.now
    }
  })
  await advanceRunCheckpoint(input.transaction, input.runId, input.checkpointOrdinal)
  await applyRunInputMetricTransition(input.transaction, input.runId, existing, {
    status: 'FAILED',
    action: input.parsed ? 'FAILED_COLLECT' : 'FAILED_PARSE'
  })
  return { status: 'FAILED' as const, newImages: 0 }
}

type MetricCheckpoint = Pick<Prisma.ScanRunItemGetPayload<Record<string, never>>, 'status' | 'action'>

async function applyRunInputMetricTransition(
  transaction: ScanTransaction,
  runId: string,
  before: MetricCheckpoint | null,
  after: MetricCheckpoint,
  publishDurationMs = 0
) {
  // Retries replace an existing checkpoint outcome. Applying state deltas keeps aggregate metrics
  // correct when FAILED later becomes SUCCESS/SKIPPED, or when a committed result is replayed.
  const parsedDelta = Number(isParsedCheckpoint(after)) - Number(isParsedCheckpoint(before))
  const publishedDelta = Number(isPublishedCheckpoint(after)) - Number(isPublishedCheckpoint(before))
  const failedDelta = Number(after.status === 'FAILED') - Number(before?.status === 'FAILED')
  if (parsedDelta === 0 && publishedDelta === 0 && failedDelta === 0 && publishDurationMs === 0) return
  await transaction.scanRun.update({
    where: { id: runId },
    data: {
      ...(parsedDelta !== 0 ? { parsedInputs: { increment: parsedDelta } } : {}),
      ...(publishedDelta !== 0 ? { publishedInputs: { increment: publishedDelta } } : {}),
      ...(failedDelta !== 0 ? { failedInputs: { increment: failedDelta } } : {}),
      ...(publishDurationMs > 0 ? { publishDurationMs: { increment: publishDurationMs } } : {})
    }
  })
}

function isParsedCheckpoint(checkpoint: MetricCheckpoint | null): boolean {
  return Boolean(
    checkpoint && ['CREATE', 'UPDATE', 'SKIP_EXISTING', 'FAILED_COLLECT', 'FAILED_WRITE'].includes(checkpoint.action)
  )
}

function isPublishedCheckpoint(checkpoint: MetricCheckpoint | null): boolean {
  return Boolean(checkpoint?.status === 'SUCCESS' && ['CREATE', 'UPDATE'].includes(checkpoint.action))
}

async function advanceRunCheckpoint(transaction: ScanTransaction, runId: string, checkpointOrdinal: number) {
  await transaction.scanRun.updateMany({
    where: { id: runId, checkpointOrdinal: { lt: checkpointOrdinal + 1 } },
    data: { checkpointStage: 'PROCESSING', checkpointOrdinal: checkpointOrdinal + 1 }
  })
}
