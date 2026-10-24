import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import type { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { ScanExecutorError } from '../scan/errors.ts'
import type { ExecutorMediaWrite } from '../scan/media-content-write.ts'
import { resolveCreatablePathWithinRoot } from './storage.ts'

const checkpointType = 'archive.cleanup.checkpoint'
const identitySchema = z.object({ dev: z.string(), ino: z.string(), birthtimeNs: z.string() }).strict()
const checkpointSchema = z
  .object({
    version: z.literal(1),
    archiveImportId: z.string(),
    intentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    root: z.string(),
    rootIdentity: identitySchema,
    paths: z
      .array(z.object({ path: z.string(), identity: identitySchema.nullable() }).strict())
      .min(1)
      .max(100),
    declarations: z
      .array(z.object({ id: z.string(), writeToken: z.string(), directoryId: z.string() }).strict())
      .min(1)
      .max(100)
  })
  .strict()
type CleanupCheckpoint = z.infer<typeof checkpointSchema>

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return { bigint: item.toString() }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return item
  })
}
function hash(value: unknown) {
  const bytes = encode(value)
  if (Buffer.byteLength(bytes) > 1_048_576) throw changed()
  return createHash('sha256').update(bytes).digest('hex')
}
function changed() {
  return new ScanExecutorError('STATE_CONFLICT', 'Original staging cleanup checkpoint is missing or changed')
}

/** Bounded pages cover every generation and every item that the finalizer resets. */
export async function stagingCleanupIntentDigest(tx: Prisma.TransactionClient, archiveImportId: string) {
  const archive = await tx.archiveImport.findUnique({
    where: { id: archiveImportId },
    select: {
      id: true,
      systemJobId: true,
      phase: true,
      status: true,
      providerKey: true,
      externalId: true,
      creatorBucket: true,
      stagingPath: true,
      generationToken: true,
      sealedManifestSha256: true,
      cleanupRequestedAt: true,
      dedupSourceSnapshot: true,
      completedItems: true,
      failedItems: true,
      retainUntil: true,
      publishedRevision: { select: { id: true } },
      systemJob: { select: { id: true, status: true } }
    }
  })
  if (
    !archive?.cleanupRequestedAt ||
    archive.publishedRevision ||
    !['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(archive.status) ||
    ['RUNNING', 'PAUSING', 'CANCELLING'].includes(archive.systemJob.status)
  ) {
    throw changed()
  }
  // This is an identity observation, never captureArtworkDedupSources or new OPEN authorization.
  const sources = await tx.artworkDedupSourceIdentity.findMany({
    where: { kind: 'PROVIDER', providerKey: archive.providerKey, externalId: archive.externalId },
    select: { id: true, generation: true, status: true, ownerOperationId: true },
    orderBy: { id: 'asc' },
    take: 2
  })
  if (sources.length > 1 || sources.some((source) => source.status !== 'OPEN')) throw changed()
  const digest = createHash('sha256').update('archive-cleanup-intent:v1\n').update(hash({ archive, sources }))
  let cursor: string | undefined,
    generationCount = 0
  while (true) {
    const page = await tx.archiveStagingGeneration.findMany({
      where: { archiveImportId, ...(cursor ? { token: { gt: cursor } } : {}) },
      orderBy: { token: 'asc' },
      take: 100
    })
    for (const row of page) {
      if (!row.drainedAt) throw changed()
      digest.update(hash(row))
      generationCount++
    }
    if (page.length < 100) break
    cursor = page.at(-1)!.token
  }
  if (!generationCount) throw changed()
  digest.update(`items:${generationCount}\n`)
  cursor = undefined
  while (true) {
    const page: Prisma.ArchiveImportItemGetPayload<object>[] = await tx.archiveImportItem.findMany({
      where: { archiveImportId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 100
    })
    for (const row of page) digest.update(hash(row))
    if (page.length < 100) break
    cursor = page.at(-1)!.id
  }
  return digest.digest('hex')
}

async function directoryIdentity(target: string) {
  try {
    const stat = await lstat(target, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw changed()
    return { dev: stat.dev.toString(), ino: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function findStagingCleanupCheckpoint(tx: Prisma.TransactionClient, jobId: string) {
  const rows = await tx.systemJobEvent.findMany({
    where: { jobId, type: checkpointType },
    orderBy: { id: 'asc' },
    take: 2
  })
  if (!rows.length) return null
  const parsed = checkpointSchema.safeParse(rows[0]!.data)
  if (rows.length !== 1 || rows[0]!.attempt < 1 || !parsed.success) throw changed()
  return parsed.data
}

/** Created atomically with the first declarations, never rewritten on retry or grant. */
export async function createStagingCleanupCheckpoint(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string
    attempt: number
    archiveImportId: string
    intentSha256: string
    root: string
    paths: string[]
    write: ExecutorMediaWrite
  }
) {
  if (await findStagingCleanupCheckpoint(tx, input.jobId)) throw changed()
  if ((await stagingCleanupIntentDigest(tx, input.archiveImportId)) !== input.intentSha256) throw changed()
  const root = await realpath(input.root),
    rootIdentity = await directoryIdentity(root)
  if (!rootIdentity) throw changed()
  const paths = []
  for (const relativePath of [...input.paths].sort()) {
    const target = await resolveCreatablePathWithinRoot(root, relativePath)
    paths.push({ path: relativePath, identity: await directoryIdentity(target) })
  }
  const checkpoint = checkpointSchema.parse({
    version: 1,
    archiveImportId: input.archiveImportId,
    intentSha256: input.intentSha256,
    root,
    rootIdentity,
    paths,
    declarations: input.write.handles
      .map((handle) => ({ id: handle.writeId, writeToken: handle.writeToken, directoryId: handle.directoryId }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  })
  await tx.systemJobEvent.create({
    data: { jobId: input.jobId, type: checkpointType, attempt: input.attempt, data: checkpoint }
  })
  return checkpoint
}

export async function assertStagingCleanupPaths(checkpoint: CleanupCheckpoint) {
  if (hash(await directoryIdentity(checkpoint.root)) !== hash(checkpoint.rootIdentity)) throw changed()
  for (const entry of checkpoint.paths) {
    const target = await resolveCreatablePathWithinRoot(checkpoint.root, entry.path)
    const current = await directoryIdentity(target)
    // Missing is an idempotent delete receipt; a newly occupied or replaced path is never ours.
    if (current && hash(current) !== hash(entry.identity)) throw changed()
  }
}

export async function readStagingCleanupRecoverySnapshot(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string
    archiveImportId: string
  }
): Promise<Prisma.JsonValue> {
  const checkpoint = await findStagingCleanupCheckpoint(tx, input.jobId)
  if (
    !checkpoint ||
    checkpoint.archiveImportId !== input.archiveImportId ||
    (await stagingCleanupIntentDigest(tx, input.archiveImportId)) !== checkpoint.intentSha256
  ) {
    throw changed()
  }
  const declarations = await tx.mediaContentPathWrite.findMany({
    where: { jobId: input.jobId, status: { in: ['ACTIVE', 'RECOVERY_REQUIRED'] } },
    select: { id: true, writeToken: true, directoryId: true },
    orderBy: { id: 'asc' },
    take: 101
  })
  if (hash(declarations) !== hash(checkpoint.declarations)) throw changed()
  await assertStagingCleanupPaths(checkpoint)
  return checkpoint
}
