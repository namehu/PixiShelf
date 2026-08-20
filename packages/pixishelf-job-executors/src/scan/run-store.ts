import type { LocalDirectoryImportPayload, ScanPayload } from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import {
  createArtistMappingDigestAccumulator,
  createLocalWorkDigestAccumulator,
  createMetadataDigestAccumulator
} from './digests.ts'
import { ScanExecutorError } from './errors.ts'
import { inventoryStatData } from './inventory.ts'
import { metadataCandidateFromPath } from './metadata.ts'
import { assertCanonicalRelativeScanPath } from './paths.ts'
import { logFrozenSnapshotPage } from './progress.ts'
import type { ScanDatabase, ScanTransaction } from './types.ts'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type ScanRunRecord = Prisma.ScanRunGetPayload<Record<string, never>>
export type MetadataInputRow = Prisma.ScanRunMetadataInputGetPayload<Record<string, never>>
export type LocalWorkInputRow = Prisma.ScanRunLocalWorkInputGetPayload<Record<string, never>>
export type LocalArtistMappingInputRow = Prisma.ScanRunLocalArtistMappingInputGetPayload<Record<string, never>>

type ScanContext =
  | ExecutionContext<ScanPayload, EnqueuedChildJob>
  | ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob>

export async function startOrResumeScanRun(input: {
  context: ScanContext
  database: ScanDatabase
  kind: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT' | 'LOCAL_ARTWORK_RESCAN'
  mode: 'FULL' | 'INCREMENTAL' | 'CLIENT_LIST' | 'RESCAN' | 'LOCAL_RESCAN' | 'LOCAL_DIRECTORY_IMPORT'
  now: Date
  requireFrozen: boolean
}): Promise<ScanRunRecord> {
  const existing = await input.database.scanRun.findUnique({ where: { systemJobId: input.context.job.id } })
  if (!existing && input.requireFrozen) {
    throw new ScanExecutorError(
      'INPUT_SNAPSHOT_INVALID',
      'The job is missing its transactionally frozen ScanRun input snapshot'
    )
  }
  const expectedType = input.kind === 'SCAN' ? 'PIXIV' : 'LOCAL_IMPORT'
  return mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUnique({ where: { systemJobId: input.context.job.id } })
    if (!current) {
      return transaction.scanRun.create({
        data: {
          systemJobId: input.context.job.id,
          type: expectedType,
          mode: input.mode,
          status: 'RUNNING',
          startedAt: input.now,
          checkpointStage: 'DISCOVERY',
          checkpointOrdinal: 0,
          ...(expectedType === 'PIXIV' && input.mode === 'INCREMENTAL'
            ? {
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
            : {})
        }
      })
    }
    if (current.type !== expectedType || current.mode !== input.mode) {
      throw new ScanExecutorError('STATE_CONFLICT', 'The frozen ScanRun type or mode does not match the job payload')
    }
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
      throw new ScanExecutorError('STATE_CONFLICT', 'The ScanRun is already terminal')
    }
    return transaction.scanRun.update({
      where: { id: current.id },
      data: {
        status: 'RUNNING',
        startedAt: current.startedAt ?? input.now,
        finishedAt: null,
        errorMessage: null,
        ...(expectedType === 'PIXIV' && input.mode === 'INCREMENTAL'
          ? {
              walkedEntries: current.walkedEntries ?? 0,
              metadataCandidates: current.metadataCandidates ?? current.inputCount,
              inventoryUnchanged: current.inventoryUnchanged ?? 0,
              contentHashed: current.contentHashed ?? 0,
              contentChanged: current.contentChanged ?? current.inputCount,
              parsedInputs: current.parsedInputs ?? 0,
              publishedInputs: current.publishedInputs ?? 0,
              failedInputs: current.failedInputs ?? 0,
              missingInputs: current.missingInputs ?? 0,
              discoveryDurationMs: current.discoveryDurationMs ?? 0,
              hashDurationMs: current.hashDurationMs ?? 0,
              publishDurationMs: current.publishDurationMs ?? 0
            }
          : {})
      }
    })
  })
}

export async function verifyFrozenMetadataSnapshot(input: {
  database: ScanDatabase
  run: ScanRunRecord
  payload: ScanPayload
  pageSize: number
  maxEntries: number
}) {
  assertFrozenHeader(input.run, input.maxEntries)
  if (input.payload.mode === 'CLIENT_LIST') {
    if (input.run.inputCount !== input.payload.inputCount || input.run.inputDigest !== input.payload.inputDigest) {
      throw new ScanExecutorError(
        'INPUT_SNAPSHOT_INVALID',
        'Client metadata snapshot header does not match the payload'
      )
    }
  }
  const digest = createMetadataDigestAccumulator()
  const identities = new Set<string>()
  let count = 0
  for await (const page of iterateFrozenMetadataPages(input.database, input.run.id, input.pageSize)) {
    for (const row of page) {
      assertDenseOrdinal(row.ordinal, count)
      assertCanonicalRelativeScanPath(row.relativePath)
      if (!row.contentHash || !SHA256_PATTERN.test(row.contentHash)) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata input has an invalid content hash')
      }
      const candidate = metadataCandidateFromPath({ relativePath: row.relativePath, absolutePath: row.relativePath })
      if (!candidate) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata path is not a metadata file')
      }
      if (identities.has(candidate.artworkId)) {
        throw new ScanExecutorError(
          'INPUT_SNAPSHOT_INVALID',
          'Frozen metadata input contains duplicate artwork identity'
        )
      }
      identities.add(candidate.artworkId)
      digest.update(row)
      count += 1
      if (count > input.maxEntries) throw tooManySnapshotRows()
    }
  }
  if (count !== input.run.inputCount || digest.digest() !== input.run.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata snapshot count or digest is invalid')
  }
  if (input.payload.mode === 'ARTWORK_RESCAN' && count !== 1) {
    throw new ScanExecutorError(
      'INPUT_SNAPSHOT_INVALID',
      'Artwork rescan must contain exactly one frozen metadata input'
    )
  }
  if (input.payload.mode === 'FULL_RECONCILE' && count === 0) {
    throw new ScanExecutorError('EMPTY_FULL_RECONCILE', 'Full reconcile discovered no metadata inputs')
  }
  return {
    count,
    inputFrozenAt: input.run.inputFrozenAt!,
    metadataCandidates: input.run.metadataCandidates ?? count,
    inventoryUnchanged: input.run.inventoryUnchanged ?? 0,
    failedInputs: input.run.failedInputs ?? 0
  }
}

export async function verifyFrozenLocalSnapshot(input: {
  database: ScanDatabase
  run: ScanRunRecord
  payload: LocalDirectoryImportPayload
  pageSize: number
  maxEntries: number
}) {
  assertFrozenHeader(input.run, input.maxEntries)
  const workDigest = createLocalWorkDigestAccumulator()
  const workIdentities = new Set<string>()
  let workCount = 0
  for await (const page of iterateFrozenLocalWorkPages(input.database, input.run.id, input.pageSize)) {
    for (const row of page) {
      assertDenseOrdinal(row.ordinal, workCount)
      assertCanonicalRelativeScanPath(row.relativePath)
      if (row.kind !== 'MEDIA_DIRECTORY') {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work kind is no longer supported')
      }
      if (row.fingerprint !== null) {
        throw new ScanExecutorError(
          'INPUT_SNAPSHOT_INVALID',
          'Local directory import must not contain content fingerprints'
        )
      }
      const identity = `${row.kind}\0${row.relativePath}`
      if (workIdentities.has(identity)) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work input contains duplicate identity')
      }
      workIdentities.add(identity)
      workDigest.update(row)
      workCount += 1
      if (workCount > input.maxEntries) throw tooManySnapshotRows()
    }
  }
  if (workCount !== input.run.inputCount || workDigest.digest() !== input.run.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work snapshot count or digest is invalid')
  }

  const mappingDigest = createArtistMappingDigestAccumulator()
  const mappingDirectories = new Set<string>()
  const mappings: LocalArtistMappingInputRow[] = []
  let mappingCount = 0
  for await (const page of iterateFrozenLocalMappingPages(input.database, input.run.id, input.pageSize)) {
    for (const row of page) {
      assertDenseOrdinal(row.ordinal, mappingCount)
      if (assertCanonicalRelativeScanPath(row.artistDirectory).includes('/')) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen artist mapping must name one directory segment')
      }
      if (!Number.isSafeInteger(row.artistId) || row.artistId < 1 || mappingDirectories.has(row.artistDirectory)) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen artist mapping identity is invalid')
      }
      mappingDirectories.add(row.artistDirectory)
      mappingDigest.update(row)
      mappings.push(row)
      mappingCount += 1
      if (mappingCount > 2_000) throw tooManySnapshotRows()
    }
  }
  if (mappingCount !== input.payload.mappingCount || mappingDigest.digest() !== input.payload.mappingDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen artist mapping snapshot does not match the payload')
  }
  return { workCount, mappings, inputFrozenAt: input.run.inputFrozenAt! }
}

export async function* iterateFrozenMetadataPages(
  database: ScanDatabase,
  scanRunId: string,
  pageSize: number
): AsyncGenerator<MetadataInputRow[]> {
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

export async function* iterateFrozenLocalWorkPages(
  database: ScanDatabase,
  scanRunId: string,
  pageSize: number
): AsyncGenerator<LocalWorkInputRow[]> {
  let ordinal = -1
  while (true) {
    const page = await database.scanRunLocalWorkInput.findMany({
      where: { scanRunId, ordinal: { gt: ordinal } },
      orderBy: { ordinal: 'asc' },
      take: pageSize
    })
    if (page.length === 0) return
    yield page
    ordinal = page.at(-1)!.ordinal
  }
}

async function* iterateFrozenLocalMappingPages(
  database: ScanDatabase,
  scanRunId: string,
  pageSize: number
): AsyncGenerator<LocalArtistMappingInputRow[]> {
  let ordinal = -1
  while (true) {
    const page = await database.scanRunLocalArtistMappingInput.findMany({
      where: { scanRunId, ordinal: { gt: ordinal } },
      orderBy: { ordinal: 'asc' },
      take: pageSize
    })
    if (page.length === 0) return
    yield page
    ordinal = page.at(-1)!.ordinal
  }
}

export async function freezeDiscoveredMetadataPages(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  run: ScanRunRecord
  pages: AsyncIterable<
    readonly {
      relativePath: string
      contentHash: string
      state?: Parameters<typeof inventoryStatData>[0]
    }[]
  >
  now: Date
  maxEntries: number
}): Promise<ScanRunRecord> {
  const prepared = await mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return { shouldFreeze: false, run: current }
    await transaction.scanRunMetadataInput.deleteMany({ where: { scanRunId: input.run.id } })
    await transaction.scanRun.update({
      where: { id: input.run.id },
      data: { inputCount: 0, inputDigest: null, checkpointStage: 'DISCOVERY', checkpointOrdinal: 0 }
    })
    return { shouldFreeze: true, run: current }
  })
  if (!prepared.shouldFreeze) return prepared.run
  const digest = createMetadataDigestAccumulator()
  let ordinal = 0
  for await (const page of input.pages) {
    const rows = page.map((candidate) => ({
      scanRunId: input.run.id,
      ordinal: ordinal++,
      relativePath: candidate.relativePath,
      contentHash: candidate.contentHash,
      ...(candidate.state ? inventoryStatData(candidate.state) : {})
    }))
    if (ordinal > input.maxEntries) throw tooManySnapshotRows()
    for (const row of rows) digest.update(row)
    if (rows.length > 0) {
      await mutate(input.context, (transaction) => transaction.scanRunMetadataInput.createMany({ data: rows }))
      logFrozenSnapshotPage({ logger: input.context.logger, frozen: ordinal, pageItems: rows.length })
    }
  }
  const inputDigest = digest.digest()
  return mutate(input.context, async (transaction) => {
    const current = await transaction.scanRun.findUniqueOrThrow({ where: { id: input.run.id } })
    if (current.inputFrozenAt) return current
    return transaction.scanRun.update({
      where: { id: input.run.id },
      data: {
        inputCount: ordinal,
        inputDigest,
        inputFrozenAt: input.now,
        totalArtworks: ordinal,
        checkpointStage: 'PROCESSING'
      }
    })
  })
}

export async function freezeDiscoveredMetadata(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  run: ScanRunRecord
  candidates: readonly {
    relativePath: string
    contentHash: string
    state?: Parameters<typeof inventoryStatData>[0]
  }[]
  now: Date
  maxEntries?: number
}): Promise<ScanRunRecord> {
  async function* pages() {
    yield input.candidates
  }
  return freezeDiscoveredMetadataPages({
    context: input.context,
    run: input.run,
    pages: pages(),
    now: input.now,
    maxEntries: input.maxEntries ?? input.candidates.length
  })
}

export function scanMode(payload: ScanPayload) {
  switch (payload.mode) {
    case 'FULL_RECONCILE':
      return 'FULL' as const
    case 'ARTWORK_RESCAN':
      return 'RESCAN' as const
    case 'CLIENT_LIST':
      return 'CLIENT_LIST' as const
    default:
      return 'INCREMENTAL' as const
  }
}

function assertFrozenHeader(run: ScanRunRecord, maxEntries: number) {
  if (!run.inputFrozenAt || !run.inputDigest || !SHA256_PATTERN.test(run.inputDigest)) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'ScanRun input snapshot header is incomplete')
  }
  if (!Number.isSafeInteger(run.inputCount) || run.inputCount < 0 || run.inputCount > maxEntries) {
    throw tooManySnapshotRows()
  }
}

function assertDenseOrdinal(actual: number, expected: number) {
  if (actual !== expected) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen snapshot ordinals must be dense and zero-based')
  }
}

function tooManySnapshotRows() {
  return new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen snapshot exceeds the configured row limit')
}

function mutate<TResult>(context: ScanContext, operation: (transaction: ScanTransaction) => Promise<TResult>) {
  return context.mutateInTransaction<ScanTransaction & QueueSqlExecutor, TResult>((transaction) =>
    operation(transaction)
  )
}
