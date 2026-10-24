import {
  ArtworkDedupOperationError,
  assertArtworkDedupSourceGroups,
  assertArtworkDedupSources,
  captureArtworkDedupSourceGroups,
  type Prisma
} from '@pixishelf/db'
import {
  parseArtworkDedupSourceSnapshot,
  serializeArtworkDedupSourceSnapshot,
  type ArtworkDedupSourceIdentity,
  type ArtworkDedupSourceSnapshot
} from '@pixishelf/job-contracts'
import type { ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { resolveMediaContentRoots } from '../media-content/index.ts'
import type { SafeScanRoot } from './paths.ts'
import { ScanExecutorError } from './errors.ts'
import { metadataCandidateFromPath } from './metadata.ts'

export function pixivScanSourceIdentities(input: {
  rootIdentity: string
  relativePath: string
  externalId?: string
}): ArtworkDedupSourceIdentity[] {
  const candidate = metadataCandidateFromPath({ relativePath: input.relativePath, absolutePath: input.relativePath })
  if (!input.rootIdentity || !candidate || (input.externalId && candidate.artworkId !== input.externalId)) {
    throw invalidProof()
  }
  return [
    { kind: 'PROVIDER', providerKey: 'pixiv', externalId: candidate.artworkId },
    {
      kind: 'PATH',
      logicalRoot: 'source-media:v1',
      rootIdentity: input.rootIdentity,
      canonicalPath: input.relativePath
    }
  ]
}

export function parsePixivScanSourceSnapshot(input: {
  snapshot: unknown
  relativePath: string
  rootIdentity?: string
  externalId?: string
}): ArtworkDedupSourceSnapshot {
  const snapshot = parseScanSourceSnapshot(input.snapshot)
  const path = snapshot.sources.find((source) => source.identity.kind === 'PATH')?.identity
  if (!path || path.kind !== 'PATH') throw invalidProof()
  const expected = pixivScanSourceIdentities({
    relativePath: input.relativePath,
    rootIdentity: input.rootIdentity ?? path.rootIdentity,
    ...(input.externalId ? { externalId: input.externalId } : {})
  })
  assertIdentities(snapshot, expected)
  return snapshot
}

export function parseLocalScanSourceSnapshot(input: {
  snapshot: unknown
  relativePath: string
  rootIdentity?: string
}): ArtworkDedupSourceSnapshot {
  const snapshot = parseScanSourceSnapshot(input.snapshot)
  const identity = snapshot.sources[0]?.identity
  if (identity?.kind !== 'DIRECTORY') throw invalidProof()
  assertIdentities(snapshot, [
    {
      kind: 'DIRECTORY',
      logicalRoot: 'source-media:v1',
      rootIdentity: input.rootIdentity ?? identity.rootIdentity,
      canonicalPath: input.relativePath
    }
  ])
  return snapshot
}

export function scanSourceProofs(snapshot: ArtworkDedupSourceSnapshot) {
  return snapshot.sources.map((source) => ({ ...source, generation: BigInt(source.generation) }))
}

export async function assertPixivScanSources(
  transaction: Prisma.TransactionClient,
  input: Parameters<typeof parsePixivScanSourceSnapshot>[0]
) {
  const snapshot = parsePixivScanSourceSnapshot(input)
  try {
    await assertArtworkDedupSources(transaction, { sources: scanSourceProofs(snapshot) })
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError)
      {throw new ScanSourceProofError(
        'STATE_CONFLICT',
        `Frozen source proof was rejected (${error.code}); keep this input and create a new intent after review`
      )}
    throw error
  }
  return snapshot
}

export async function assertLocalScanSources(
  transaction: Prisma.TransactionClient,
  input: Parameters<typeof parseLocalScanSourceSnapshot>[0]
) {
  const snapshot = parseLocalScanSourceSnapshot(input)
  try {
    await assertArtworkDedupSources(transaction, { sources: scanSourceProofs(snapshot) })
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError)
      {throw new ScanSourceProofError(
        'STATE_CONFLICT',
        `Frozen source proof was rejected (${error.code}); keep this input and create a new intent after review`
      )}
    throw error
  }
  return snapshot
}

/** New discoveries capture before metadata reads; resumed rows retain their original proof. */
export async function preparePixivDiscoverySources(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'>
  runId: string
  rootIdentity: string
  relativePaths: readonly string[]
}): Promise<Map<string, ArtworkDedupSourceSnapshot>> {
  const existing = await input.context.mutateInTransaction<
    Prisma.TransactionClient & QueueSqlExecutor,
    Array<{ relativePath: string; dedupSourceSnapshot: Prisma.JsonValue }>
  >((transaction) =>
    transaction.scanRunMetadataInput.findMany({
      where: { scanRunId: input.runId, relativePath: { in: [...input.relativePaths] } },
      select: { relativePath: true, dedupSourceSnapshot: true }
    })
  )
  const snapshots = new Map(
    existing.map((row) => [
      row.relativePath,
      parsePixivScanSourceSnapshot({
        snapshot: row.dedupSourceSnapshot,
        relativePath: row.relativePath,
        rootIdentity: input.rootIdentity
      })
    ])
  )
  const fresh = input.relativePaths.filter((relativePath) => !snapshots.has(relativePath))
  if (fresh.length) {
    const groups = await input.context.mutateInTransaction<
      Prisma.TransactionClient & QueueSqlExecutor,
      Awaited<ReturnType<typeof captureArtworkDedupSourceGroups>>
    >((transaction) =>
      captureArtworkDedupSourceGroups(transaction, {
        groups: fresh.map((relativePath) =>
          pixivScanSourceIdentities({ rootIdentity: input.rootIdentity, relativePath })
        )
      })
    )
    fresh.forEach((relativePath, index) =>
      snapshots.set(relativePath, serializeArtworkDedupSourceSnapshot(groups[index]!))
    )
  }
  return snapshots
}

/** Freeze is atomic per existing page; a surviving input can never acquire a newer proof. */
export async function freezePixivDiscoveryRows(
  transaction: Prisma.TransactionClient,
  rows: readonly Prisma.ScanRunMetadataInputCreateManyInput[],
  snapshots: ReadonlyMap<string, ArtworkDedupSourceSnapshot>
) {
  if (!rows.length) return
  const proofs = rows.map(
    (row) =>
      snapshots.get(row.relativePath) ??
      (() => {
        throw invalidProof()
      })()
  )
  await assertArtworkDedupSourceGroups(transaction, { groups: proofs.map(scanSourceProofs) })
  const existing = await transaction.scanRunMetadataInput.findMany({
    where: { scanRunId: rows[0]!.scanRunId, relativePath: { in: rows.map((row) => row.relativePath) } }
  })
  const byPath = new Map(existing.map((row) => [row.relativePath, row]))
  for (const [index, row] of rows.entries()) {
    const previous = byPath.get(row.relativePath)
    if (
      previous &&
      (previous.ordinal !== row.ordinal ||
        previous.contentHash !== row.contentHash ||
        (['sizeBytes', 'mtimeMs', 'ctimeMs', 'deviceId', 'inode'] as const).some(
          (key) => row[key] !== undefined && previous[key] !== row[key]
        ) ||
        JSON.stringify(
          parsePixivScanSourceSnapshot({ snapshot: previous.dedupSourceSnapshot, relativePath: row.relativePath })
        ) !== JSON.stringify(proofs[index]))
    )
      {throw invalidProof()}
  }
  const fresh = rows.flatMap((row, index) =>
    byPath.has(row.relativePath) ? [] : [{ ...row, dedupSourceSnapshot: proofs[index]! }]
  )
  if (fresh.length) await transaction.scanRunMetadataInput.createMany({ data: fresh })
}

function parseScanSourceSnapshot(value: unknown) {
  try {
    return parseArtworkDedupSourceSnapshot(value)
  } catch {
    throw invalidProof()
  }
}
function assertIdentities(snapshot: ArtworkDedupSourceSnapshot, expected: ArtworkDedupSourceIdentity[]) {
  if (
    snapshot.sources.length !== expected.length ||
    expected.some(
      (identity) => !snapshot.sources.some((source) => JSON.stringify(source.identity) === JSON.stringify(identity))
    )
  )
    {throw invalidProof()}
}
function invalidProof() {
  return new ScanSourceProofError(
    'INPUT_SNAPSHOT_INVALID',
    'Frozen input has no matching durable deduplication source proof; create a new scan intent'
  )
}

export async function resolveScanDedupRootIdentity(root: SafeScanRoot) {
  const roots = await resolveMediaContentRoots({
    sourceRoot: root.absolutePath,
    archiveRoot: root.absolutePath,
    expectedPixivRootIdentity: root.rootIdentity ?? null
  })
  return roots.source.rootIdentity
}

export class ScanSourceProofError extends ScanExecutorError {}
export function isScanSourceProofRejection(error: unknown) {
  return error instanceof ScanSourceProofError || error instanceof ArtworkDedupOperationError
}
