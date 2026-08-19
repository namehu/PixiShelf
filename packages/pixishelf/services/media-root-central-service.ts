import 'server-only'

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  artistMappingInputDigest,
  computeLocalWorkContentFingerprint,
  localWorkInputDigest,
  metadataInputDigest
} from '@pixishelf/job-executors'
import { migrationPayloadSchema, type MigrationPayload, type ScanPayload } from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { startLocalImportSchema, type StartLocalImportInput } from '@/schemas/local-import.dto'
import { getScanPath, getSystemSettings } from '@/services/setting.service'
import {
  buildMigrationSelection,
  type MigrationPrecheckInput,
  type MigrationSafetyOptions
} from '@/services/migration-service'
import {
  enqueueSingletonManualJobWithResult,
  enqueueSingletonSystemJobWithResult,
  type EnqueueSingletonManualJobOptions
} from '@/services/background-task/manual-job-singleton'
import { isLocalDirectoryArtworkSource } from '@/utils/artwork/artwork-source'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { FULL_SCAN_RETIRED_MESSAGE, isRetiredDirectoryFullScan } from '@/services/scan-source-policy'

const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_LOCAL_IMPORT_CANDIDATES = 10_000
const MAX_LOCAL_IMPORT_ARTISTS = 2_000
const SHA256 = /^[a-f0-9]{64}$/

export interface QueuedMediaRootJob {
  jobId: string
  scanRunId?: string
  status: 'PENDING'
  reused: boolean
}

export async function enqueueCentralScan(
  input: {
    type: 'all' | 'list'
    force: boolean
    metadataList?: string[]
  } & ({ triggerSource?: 'MANUAL'; requestedByUserId: string } | { triggerSource: 'SYSTEM'; requestedByUserId?: never })
): Promise<QueuedMediaRootJob> {
  if (isRetiredDirectoryFullScan(input)) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', FULL_SCAN_RETIRED_MESSAGE)
  }
  const scanPath = await requireScanPath()
  const now = new Date()
  let payload: ScanPayload
  let metadataRows: Array<{ ordinal: number; relativePath: string; contentHash: string }> = []
  if (input.type === 'list') {
    metadataRows = await freezeMetadataInputs(scanPath, input.metadataList ?? [])
    const digest = metadataInputDigest(metadataRows)
    payload = {
      mode: 'CLIENT_LIST',
      existingPolicy: input.force ? 'REFRESH' : 'SKIP',
      inputCount: metadataRows.length,
      inputDigest: digest
    }
  } else {
    payload = { mode: 'INCREMENTAL' }
  }
  let scanRunId = ''
  const options: EnqueueSingletonManualJobOptions = {
    afterEnqueue: async ({ transaction, job, reused }) => {
      const existing = await transaction.scanRun.findUnique({ where: { systemJobId: job.id } })
      if (existing) {
        scanRunId = await validateReusedScanRun({
          transaction,
          existing,
          expectedType: 'PIXIV',
          expectedMode: payload.mode === 'CLIENT_LIST' ? 'CLIENT_LIST' : 'INCREMENTAL',
          expectedInputDigest: payload.mode === 'CLIENT_LIST' ? payload.inputDigest : null,
          expectedInputCount: payload.mode === 'CLIENT_LIST' ? payload.inputCount : 0,
          expectFrozen: payload.mode === 'CLIENT_LIST',
          metadataRows,
          localWorkRows: [],
          mappingRows: []
        })
        return
      }
      if (reused) throw activeSnapshotConflict('Reused scan job has no ScanRun')
      const run = await transaction.scanRun.create({
        data: {
          systemJobId: job.id,
          type: 'PIXIV',
          mode: payload.mode === 'CLIENT_LIST' ? 'CLIENT_LIST' : 'INCREMENTAL',
          status: 'PENDING',
          checkpointStage: 'QUEUED',
          checkpointOrdinal: 0,
          ...(payload.mode === 'CLIENT_LIST'
            ? {
                inputCount: payload.inputCount,
                inputDigest: payload.inputDigest,
                inputFrozenAt: now,
                totalArtworks: payload.inputCount
              }
            : {})
        }
      })
      scanRunId = run.id
      if (metadataRows.length > 0) {
        await transaction.scanRunMetadataInput.createMany({
          data: metadataRows.map((row) => ({ ...row, scanRunId: run.id }))
        })
      }
    }
  }
  const jobRequest = {
    type: 'SCAN',
    payload,
    maxAttempts: 3
  } as const
  const queued =
    input.triggerSource === 'SYSTEM'
      ? await enqueueSingletonSystemJobWithResult(
          { ...jobRequest, triggerSource: 'SYSTEM', priority: input.force ? 120 : 110 },
          options
        )
      : await enqueueSingletonManualJobWithResult(
          {
            ...jobRequest,
            triggerSource: 'MANUAL',
            priority: input.force ? 20 : 10,
            requestedByUserId: input.requestedByUserId
          },
          options
        )
  return { jobId: queued.job.id, scanRunId, status: 'PENDING', reused: queued.reused }
}

export async function enqueueCentralArtworkRescan(input: {
  artworkId: number
  requestedByUserId: string
}): Promise<QueuedMediaRootJob> {
  const scanPath = await requireScanPath()
  const artwork = await prisma.artwork.findUnique({
    where: { id: input.artworkId },
    select: {
      id: true,
      source: true,
      storagePath: true,
      metaSource: true,
      externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
    }
  })
  if (!artwork) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Artwork not found')
  const local = isLocalDirectoryArtworkSource(artwork.source)
  let localRow: { ordinal: number; kind: 'MEDIA_DIRECTORY'; relativePath: string; fingerprint: string } | null = null
  let metadataRows: Array<{ ordinal: number; relativePath: string; contentHash: string }> = []
  if (local) {
    if (!artwork.storagePath) throw precondition('Local artwork has no storage path')
    localRow = {
      ordinal: 0,
      kind: 'MEDIA_DIRECTORY',
      relativePath: artwork.storagePath,
      fingerprint: await computeLocalWorkContentFingerprint({
        scanRoot: scanPath,
        relativeDirectory: artwork.storagePath,
        kind: 'MEDIA_DIRECTORY',
        maxEntries: 100_000,
        maxFiles: 2_000,
        maxFileBytes: 4 * 1024 * 1024 * 1024,
        signal: AbortSignal.timeout(120_000)
      })
    }
  } else {
    if (!artwork.metaSource || artwork.externalRefs.length !== 1) {
      throw precondition('Artwork has no unambiguous Pixiv metadata source')
    }
    metadataRows = await freezeMetadataInputs(scanPath, [artwork.metaSource])
    const frozenIdentity = metadataIdentity(metadataRows[0]?.relativePath)
    if (metadataRows.length !== 1 || frozenIdentity !== artwork.externalRefs[0]!.externalId) {
      throw precondition('Artwork metadata source identity does not match its Pixiv reference')
    }
  }
  const frozenAt = new Date()
  const localDigest = localRow ? localWorkInputDigest([localRow]) : null
  const metadataDigest = metadataRows.length > 0 ? metadataInputDigest(metadataRows) : null
  let scanRunId = ''
  const queued = await enqueueSingletonManualJobWithResult(
    {
      type: 'SCAN',
      triggerSource: 'MANUAL',
      payload: { mode: 'ARTWORK_RESCAN', artworkId: artwork.id },
      priority: 30,
      maxAttempts: 3,
      requestedByUserId: input.requestedByUserId
    },
    {
      afterEnqueue: async ({ transaction, job, reused }) => {
        const existing = await transaction.scanRun.findUnique({ where: { systemJobId: job.id } })
        if (existing) {
          scanRunId = await validateReusedScanRun({
            transaction,
            existing,
            expectedType: local ? 'LOCAL_IMPORT' : 'PIXIV',
            expectedMode: local ? 'LOCAL_RESCAN' : 'RESCAN',
            expectedInputDigest: localDigest ?? metadataDigest,
            expectedInputCount: 1,
            expectFrozen: true,
            metadataRows,
            localWorkRows: localRow ? [localRow] : [],
            mappingRows: []
          })
          return
        }
        if (reused) throw activeSnapshotConflict('Reused artwork rescan job has no ScanRun')
        const currentArtwork = await transaction.artwork.findUnique({
          where: { id: artwork.id },
          select: {
            source: true,
            storagePath: true,
            metaSource: true,
            externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
          }
        })
        if (
          !currentArtwork ||
          currentArtwork.source !== artwork.source ||
          currentArtwork.storagePath !== artwork.storagePath ||
          currentArtwork.metaSource !== artwork.metaSource ||
          currentArtwork.externalRefs.length !== artwork.externalRefs.length ||
          currentArtwork.externalRefs[0]?.externalId !== artwork.externalRefs[0]?.externalId
        ) {
          throw new BackgroundTaskError(
            'CONCURRENT_MODIFICATION',
            'Artwork source changed while the rescan snapshot was being frozen'
          )
        }
        const run = await transaction.scanRun.create({
          data: {
            systemJobId: job.id,
            type: local ? 'LOCAL_IMPORT' : 'PIXIV',
            mode: local ? 'LOCAL_RESCAN' : 'RESCAN',
            status: 'PENDING',
            checkpointStage: 'QUEUED',
            checkpointOrdinal: 0,
            inputCount: 1,
            inputDigest: localDigest ?? metadataDigest,
            inputFrozenAt: frozenAt,
            totalArtworks: 1
          }
        })
        scanRunId = run.id
        if (localRow) {
          await transaction.scanRunLocalWorkInput.create({ data: { ...localRow, scanRunId: run.id } })
        }
        if (metadataRows.length > 0) {
          await transaction.scanRunMetadataInput.createMany({
            data: metadataRows.map((row) => ({ ...row, scanRunId: run.id }))
          })
        }
      }
    }
  )
  return { jobId: queued.job.id, scanRunId, status: 'PENDING', reused: queued.reused }
}

export async function enqueueCentralLocalDirectoryImport(
  input: StartLocalImportInput & { requestedByUserId: string }
): Promise<QueuedMediaRootJob> {
  const { storagePaths } = startLocalImportSchema.parse({ storagePaths: input.storagePaths })
  const settings = await getSystemSettings()
  const existingRows = await prisma.artwork.findMany({
    where: { storagePath: { in: storagePaths } },
    select: { storagePath: true },
    take: MAX_LOCAL_IMPORT_CANDIDATES + 1
  })
  if (existingRows.length > MAX_LOCAL_IMPORT_CANDIDATES) {
    throw precondition('Local import existing artwork query exceeds the configured limit')
  }
  const existingPaths = new Set(existingRows.flatMap((row) => (row.storagePath ? [row.storagePath] : [])))
  const candidatePaths = storagePaths.filter((storagePath) => !existingPaths.has(storagePath)).sort(compareText)
  if (candidatePaths.length === 0) throw precondition('No new local import works remain')
  const artistDirectories = [...new Set(candidatePaths.map(localImportArtistDirectory))].sort(compareText)
  if (artistDirectories.length > MAX_LOCAL_IMPORT_ARTISTS) {
    throw precondition('Local import artist count exceeds the configured limit')
  }
  const storedMappings = await prisma.localImportArtistMapping.findMany({
    where: { artistDirectory: { in: artistDirectories } },
    select: { artistDirectory: true, artistId: true },
    take: MAX_LOCAL_IMPORT_ARTISTS + 1
  })
  if (storedMappings.length > MAX_LOCAL_IMPORT_ARTISTS) {
    throw precondition('Local import artist mapping query exceeds the configured limit')
  }
  const mappingMap = new Map(storedMappings.map((mapping) => [mapping.artistDirectory, mapping.artistId]))
  const missing = artistDirectories.find((artistDirectory) => !mappingMap.has(artistDirectory))
  if (missing) throw precondition(`Local import artist mapping is missing: ${missing}`)
  const workRows = candidatePaths.map((relativePath, ordinal) => ({
    ordinal,
    kind: 'MEDIA_DIRECTORY' as const,
    relativePath,
    fingerprint: null
  }))
  const mappingRows = [...mappingMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([artistDirectory, artistId], ordinal) => ({ ordinal, artistDirectory, artistId }))
  const workDigest = localWorkInputDigest(workRows)
  const mappingDigest = artistMappingInputDigest(mappingRows)
  const defaultTagIds = [...new Set(settings.local_import_default_tag_ids)].sort((left, right) => left - right)
  const frozenAt = new Date()
  let scanRunId = ''
  const queued = await enqueueSingletonManualJobWithResult(
    {
      type: 'LOCAL_DIRECTORY_IMPORT',
      triggerSource: 'MANUAL',
      payload: { defaultTagIds, mappingCount: mappingRows.length, mappingDigest },
      priority: 15,
      maxAttempts: 3,
      requestedByUserId: input.requestedByUserId
    },
    {
      afterEnqueue: async ({ transaction, job, reused }) => {
        const existing = await transaction.scanRun.findUnique({ where: { systemJobId: job.id } })
        if (existing) {
          scanRunId = await validateReusedScanRun({
            transaction,
            existing,
            expectedType: 'LOCAL_IMPORT',
            expectedMode: 'LOCAL_DIRECTORY_IMPORT',
            expectedInputDigest: workDigest,
            expectedInputCount: workRows.length,
            expectFrozen: true,
            metadataRows: [],
            localWorkRows: workRows,
            mappingRows
          })
          return
        }
        if (reused) throw activeSnapshotConflict('Reused local import job has no ScanRun')
        const run = await transaction.scanRun.create({
          data: {
            systemJobId: job.id,
            type: 'LOCAL_IMPORT',
            mode: 'LOCAL_DIRECTORY_IMPORT',
            status: 'PENDING',
            checkpointStage: 'QUEUED',
            checkpointOrdinal: 0,
            inputCount: workRows.length,
            inputDigest: workDigest,
            inputFrozenAt: frozenAt,
            totalArtworks: workRows.length
          }
        })
        scanRunId = run.id
        if (workRows.length) {
          await transaction.scanRunLocalWorkInput.createMany({
            data: workRows.map((row) => ({ ...row, scanRunId: run.id }))
          })
        }
        if (mappingRows.length) {
          await transaction.scanRunLocalArtistMappingInput.createMany({
            data: mappingRows.map((row) => ({ ...row, scanRunId: run.id }))
          })
        }
      }
    }
  )
  return { jobId: queued.job.id, scanRunId, status: 'PENDING', reused: queued.reused }
}

export async function enqueueCentralMigration(input: {
  requestedByUserId: string
  selectionInput: MigrationPrecheckInput
  safety?: MigrationSafetyOptions
}): Promise<QueuedMediaRootJob> {
  const selection = await buildMigrationSelection(input.selectionInput)
  const payload: MigrationPayload = migrationPayloadSchema.parse({ selection, safety: input.safety })
  const queued = await enqueueSingletonManualJobWithResult({
    type: 'MIGRATION',
    triggerSource: 'MANUAL',
    payload,
    priority: 10,
    maxAttempts: 3,
    requestedByUserId: input.requestedByUserId
  })
  return { jobId: queued.job.id, status: 'PENDING', reused: queued.reused }
}

async function requireScanPath() {
  const value = await getScanPath()
  if (!value) throw precondition('Scan path is not configured')
  return value
}

async function freezeMetadataInputs(scanPath: string, inputs: string[]) {
  if (inputs.length < 1 || inputs.length > 10_000) throw precondition('Metadata list must contain 1 to 10000 files')
  let root: string
  try {
    root = await fs.realpath(scanPath)
  } catch {
    throw precondition('Scan path cannot be resolved')
  }
  const rows = [] as Array<{ ordinal: number; relativePath: string; contentHash: string }>
  const identities = new Set<string>()
  const selected = new Map<string, { relativePath: string; contentHash: string; preference: number }>()
  for (const raw of inputs) {
    const relativePath = canonicalRelativePath(raw)
    const match = path.posix.basename(relativePath).match(/^(\d+)(?:_p\d+)?-meta\.(json|txt)$/i)
    if (!match?.[1] || !match[2]) throw precondition(`Invalid metadata path: ${raw}`)
    const absolute = path.resolve(root, relativePath)
    assertWithinRoot(root, absolute)
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stat = await fs.lstat(absolute)
    } catch {
      throw precondition(`Metadata path cannot be read: ${raw}`)
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_METADATA_BYTES) {
      throw precondition(`Unsafe metadata path: ${raw}`)
    }
    let real: string
    try {
      real = await fs.realpath(absolute)
    } catch {
      throw precondition(`Metadata path cannot be resolved: ${raw}`)
    }
    assertWithinRoot(root, real)
    let bytes: Buffer
    try {
      bytes = await fs.readFile(real)
    } catch {
      throw precondition(`Metadata path cannot be read: ${raw}`)
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    if (!SHA256.test(contentHash)) throw precondition('Metadata hash failed')
    const preference = match[2].toLowerCase() === 'json' ? 0 : 1
    const current = selected.get(match[1])
    if (
      !current ||
      preference < current.preference ||
      (preference === current.preference && relativePath < current.relativePath)
    ) {
      selected.set(match[1], { relativePath, contentHash, preference })
    }
  }
  for (const [identity, item] of [...selected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (identities.has(identity)) throw precondition(`Duplicate metadata identity: ${identity}`)
    identities.add(identity)
    rows.push({ ordinal: rows.length, relativePath: item.relativePath, contentHash: item.contentHash })
  }
  return rows
}

function canonicalRelativePath(value: string) {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw precondition('Path must be relative')
  }
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..')) throw precondition('Path escapes scan root')
  return segments.join('/')
}

function assertWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw precondition('Path escapes scan root')
}

function metadataIdentity(relativePath: string | undefined) {
  if (!relativePath) return null
  return path.posix.basename(relativePath).match(/^(\d+)(?:_p\d+)?-meta\.(?:json|txt)$/i)?.[1] ?? null
}

interface ExpectedMetadataRow {
  ordinal: number
  relativePath: string
  contentHash: string
}

interface ExpectedLocalWorkRow {
  ordinal: number
  kind: 'MEDIA_DIRECTORY'
  relativePath: string
  fingerprint: string | null
}

interface ExpectedMappingRow {
  ordinal: number
  artistDirectory: string
  artistId: number
}

async function validateReusedScanRun(input: {
  transaction: Prisma.TransactionClient
  existing: {
    id: string
    type: string
    mode: string
    inputDigest: string | null
    inputCount: number
    inputFrozenAt: Date | null
  }
  expectedType: 'PIXIV' | 'LOCAL_IMPORT'
  expectedMode: 'FULL' | 'INCREMENTAL' | 'CLIENT_LIST' | 'RESCAN' | 'LOCAL_RESCAN' | 'LOCAL_DIRECTORY_IMPORT'
  expectedInputDigest: string | null
  expectedInputCount: number
  expectFrozen: boolean
  metadataRows: readonly ExpectedMetadataRow[]
  localWorkRows: readonly ExpectedLocalWorkRow[]
  mappingRows: readonly ExpectedMappingRow[]
}) {
  const run = input.existing
  if (
    run.type !== input.expectedType ||
    run.mode !== input.expectedMode ||
    run.inputDigest !== input.expectedInputDigest ||
    run.inputCount !== input.expectedInputCount ||
    (input.expectFrozen ? !(run.inputFrozenAt instanceof Date) : run.inputFrozenAt !== null)
  ) {
    throw activeSnapshotConflict('Active job ScanRun header does not match the requested frozen input')
  }
  const [metadataRows, localWorkRows, mappingRows] = await Promise.all([
    input.transaction.scanRunMetadataInput.findMany({
      where: { scanRunId: run.id },
      orderBy: { ordinal: 'asc' },
      take: input.metadataRows.length + 1
    }),
    input.transaction.scanRunLocalWorkInput.findMany({
      where: { scanRunId: run.id },
      orderBy: { ordinal: 'asc' },
      take: input.localWorkRows.length + 1
    }),
    input.transaction.scanRunLocalArtistMappingInput.findMany({
      where: { scanRunId: run.id },
      orderBy: { ordinal: 'asc' },
      take: input.mappingRows.length + 1
    })
  ])
  if (
    !sameRows(metadataRows, input.metadataRows, ['ordinal', 'relativePath', 'contentHash']) ||
    !sameRows(localWorkRows, input.localWorkRows, ['ordinal', 'kind', 'relativePath', 'fingerprint']) ||
    !sameRows(mappingRows, input.mappingRows, ['ordinal', 'artistDirectory', 'artistId'])
  ) {
    throw activeSnapshotConflict('Active job frozen input rows do not match the requested snapshot')
  }
  if (
    metadataInputDigest(metadataRows) !== metadataInputDigest(input.metadataRows) ||
    localWorkInputDigest(localWorkRows) !== localWorkInputDigest(input.localWorkRows) ||
    artistMappingInputDigest(mappingRows) !== artistMappingInputDigest(input.mappingRows)
  ) {
    throw activeSnapshotConflict('Active job frozen input digest is invalid')
  }
  return run.id
}

function sameRows<TActual extends { ordinal: number }, TExpected extends { ordinal: number }>(
  actual: readonly TActual[],
  expected: readonly TExpected[],
  keys: readonly string[]
) {
  return (
    actual.length === expected.length &&
    actual.every(
      (row, index) =>
        row.ordinal === index &&
        keys.every((key) =>
          Object.is(
            (row as unknown as Record<string, unknown>)[key],
            (expected[index] as unknown as Record<string, unknown> | undefined)?.[key]
          )
        )
    )
  )
}

function activeSnapshotConflict(message: string) {
  return new BackgroundTaskError('ACTIVE_JOB_CONFLICT', message)
}

function precondition(message: string) {
  return new BackgroundTaskError('PRECONDITION_FAILED', message)
}

function localImportArtistDirectory(storagePath: string) {
  return storagePath.split('/')[1]!
}

function compareText(left: string, right: string) {
  return left.localeCompare(right)
}
