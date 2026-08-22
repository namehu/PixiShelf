import { performance } from 'node:perf_hooks'
import type { Prisma } from '@pixishelf/db'
import type { ScanV2Payload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { throwIfAborted } from './bounded.ts'
import { readStableFileContent, type StableFileState } from './content-reader.ts'
import { createAuditMetadataDigestAccumulator } from './digests.ts'
import { discoverAuditMetadataStatCandidatePages } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { ensurePixivInventoryRootIdentity } from './inventory-run.ts'
import { hashScanRootIdentity, inventoryStatData, sameInventoryState } from './inventory.ts'
import { finalizeScanError } from './lifecycle.ts'
import { metadataCandidateFromPath, parseMetadataDocument, type ScanMetadata } from './metadata.ts'
import { resolveSafeExistingPath, resolveSafeScanRoot, type SafeScanRoot } from './paths.ts'
import { reportScanPageProgress } from './progress.ts'
import type { MetadataInputRow, ScanRunRecord } from './run-store.ts'
import type {
  ScanDatabase,
  ScanExecutionResult,
  ScanExecutorDependencies,
  ScanExecutorLimits,
  ScanTransaction
} from './types.ts'
import { DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES } from './types.ts'

type AuditContext = ExecutionContext<ScanV2Payload, EnqueuedChildJob>
type AuditDifferenceKind = 'NEW' | 'CHANGED' | 'MISSING' | 'INVALID' | 'IDENTITY_CONFLICT' | 'UNCHANGED'

interface PreparedAuditObservation {
  state: StableFileState
  contentHash: string | null
  metadata: ScanMetadata | null
  kind?: Extract<AuditDifferenceKind, 'INVALID' | 'IDENTITY_CONFLICT' | 'UNCHANGED'>
  issueCode?: string
  issueSummary?: string
  contentHashed: boolean
  parsed: boolean
}

type AuditInventory = Prisma.PixivMetadataInventoryGetPayload<Record<string, never>>
type AuditSourceRef = {
  id: string
  externalId: string
  artworkId: number
  artwork: { metaSource: string | null; externalRefs: Array<{ id: string }> }
}

export interface ConsistencyAuditResult extends ScanExecutionResult {
  newInputs: number
  changedInputs: number
  missingInputs: number
  invalidInputs: number
  identityConflictInputs: number
  unchangedInputs: number
}

const DEFAULT_RETRY_DELAY_MS = 60_000
const MISSING_AUDIT_ITEM_BATCH_SIZE = 500

export async function executeConsistencyAudit(
  context: AuditContext,
  dependencies: ScanExecutorDependencies
): Promise<JobExecutionOutcome<ConsistencyAuditResult>> {
  const now = dependencies.now ?? (() => new Date())
  const limits = { ...defaultAuditLimits(), ...dependencies.config.limits }
  const excludedRootDirectories =
    dependencies.config.discoveryExcludedRootDirectories ?? DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES
  let runId: string | null = null
  try {
    const root = await resolveSafeScanRoot(dependencies.config.scanRoot)
    const rootPathHash = hashScanRootIdentity(root.absolutePath)
    const inventoryState = await ensurePixivInventoryRootIdentity({
      context,
      rootPathHash,
      rootDeviceId: root.deviceId,
      rootInode: root.inode,
      now: now()
    })
    if (inventoryState.status !== 'READY') {
      throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv metadata inventory baseline is not ready')
    }
    let run = await startOrResumeAuditRun({ context, database: dependencies.database, now: now() })
    runId = run.id
    run = await freezeAuditSnapshot({
      context,
      dependencies,
      root,
      run,
      inventoryState,
      limits,
      excludedRootDirectories,
      now: now()
    })
    const snapshot = await verifyAuditSnapshot(dependencies.database, run, limits)
    if (snapshot.count === 0) {
      throw new ScanExecutorError('EMPTY_CONSISTENCY_AUDIT', 'Consistency audit discovered no metadata inputs')
    }
    const duplicateExpectedExternalIds = await findDuplicateExpectedExternalIds(dependencies.database, run.id)

    let processed = 0
    for await (const page of iterateAuditInputPages(dependencies.database, run.id, limits.pageSize)) {
      throwIfAborted(context.signal)
      const pending = page.filter((row) => row.auditDifferenceKind === null)
      const inventories = await dependencies.database.pixivMetadataInventory.findMany({
        where: { relativePath: { in: pending.map((row) => row.relativePath) } }
      })
      const inventoryByPath = new Map(inventories.map((inventory) => [inventory.relativePath, inventory]))
      const duplicateRows = pending.filter(
        (row) => row.expectedExternalId && duplicateExpectedExternalIds.has(row.expectedExternalId)
      )
      for (const row of duplicateRows) {
        const inventory = inventoryByPath.get(row.relativePath)
        await commitAuditObservation({
          context,
          runId: run.id,
          baselineGeneration: run.inventoryBaselineGeneration!,
          row,
          observation: {
            state: stateFromRow(row),
            contentHash: inventory?.observedContentHash ?? null,
            metadata: null,
            kind: 'IDENTITY_CONFLICT',
            issueCode: 'DUPLICATE_METADATA_IDENTITY',
            issueSummary: 'Multiple metadata paths declare the same Pixiv identity',
            contentHashed: false,
            parsed: false
          },
          now: now()
        })
      }
      const ordinaryRows = pending.filter(
        (row) => !row.expectedExternalId || !duplicateExpectedExternalIds.has(row.expectedExternalId)
      )
      const fast = await processFastUnchangedPage({ context, runId: run.id, rows: ordinaryRows, inventoryByPath })
      const duplicateIds = new Set(duplicateRows.map((row) => row.id))
      for (const conflict of fast.conflicts) {
        await commitAuditObservation({
          context,
          runId: run.id,
          baselineGeneration: run.inventoryBaselineGeneration!,
          row: conflict.row,
          observation: conflict.observation,
          now: now()
        })
      }
      for (const row of page) {
        throwIfAborted(context.signal)
        if (row.auditDifferenceKind === null && !duplicateIds.has(row.id) && !fast.handledIds.has(row.id)) {
          const observation = await prepareAuditObservation({
            context,
            root,
            row,
            limits,
            inventory: inventoryByPath.get(row.relativePath)
          })
          await commitAuditObservation({
            context,
            runId: run.id,
            baselineGeneration: run.inventoryBaselineGeneration!,
            row,
            observation,
            now: now()
          })
        }
        processed += 1
      }
      await reportScanPageProgress({ context, event: 'scan.progress.page', processed, total: snapshot.count })
    }

    const finalRoot = await resolveSafeScanRoot(dependencies.config.scanRoot)
    assertSameRoot(root, finalRoot)
    return await finalizeAuditSuccess({
      context,
      run,
      root,
      rootPathHash,
      baselineGeneration: run.inventoryBaselineGeneration!,
      maxMissing: limits.maxAuditMissingItems,
      limits,
      excludedRootDirectories,
      now: now()
    })
  } catch (error) {
    context.logger.warn('scan.audit.failed', { code: safeAuditErrorCode(error) })
    if (!runId) throw error
    if (error instanceof ScanExecutorError && error.code === 'EMPTY_CONSISTENCY_AUDIT') {
      return finalizeEmptyAuditPause({ context, runId, now: now() })
    }
    return finalizeScanError({
      context,
      runId,
      error,
      now: now(),
      retryDelayMs: dependencies.config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    }) as Promise<JobExecutionOutcome<ConsistencyAuditResult>>
  }
}

async function startOrResumeAuditRun(input: { context: AuditContext; database: ScanDatabase; now: Date }) {
  return mutate(input.context, async (transaction) => {
    const existing = await transaction.scanRun.findUnique({ where: { systemJobId: input.context.job.id } })
    if (!existing) {
      return transaction.scanRun.create({
        data: {
          systemJobId: input.context.job.id,
          type: 'PIXIV',
          mode: 'INCREMENTAL',
          operationKind: 'CONSISTENCY_AUDIT',
          status: 'RUNNING',
          startedAt: input.now,
          checkpointStage: 'DISCOVERY',
          walkedEntries: 0,
          metadataCandidates: 0,
          inventoryUnchanged: 0,
          contentHashed: 0,
          contentChanged: 0,
          parsedInputs: 0,
          publishedInputs: 0,
          failedInputs: 0,
          missingInputs: 0,
          auditNewInputs: 0,
          auditChangedInputs: 0,
          auditInvalidInputs: 0,
          auditIdentityConflictInputs: 0,
          discoveryDurationMs: 0,
          hashDurationMs: 0,
          publishDurationMs: 0
        }
      })
    }
    if (
      existing.type !== 'PIXIV' ||
      existing.mode !== 'INCREMENTAL' ||
      existing.operationKind !== 'CONSISTENCY_AUDIT'
    ) {
      throw new ScanExecutorError('STATE_CONFLICT', 'The ScanRun does not match the consistency audit job')
    }
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new ScanExecutorError('STATE_CONFLICT', 'The consistency audit is already terminal')
    }
    return transaction.scanRun.update({
      where: { id: existing.id },
      data: { status: 'RUNNING', startedAt: existing.startedAt ?? input.now, finishedAt: null, errorMessage: null }
    })
  })
}

async function freezeAuditSnapshot(input: {
  context: AuditContext
  dependencies: ScanExecutorDependencies
  root: SafeScanRoot
  run: ScanRunRecord
  inventoryState: {
    id: string
    baselineGeneration: number
    status: string
    rootPathHash: string
    rootDeviceId: bigint | null
    rootInode: bigint | null
  }
  limits: ScanExecutorLimits
  excludedRootDirectories: readonly string[]
  now: Date
}): Promise<ScanRunRecord> {
  if (input.run.inputFrozenAt) return input.run
  const prepared = await mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return { shouldFreeze: false, run: current }
    await transaction.scanRunMetadataInput.deleteMany({ where: { scanRunId: input.run.id } })
    await transaction.pixivSourceAuditItem.deleteMany({ where: { scanRunId: input.run.id } })
    // A crash during an unfrozen traversal may leave page sightings. Clear only this run's
    // marker before rebuilding, otherwise stale sightings could hide a genuine MISSING item.
    await transaction.pixivMetadataInventory.updateMany({
      where: { lastSeenAuditRunId: input.run.id },
      data: { lastSeenAuditRunId: null }
    })
    const run = await transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        inputCount: 0,
        inputDigest: null,
        inputFrozenAt: null,
        inventoryBaselineGeneration: input.inventoryState.baselineGeneration,
        checkpointStage: 'DISCOVERY',
        checkpointOrdinal: 0,
        walkedEntries: 0,
        metadataCandidates: 0,
        inventoryUnchanged: 0,
        contentHashed: 0,
        contentChanged: 0,
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0,
        missingInputs: 0,
        auditNewInputs: 0,
        auditChangedInputs: 0,
        auditInvalidInputs: 0,
        auditIdentityConflictInputs: 0,
        discoveryDurationMs: 0,
        hashDurationMs: 0,
        publishDurationMs: 0
      }
    })
    return { shouldFreeze: true, run }
  })
  if (!prepared.shouldFreeze) return prepared.run

  const digest = createAuditMetadataDigestAccumulator()
  const started = performance.now()
  let ordinal = 0
  let walkedEntries = 0
  for await (const page of discoverAuditMetadataStatCandidatePages(input.root, input.limits, input.context.signal, {
    onEntry: () => {
      walkedEntries += 1
    },
    excludedRootDirectories: input.excludedRootDirectories
  })) {
    throwIfAborted(input.context.signal)
    const rows = page.map((candidate) => ({
      scanRunId: input.run.id,
      ordinal: ordinal++,
      relativePath: candidate.relativePath,
      contentHash: null,
      ...inventoryStatData(candidate.state),
      expectedExternalId: candidate.artworkId
    }))
    for (const row of rows) digest.update(row)
    if (rows.length > 0) {
      await mutate(input.context, async (transaction) => {
        await transaction.scanRunMetadataInput.createMany({ data: rows })
        await transaction.scanRun.update({
          where: { id: input.run.id },
          data: { inputCount: ordinal, walkedEntries, metadataCandidates: ordinal }
        })
      })
    }
  }
  if (walkedEntries > input.limits.maxDiscoveryEntries) {
    throw new ScanExecutorError(
      'AUDIT_SAFETY_LIMIT_EXCEEDED',
      'Consistency audit reached the configured traversal safety limit'
    )
  }
  const finalRoot = await resolveSafeScanRoot(input.dependencies.config.scanRoot)
  assertSameRoot(input.root, finalRoot)
  const discoveryDurationMs = boundedMilliseconds(performance.now() - started)
  const frozenAt = input.dependencies.now?.() ?? new Date()
  return mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return current
    const state = await transaction.pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })
    assertInventoryBarrier(
      state,
      input.inventoryState.baselineGeneration,
      input.inventoryState.rootPathHash,
      input.root
    )
    return transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        inputCount: ordinal,
        inputDigest: digest.digest(),
        inputFrozenAt: frozenAt,
        totalArtworks: ordinal,
        checkpointStage: 'PROCESSING',
        walkedEntries,
        metadataCandidates: ordinal,
        discoveryDurationMs
      }
    })
  })
}

async function verifyAuditSnapshot(database: ScanDatabase, run: ScanRunRecord, limits: ScanExecutorLimits) {
  if (!run.inputFrozenAt || !run.inputDigest || !/^[a-f0-9]{64}$/.test(run.inputDigest)) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit snapshot header is incomplete')
  }
  if (run.inventoryBaselineGeneration === null || run.inventoryBaselineGeneration < 1) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit inventory generation is missing')
  }
  const digest = createAuditMetadataDigestAccumulator()
  let count = 0
  for await (const page of iterateAuditInputPages(database, run.id, limits.pageSize)) {
    for (const row of page) {
      if (row.ordinal !== count || row.sizeBytes === null || row.mtimeMs === null || !row.expectedExternalId) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit snapshot row is incomplete')
      }
      const candidate = metadataCandidateFromPath({ relativePath: row.relativePath, absolutePath: row.relativePath })
      if (!candidate || candidate.artworkId !== row.expectedExternalId) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit snapshot identity is invalid')
      }
      digest.update(row)
      count += 1
      if (count > limits.maxEntries) {
        throw new ScanExecutorError(
          'AUDIT_SAFETY_LIMIT_EXCEEDED',
          'Consistency audit snapshot exceeds its safety limit'
        )
      }
    }
  }
  if (count !== run.inputCount || digest.digest() !== run.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit snapshot count or digest is invalid')
  }
  return { count }
}

async function processFastUnchangedPage(input: {
  context: AuditContext
  runId: string
  rows: MetadataInputRow[]
  inventoryByPath: Map<string, AuditInventory>
}) {
  const candidates = input.rows.flatMap((row) => {
    const inventory = input.inventoryByPath.get(row.relativePath)
    if (
      !inventory ||
      !sameInventoryState(inventory, stateFromRow(row)) ||
      inventory.processedContentHash === null ||
      inventory.processedContentHash !== inventory.observedContentHash ||
      inventory.lastErrorCode !== null
    ) {
      return []
    }
    return [{ row, inventory }]
  })
  if (candidates.length === 0) {
    return {
      handledIds: new Set<string>(),
      conflicts: [] as Array<{ row: MetadataInputRow; observation: PreparedAuditObservation }>
    }
  }
  return mutate(input.context, async (transaction) => {
    const externalIds = [...new Set(candidates.flatMap(({ inventory }) => inventory.externalId ?? []))]
    const refs =
      externalIds.length === 0
        ? []
        : await transaction.artworkExternalRef.findMany({
            where: { providerKey: 'pixiv', externalId: { in: externalIds } },
            select: {
              id: true,
              externalId: true,
              artworkId: true,
              artwork: {
                select: {
                  metaSource: true,
                  externalRefs: { where: { providerKey: 'pixiv' }, select: { id: true }, take: 2 }
                }
              }
            }
          })
    const refByExternalId = new Map(refs.map((ref) => [ref.externalId, ref]))
    const legacyExternalIds = candidates
      .filter(({ inventory }) => inventory.externalRefId === null && inventory.externalId !== null)
      .map(({ inventory }) => inventory.externalId!)
    const legacyArtworks =
      legacyExternalIds.length === 0
        ? []
        : await transaction.artwork.findMany({
            where: { externalId: { in: legacyExternalIds } },
            select: { externalId: true }
          })
    const legacyIds = new Set(legacyArtworks.flatMap((artwork) => artwork.externalId ?? []))
    const unchanged: typeof candidates = []
    const conflicts: Array<{ row: MetadataInputRow; observation: PreparedAuditObservation }> = []
    for (const candidate of candidates) {
      const externalId = candidate.inventory.externalId
      const ref = externalId ? (refByExternalId.get(externalId) ?? null) : null
      const conflict =
        externalId === null ||
        externalId !== candidate.row.expectedExternalId ||
        (candidate.inventory.externalRefId !== null && candidate.inventory.externalRefId !== ref?.id) ||
        (candidate.inventory.processedContentHash !== null && ref === null) ||
        (ref !== null &&
          (ref.artwork.metaSource !== candidate.row.relativePath || ref.artwork.externalRefs.length !== 1)) ||
        (candidate.inventory.externalRefId === null && ref === null && legacyIds.has(externalId))
      if (conflict) {
        conflicts.push({
          row: candidate.row,
          observation: {
            state: stateFromRow(candidate.row),
            contentHash: candidate.inventory.observedContentHash,
            metadata: null,
            kind: 'IDENTITY_CONFLICT',
            issueCode: 'IDENTITY_CONFLICT',
            issueSummary: 'Metadata identity conflicts with the stored Pixiv source',
            contentHashed: false,
            parsed: false
          }
        })
      } else {
        unchanged.push(candidate)
      }
    }
    if (unchanged.length > 0) {
      const claimed = await transaction.scanRunMetadataInput.updateMany({
        where: { id: { in: unchanged.map(({ row }) => row.id) }, scanRunId: input.runId, auditDifferenceKind: null },
        data: { auditDifferenceKind: 'UNCHANGED' }
      })
      await transaction.pixivMetadataInventory.updateMany({
        where: { id: { in: unchanged.map(({ inventory }) => inventory.id) } },
        data: { lastSeenAuditRunId: input.runId }
      })
      if (claimed.count > 0) {
        await transaction.scanRun.update({
          where: { id: input.runId },
          data: {
            checkpointOrdinal: { increment: claimed.count },
            inventoryUnchanged: { increment: claimed.count }
          }
        })
      }
    }
    return { handledIds: new Set(candidates.map(({ row }) => row.id)), conflicts }
  })
}

async function prepareAuditObservation(input: {
  context: AuditContext
  root: SafeScanRoot
  row: MetadataInputRow
  limits: ScanExecutorLimits
  inventory: AuditInventory | undefined
}): Promise<PreparedAuditObservation> {
  const state = stateFromRow(input.row)
  const inventory = input.inventory
  if (
    inventory &&
    inventory.externalId === input.row.expectedExternalId &&
    sameInventoryState(inventory, state) &&
    inventory.processedContentHash !== null &&
    inventory.processedContentHash === inventory.observedContentHash &&
    inventory.lastErrorCode === null
  ) {
    return {
      state,
      contentHash: inventory.observedContentHash,
      metadata: null,
      kind: 'UNCHANGED',
      contentHashed: false,
      parsed: false
    }
  }
  if (
    inventory &&
    sameInventoryState(inventory, state) &&
    inventory.lastAttemptedContentHash === inventory.observedContentHash &&
    inventory.lastErrorRetryable === false &&
    inventory.lastErrorCode === 'METADATA_INVALID'
  ) {
    return {
      state,
      contentHash: inventory.observedContentHash,
      metadata: null,
      kind: 'INVALID',
      issueCode: 'METADATA_INVALID',
      issueSummary: 'Metadata document is invalid',
      contentHashed: false,
      parsed: false
    }
  }
  if (state.sizeBytes > BigInt(input.limits.maxMetadataBytes)) {
    return {
      state,
      contentHash: null,
      metadata: null,
      kind: 'INVALID',
      issueCode: 'METADATA_TOO_LARGE',
      issueSummary: 'Metadata document exceeds the configured byte limit',
      contentHashed: false,
      parsed: false
    }
  }
  const resolved = await resolveSafeExistingPath(input.root, input.row.relativePath, 'file')
  const candidate = metadataCandidateFromPath(resolved)
  if (!candidate) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit path is invalid')
  const content = await readStableFileContent({
    absolutePath: candidate.absolutePath,
    maxBytes: input.limits.maxMetadataBytes,
    signal: input.context.signal
  })
  if (!sameFrozenState(state, content.state)) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Metadata input changed after the audit snapshot was frozen')
  }
  let metadata: ScanMetadata
  try {
    metadata = parseMetadataDocument(content.bytes.toString('utf8'), candidate.format)
  } catch {
    return {
      state: content.state,
      contentHash: content.sha256,
      metadata: null,
      kind: 'INVALID',
      issueCode: 'METADATA_INVALID',
      issueSummary: 'Metadata document is invalid',
      contentHashed: true,
      parsed: false
    }
  }
  return {
    state: content.state,
    contentHash: content.sha256,
    metadata,
    ...(metadata.id !== candidate.artworkId
      ? {
          kind: 'IDENTITY_CONFLICT' as const,
          issueCode: 'IDENTITY_CONFLICT',
          issueSummary: 'Metadata identity does not match its filename'
        }
      : {}),
    contentHashed: true,
    parsed: true
  }
}

async function commitAuditObservation(input: {
  context: AuditContext
  runId: string
  baselineGeneration: number
  row: MetadataInputRow
  observation: PreparedAuditObservation
  now: Date
}) {
  return mutate(input.context, async (transaction) => {
    const currentInventory = await transaction.pixivMetadataInventory.findUnique({
      where: { relativePath: input.row.relativePath }
    })
    const expectedExternalId = input.row.expectedExternalId!
    let externalRef: AuditSourceRef | null = null
    const lookupExternalId = input.observation.metadata?.id ?? currentInventory?.externalId ?? expectedExternalId
    if (lookupExternalId) {
      externalRef = await transaction.artworkExternalRef.findUnique({
        where: {
          providerKey_externalId: { providerKey: 'pixiv', externalId: lookupExternalId }
        },
        select: {
          id: true,
          externalId: true,
          artworkId: true,
          artwork: {
            select: {
              metaSource: true,
              externalRefs: { where: { providerKey: 'pixiv' }, select: { id: true }, take: 2 }
            }
          }
        }
      })
    }
    const legacyArtwork =
      externalRef === null
        ? await transaction.artwork.findUnique({ where: { externalId: lookupExternalId }, select: { id: true } })
        : null
    const classification = classifyObservation({
      prepared: input.observation,
      expectedExternalId,
      relativePath: input.row.relativePath,
      inventory: currentInventory,
      externalRef,
      legacyArtworkExists: legacyArtwork !== null
    })
    const claimed = await transaction.scanRunMetadataInput.updateMany({
      where: { id: input.row.id, scanRunId: input.runId, auditDifferenceKind: null },
      data: {
        auditDifferenceKind: classification.kind,
        contentHash: input.observation.contentHash,
        expectedInventoryId: currentInventory?.id ?? null,
        expectedExternalRefId: externalRef?.id ?? null,
        expectedArtworkId: externalRef?.artworkId ?? null
      }
    })
    if (claimed.count === 0) return

    const stat = inventoryStatData(input.observation.state)
    const hasIssue = classification.kind === 'INVALID' || classification.kind === 'IDENTITY_CONFLICT'
    const safeExternalId =
      classification.kind === 'IDENTITY_CONFLICT'
        ? (currentInventory?.externalId ?? null)
        : (input.observation.metadata?.id ?? currentInventory?.externalId ?? expectedExternalId)
    const inventory = await transaction.pixivMetadataInventory.upsert({
      where: { relativePath: input.row.relativePath },
      create: {
        relativePath: input.row.relativePath,
        externalId: safeExternalId,
        ...stat,
        observedContentHash: input.observation.contentHash,
        lastAttemptedContentHash: hasIssue ? input.observation.contentHash : null,
        externalRefId: classification.kind === 'IDENTITY_CONFLICT' ? null : (externalRef?.id ?? null),
        baselineGeneration: input.baselineGeneration,
        baselineEligible: false,
        lastSeenAuditRunId: input.runId,
        lastAttemptedAt: hasIssue ? input.now : null,
        lastErrorCode: hasIssue ? classification.issueCode : null,
        lastErrorSummary: hasIssue ? classification.issueSummary : null,
        lastErrorRetryable: hasIssue ? false : null
      },
      update: {
        ...stat,
        observedContentHash: input.observation.contentHash ?? currentInventory?.observedContentHash ?? null,
        lastSeenAuditRunId: input.runId,
        ...(classification.kind === 'IDENTITY_CONFLICT'
          ? {}
          : {
              externalId: safeExternalId,
              ...(externalRef ? { externalRefId: externalRef.id } : {})
            }),
        ...(hasIssue
          ? {
              lastAttemptedContentHash: input.observation.contentHash,
              lastAttemptedAt: input.now,
              lastErrorCode: classification.issueCode,
              lastErrorSummary: classification.issueSummary,
              lastErrorRetryable: false
            }
          : {
              lastErrorCode: null,
              lastErrorSummary: null,
              lastErrorRetryable: null
            })
      }
    })

    let auditItemId: string | null = null
    if (classification.kind !== 'UNCHANGED') {
      const item = await transaction.pixivSourceAuditItem.create({
        data: {
          scanRunId: input.runId,
          ordinal: input.row.ordinal,
          differenceKind: classification.kind,
          relativePath: input.row.relativePath,
          expectedExternalId,
          observedExternalId: input.observation.metadata?.id ?? currentInventory?.externalId ?? null,
          title: input.observation.metadata?.title ?? null,
          artistName: input.observation.metadata?.user ?? null,
          inventoryId: inventory.id,
          externalRefId: externalRef?.id ?? currentInventory?.externalRefId ?? null,
          artworkId: externalRef?.artworkId ?? null,
          observedContentHash: input.observation.contentHash,
          processedContentHash: currentInventory?.processedContentHash ?? null,
          ...stat,
          issueCode: classification.issueCode,
          issueSummary: classification.issueSummary
        }
      })
      auditItemId = item.id
      await transaction.scanRunMetadataInput.update({
        where: { id: input.row.id },
        data: {
          sourceAuditItemId: item.id,
          expectedInventoryId: inventory.id,
          expectedExternalRefId: externalRef?.id ?? currentInventory?.externalRefId ?? null,
          expectedArtworkId: externalRef?.artworkId ?? null
        }
      })
    }

    await transaction.scanRun.update({
      where: { id: input.runId },
      data: {
        checkpointOrdinal: { increment: 1 },
        ...(input.observation.contentHashed ? { contentHashed: { increment: 1 } } : {}),
        ...(input.observation.parsed ? { parsedInputs: { increment: 1 } } : {}),
        ...(classification.contentChanged ? { contentChanged: { increment: 1 } } : {}),
        ...(classification.kind === 'UNCHANGED' ? { inventoryUnchanged: { increment: 1 } } : {}),
        ...(classification.kind === 'NEW' ? { auditNewInputs: { increment: 1 } } : {}),
        ...(classification.kind === 'CHANGED' ? { auditChangedInputs: { increment: 1 } } : {}),
        ...(classification.kind === 'INVALID'
          ? { auditInvalidInputs: { increment: 1 }, failedInputs: { increment: 1 } }
          : {}),
        ...(classification.kind === 'IDENTITY_CONFLICT'
          ? { auditIdentityConflictInputs: { increment: 1 }, failedInputs: { increment: 1 } }
          : {})
      }
    })
    return auditItemId
  })
}

function classifyObservation(input: {
  prepared: PreparedAuditObservation
  expectedExternalId: string
  relativePath: string
  inventory: Prisma.PixivMetadataInventoryGetPayload<Record<string, never>> | null
  externalRef: AuditSourceRef | null
  legacyArtworkExists: boolean
}): {
  kind: Exclude<AuditDifferenceKind, 'MISSING'>
  issueCode: string | null
  issueSummary: string | null
  contentChanged: boolean
} {
  if (input.prepared.kind === 'INVALID') {
    return {
      kind: 'INVALID',
      issueCode: input.prepared.issueCode ?? 'METADATA_INVALID',
      issueSummary: input.prepared.issueSummary ?? 'Metadata document is invalid',
      contentChanged: input.prepared.contentHash !== input.inventory?.processedContentHash
    }
  }
  const observedExternalId = input.prepared.metadata?.id ?? input.inventory?.externalId ?? null
  const identityConflict =
    input.prepared.kind === 'IDENTITY_CONFLICT' ||
    observedExternalId !== input.expectedExternalId ||
    (input.inventory !== null &&
      input.inventory.externalId !== null &&
      input.inventory.externalId !== observedExternalId) ||
    (input.inventory !== null &&
      input.inventory.externalRefId !== null &&
      input.inventory.externalRefId !== input.externalRef?.id) ||
    (input.inventory !== null && input.inventory.processedContentHash !== null && input.externalRef === null) ||
    (input.externalRef !== null &&
      (input.externalRef.artwork.metaSource !== input.relativePath ||
        input.externalRef.artwork.externalRefs.length !== 1)) ||
    (input.externalRef === null && input.legacyArtworkExists)
  if (identityConflict) {
    return {
      kind: 'IDENTITY_CONFLICT',
      issueCode: input.prepared.issueCode ?? 'IDENTITY_CONFLICT',
      issueSummary: input.prepared.issueSummary ?? 'Metadata identity conflicts with the stored Pixiv source',
      contentChanged: input.prepared.contentHash !== input.inventory?.processedContentHash
    }
  }
  if (input.prepared.kind === 'UNCHANGED') {
    return { kind: 'UNCHANGED', issueCode: null, issueSummary: null, contentChanged: false }
  }
  if (input.prepared.contentHash === input.inventory?.processedContentHash) {
    return { kind: 'UNCHANGED', issueCode: null, issueSummary: null, contentChanged: false }
  }
  if (!input.externalRef && (!input.inventory || input.inventory.processedContentHash === null)) {
    return { kind: 'NEW', issueCode: null, issueSummary: null, contentChanged: true }
  }
  return { kind: 'CHANGED', issueCode: null, issueSummary: null, contentChanged: true }
}

async function finalizeAuditSuccess(input: {
  context: AuditContext
  run: ScanRunRecord
  root: SafeScanRoot
  rootPathHash: string
  baselineGeneration: number
  maxMissing: number
  limits: ScanExecutorLimits
  excludedRootDirectories: readonly string[]
  now: Date
}): Promise<JobExecutionOutcome<ConsistencyAuditResult>> {
  return input.context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'PAUSING') {
      await scope.transaction.scanRun.update({
        where: { id: input.run.id },
        data: { status: 'PAUSED', finishedAt: input.now, checkpointStage: 'PAUSED', errorMessage: null }
      })
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Consistency audit paused at a durable checkpoint' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await scope.transaction.scanRun.update({
        where: { id: input.run.id },
        data: { status: 'CANCELLED', finishedAt: input.now, checkpointStage: 'CANCELLED', errorMessage: null }
      })
      await scope.cancel('Consistency audit cancelled')
      return
    }
    const currentRun = await scope.transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    await verifyAuditSnapshot(scope.transaction as unknown as ScanDatabase, currentRun, input.limits)
    const classified = await scope.transaction.scanRunMetadataInput.count({
      where: { scanRunId: input.run.id, auditDifferenceKind: { not: null } }
    })
    if (classified !== currentRun.inputCount) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit classification is incomplete')
    }
    const state = await scope.transaction.pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })
    assertInventoryBarrier(state, input.baselineGeneration, input.rootPathHash, input.root)
    const missing = await scope.transaction.pixivMetadataInventory.findMany({
      where: {
        baselineGeneration: input.baselineGeneration,
        createdAt: { lte: currentRun.inputFrozenAt! },
        OR: [{ lastSeenAuditRunId: null }, { lastSeenAuditRunId: { not: input.run.id } }],
        ...(input.excludedRootDirectories.length > 0
          ? {
              NOT: input.excludedRootDirectories.map((directoryName) => ({
                relativePath: { startsWith: `${directoryName}/` }
              }))
            }
          : {})
      },
      orderBy: { relativePath: 'asc' },
      take: input.maxMissing + 1
    })
    if (missing.length > input.maxMissing) {
      await scope.transaction.pixivSourceAuditItem.deleteMany({
        where: { scanRunId: input.run.id, differenceKind: 'MISSING' }
      })
      await scope.transaction.scanRun.update({
        where: { id: input.run.id },
        data: {
          status: 'FAILED',
          finishedAt: input.now,
          checkpointStage: 'FAILED',
          missingInputs: 0,
          errorMessage: 'Consistency audit missing-item count exceeds the configured safety limit'
        }
      })
      await scope.fail({
        errorCode: 'PRECONDITION_FAILED',
        error: 'Consistency audit missing-item count exceeds the configured safety limit',
        message: 'Consistency audit missing-item count exceeds the configured safety limit'
      })
      return
    }

    for (let offset = 0; offset < missing.length; offset += MISSING_AUDIT_ITEM_BATCH_SIZE) {
      await scope.transaction.pixivSourceAuditItem.createMany({
        data: missing.slice(offset, offset + MISSING_AUDIT_ITEM_BATCH_SIZE).map((inventory, index) => ({
          scanRunId: input.run.id,
          ordinal: currentRun.inputCount + offset + index,
          differenceKind: 'MISSING',
          relativePath: inventory.relativePath,
          expectedExternalId: inventory.externalId,
          observedExternalId: null,
          inventoryId: inventory.id,
          externalRefId: inventory.externalRefId,
          observedContentHash: inventory.observedContentHash,
          processedContentHash: inventory.processedContentHash,
          sizeBytes: inventory.sizeBytes,
          mtimeMs: inventory.mtimeMs,
          ctimeMs: inventory.ctimeMs,
          deviceId: inventory.deviceId,
          inode: inventory.inode,
          issueCode: 'SOURCE_MISSING',
          issueSummary: 'Metadata path was not present in the completed consistency audit'
        }))
      })
    }

    const grouped = await scope.transaction.scanRunMetadataInput.groupBy({
      by: ['auditDifferenceKind'],
      where: { scanRunId: input.run.id },
      _count: { _all: true }
    })
    const counts = new Map(grouped.map((row) => [row.auditDifferenceKind, row._count._all]))
    const result: ConsistencyAuditResult = {
      scanRunId: input.run.id,
      total: currentRun.inputCount,
      succeeded: (counts.get('NEW') ?? 0) + (counts.get('CHANGED') ?? 0),
      skipped: counts.get('UNCHANGED') ?? 0,
      failed: (counts.get('INVALID') ?? 0) + (counts.get('IDENTITY_CONFLICT') ?? 0),
      newImages: 0,
      newInputs: counts.get('NEW') ?? 0,
      changedInputs: counts.get('CHANGED') ?? 0,
      missingInputs: missing.length,
      invalidInputs: counts.get('INVALID') ?? 0,
      identityConflictInputs: counts.get('IDENTITY_CONFLICT') ?? 0,
      unchangedInputs: counts.get('UNCHANGED') ?? 0
    }
    await scope.transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        status: 'COMPLETED',
        finishedAt: input.now,
        checkpointStage: 'COMPLETED',
        checkpointOrdinal: currentRun.inputCount,
        processedArtworks: currentRun.inputCount,
        succeededArtworks: result.succeeded,
        skippedArtworks: result.skipped,
        failedArtworks: result.failed,
        failedInputs: result.failed,
        newImages: 0,
        missingInputs: result.missingInputs,
        auditNewInputs: result.newInputs,
        auditChangedInputs: result.changedInputs,
        auditInvalidInputs: result.invalidInputs,
        auditIdentityConflictInputs: result.identityConflictInputs,
        inventoryUnchanged: result.unchangedInputs,
        durationMs: elapsedMilliseconds(input.run.startedAt, input.now),
        errorMessage: null
      }
    })
    await scope.complete({ result, message: 'Pixiv source consistency audit completed' })
  })
}

async function findDuplicateExpectedExternalIds(database: ScanDatabase, scanRunId: string) {
  const grouped = await database.scanRunMetadataInput.groupBy({
    by: ['expectedExternalId'],
    where: { scanRunId, expectedExternalId: { not: null } },
    _count: { _all: true }
  })
  return new Set(
    grouped.flatMap((row) => (row.expectedExternalId !== null && row._count._all > 1 ? [row.expectedExternalId] : []))
  )
}

async function finalizeEmptyAuditPause(input: { context: AuditContext; runId: string; now: Date }) {
  return input.context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    await scope.transaction.scanRunMetadataInput.deleteMany({ where: { scanRunId: input.runId } })
    await scope.transaction.pixivSourceAuditItem.deleteMany({ where: { scanRunId: input.runId } })
    await scope.transaction.pixivMetadataInventory.updateMany({
      where: { lastSeenAuditRunId: input.runId },
      data: { lastSeenAuditRunId: null }
    })
    const cancelling = scope.executionStatus === 'CANCELLING'
    await scope.transaction.scanRun.update({
      where: { id: input.runId },
      data: {
        status: cancelling ? 'CANCELLED' : 'PAUSED',
        finishedAt: input.now,
        inputCount: 0,
        inputDigest: null,
        inputFrozenAt: null,
        inventoryBaselineGeneration: null,
        totalArtworks: 0,
        processedArtworks: 0,
        succeededArtworks: 0,
        skippedArtworks: 0,
        failedArtworks: 0,
        newImages: 0,
        checkpointStage: cancelling ? 'CANCELLED' : 'PAUSED',
        checkpointOrdinal: 0,
        walkedEntries: 0,
        metadataCandidates: 0,
        inventoryUnchanged: 0,
        contentHashed: 0,
        contentChanged: 0,
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0,
        missingInputs: 0,
        auditNewInputs: 0,
        auditChangedInputs: 0,
        auditInvalidInputs: 0,
        auditIdentityConflictInputs: 0,
        discoveryDurationMs: 0,
        hashDurationMs: 0,
        publishDurationMs: 0,
        durationMs: null,
        errorMessage: null
      }
    })
    if (cancelling) {
      await scope.cancel('Consistency audit cancelled')
      return
    }
    await scope.pause({
      reason: scope.executionStatus === 'PAUSING' ? 'USER_REQUESTED' : 'ACTION_REQUIRED',
      message:
        scope.executionStatus === 'PAUSING'
          ? 'Consistency audit paused at a durable checkpoint'
          : 'Consistency audit discovered no metadata inputs',
      ...(scope.executionStatus === 'PAUSING' ? {} : { data: { decisionCode: 'EMPTY_CONSISTENCY_AUDIT' } })
    })
  })
}

async function* iterateAuditInputPages(database: ScanDatabase, scanRunId: string, pageSize: number) {
  let ordinal = -1
  while (true) {
    const page = await database.scanRunMetadataInput.findMany({
      where: { scanRunId, ordinal: { gt: ordinal } },
      orderBy: { ordinal: 'asc' },
      take: pageSize
    })
    if (page.length === 0) return
    yield page
    ordinal = page.at(-1)!.ordinal
  }
}

function stateFromRow(row: MetadataInputRow): StableFileState {
  if (row.sizeBytes === null || row.mtimeMs === null) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Consistency audit input has no frozen file state')
  }
  return {
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs,
    ctimeMs: row.ctimeMs,
    deviceId: row.deviceId,
    inode: row.inode
  }
}

function sameFrozenState(left: StableFileState, right: StableFileState) {
  return (
    left.sizeBytes === right.sizeBytes &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId &&
    left.inode === right.inode
  )
}

function assertSameRoot(expected: SafeScanRoot, actual: SafeScanRoot) {
  if (
    expected.absolutePath !== actual.absolutePath ||
    expected.deviceId !== actual.deviceId ||
    expected.inode !== actual.inode
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv scan root changed during the consistency audit')
  }
}

function assertInventoryBarrier(
  state: {
    status: string
    baselineGeneration: number
    rootPathHash: string
    rootDeviceId: bigint | null
    rootInode: bigint | null
  },
  generation: number,
  rootPathHash: string,
  root: SafeScanRoot
) {
  if (
    state.status !== 'READY' ||
    state.baselineGeneration !== generation ||
    state.rootPathHash !== rootPathHash ||
    state.rootDeviceId !== root.deviceId ||
    state.rootInode !== root.inode
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv metadata inventory changed during the consistency audit')
  }
}

function defaultAuditLimits(): ScanExecutorLimits {
  return {
    pageSize: 100,
    maxDepth: 12,
    maxDiscoveryEntries: 10_000_000,
    maxEntries: 100_000,
    maxMediaPerArtwork: 2_000,
    concurrency: 4,
    maxMetadataBytes: 16 * 1024 * 1024,
    maxArchiveMediaBytes: 4 * 1024 * 1024 * 1024,
    maxAuditMissingItems: 100_000
  }
}

function boundedMilliseconds(value: number) {
  return Math.min(2_147_483_647, Math.max(0, Math.round(value)))
}

function elapsedMilliseconds(startedAt: Date | null, finishedAt: Date): number | null {
  if (!startedAt) return null
  return Math.min(2_147_483_647, Math.max(0, finishedAt.getTime() - startedAt.getTime()))
}

function safeAuditErrorCode(error: unknown) {
  return error instanceof ScanExecutorError ? error.code : 'UNEXPECTED'
}

function mutate<TResult>(context: AuditContext, operation: (transaction: ScanTransaction) => Promise<TResult>) {
  return context.mutateInTransaction<ScanTransaction & QueueSqlExecutor, TResult>((transaction) =>
    operation(transaction)
  )
}
