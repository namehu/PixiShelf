import {
  assertArtworkDedupOperationExecution,
  readArtworkDedupInventoryPage,
  readArtworkDedupArchiveManifestEvidence,
  ArtworkDedupOperationError,
  updateArtworkDedupOperationCheckpoint,
  saveArtworkDedupOperationFilesPage,
  updateArtworkDedupOperationArtwork,
  validateArtworkDedupOperationSnapshot,
  type ArtworkDedupOperationExecution,
  type ArtworkDedupOperationFileInput,
  type Prisma
} from '@pixishelf/db'
import path from 'node:path'
import { chunks, mapBounded, throwIfAborted } from '../scan/bounded.ts'
import { canonicalMediaContentPath, MediaContentFileError } from '../media-content/roots.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { MaintenanceFileError, type MaintenanceInspection } from './maintenance-files.ts'
import { MaintenanceSourceError } from './maintenance-source.ts'
import type { ControlledDedupReader } from './reader.ts'
import type { DedupRoots } from './reader-protocol.ts'
import {
  readMaintenanceDirectoryCheckpoint,
  encodeMaintenanceDirectoryState,
  decodeMaintenanceDirectoryState
} from './maintenance-directory-checkpoint.ts'

type ArtworkDedupOperationArtwork = Prisma.ArtworkDedupOperationArtworkGetPayload<Record<string, never>>
type Inventory = Awaited<ReturnType<typeof readArtworkDedupInventoryPage>>
export class DedupPrepareError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'DedupPrepareError'
  }
}
export interface DedupPrepareContext {
  execution: ArtworkDedupOperationExecution
  transaction: <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
  roots: DedupRoots
  reader: ControlledDedupReader
  signal: AbortSignal
  shouldYield: () => boolean
}
function target(context: DedupPrepareContext, storedPath: string, archive: boolean) {
  const root = archive ? context.roots.archive : context.roots.source
  const stored = canonicalMediaContentPath(storedPath.replace(/^\/+/, ''))
  return {
    root,
    relativePath:
      archive && context.roots.archiveRelativePrefix ? `${context.roots.archiveRelativePrefix}/${stored}` : stored,
    signal: context.signal
  }
}
async function current(context: DedupPrepareContext, tx: Prisma.TransactionClient, artworkId: number) {
  await assertArtworkDedupOperationExecution(tx, context.execution)
  if (!(await validateArtworkDedupOperationSnapshot(tx, context.execution.operationId, artworkId)))
    throw new DedupPrepareError('SNAPSHOT_CHANGED')
}
function baseEntry(
  item: ArtworkDedupOperationArtwork,
  referenceKey: string,
  role: string,
  resolved: ReturnType<typeof target>
): ArtworkDedupOperationFileInput {
  return {
    artworkId: item.artworkId,
    referenceKey,
    role,
    logicalRoot: resolved.root.logicalRoot,
    rootIdentity: resolved.root.rootIdentity,
    canonicalPath: resolved.relativePath,
    relativeDirectory:
      path.posix.dirname(resolved.relativePath) === '.' ? '' : path.posix.dirname(resolved.relativePath),
    ownershipStatus: 'UNCONFIRMED',
    inspectionStatus: 'PENDING',
    status: 'PENDING'
  }
}
function inspected(entry: ArtworkDedupOperationFileInput, result: MaintenanceInspection) {
  return {
    ...entry,
    ...result.state,
    fileType: result.kind,
    inspectionStatus: 'VERIFIED',
    status: 'VERIFIED',
    blockReason: null
  }
}
function blocked(entry: ArtworkDedupOperationFileInput, reason: string): ArtworkDedupOperationFileInput {
  return { ...entry, status: 'BLOCKED', inspectionStatus: 'BLOCKED', blockReason: reason }
}
function localError(error: unknown): string {
  if (error instanceof ArtworkDedupOperationError && error.code === 'ARCHIVE_MANIFEST_UNVERIFIED') return error.code
  if (error instanceof MediaContentFileError && error.code !== 'ROOT_CHANGED') return error.code
  if (error instanceof MaintenanceSourceError) return error.code
  if (error instanceof MaintenanceFileError) return error.code
  throw error
}
async function inspectMedia(
  context: DedupPrepareContext,
  item: ArtworkDedupOperationArtwork,
  image: Inventory['images'][number]
) {
  const resolved = target(context, image.path, item.isUrl)
  const entry = { ...baseEntry(item, `media:${image.id}`, 'MEDIA', resolved), imageId: image.id }
  const evidence = image.evidence
  if (!evidence || !evidence.sha256) return blocked(entry, 'INCOMPLETE_EVIDENCE')
  if (
    item.isUrl &&
    (!image.archiveItem ||
      image.archiveItem.sha256 !== evidence.sha256 ||
      image.archiveItem.byteCount !== evidence.size)
  )
    return blocked(entry, 'ARCHIVE_MANIFEST_UNVERIFIED')
  if (evidence.rootIdentity !== resolved.root.rootIdentity || evidence.logicalRoot !== resolved.root.logicalRoot)
    throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
  try {
    const observed = await context.reader.inspectMaintenance(resolved)
    const result = inspected(entry, observed)
    if (observed.kind !== 'FILE' || !observed.state || observed.state.size <= 0n) return blocked(result, 'INVALID_FILE')
    if (observed.state.linkCount !== 1n) return blocked(result, 'HARD_LINK')
    if (observed.state.deviceId !== resolved.root.deviceId) return blocked(result, 'CROSS_DEVICE')
    if (
      image.path !== evidence.sourcePath ||
      observed.canonicalPath !== evidence.canonicalPath ||
      !sameContentFileState(observed.state, evidence)
    )
      return blocked(result, 'FILE_CHANGED')
    const operation = await context.transaction(tx => assertArtworkDedupOperationExecution(tx, context.execution))
    if ([3, 4].includes(operation.protocolVersion ?? 0)) {
      const read = await context.reader.read(resolved)
      if (read.sha256 !== evidence.sha256 || !sameContentFileState(read.state, evidence)) return blocked(result, 'CONTENT_CHANGED')
    }
    return {
      ...result,
      sourceRevision: evidence.sourceRevision,
      sha256: evidence.sha256,
      directoryId: evidence.directoryId,
      directoryGeneration: evidence.directoryGeneration
    }
  } catch (error) {
    return blocked(entry, localError(error))
  }
}
async function inspectChapter(
  context: DedupPrepareContext,
  item: ArtworkDedupOperationArtwork,
  image: Inventory['images'][number]
) {
  const resolved = target(context, image.chaptersPath!, item.isUrl)
  const entry = { ...baseEntry(item, `chapter:${image.id}`, 'CHAPTER', resolved), imageId: image.id }
  if (!image.chaptersHash || !/^[a-f0-9]{64}$/.test(image.chaptersHash))
    return blocked(entry, 'CHAPTER_IDENTITY_MISMATCH')
  try {
    const observed = await context.reader.inspectSource({
      ...resolved,
      offset: 0,
      expectedIdentity: { kind: 'CHAPTER', chaptersHash: image.chaptersHash }
    })
    return { ...inspected(entry, observed), sha256: observed.sha256 }
  } catch (error) {
    return blocked(entry, localError(error))
  }
}
async function inspectSource(
  context: DedupPrepareContext,
  item: ArtworkDedupOperationArtwork,
  reference: Inventory['sourceReferences'][number]
) {
  const resolved = target(context, reference.path, reference.rootKind === 'ARCHIVE')
  const entry = {
    ...baseEntry(item, reference.referenceKey, 'SOURCE_FILE', resolved),
    revisionId: reference.revisionId
  }
  let result: ArtworkDedupOperationFileInput = entry
  try {
    const observed = await context.reader.inspectSource({
      ...resolved,
      expectedIdentity: reference.expectedIdentity,
      offset: 0
    })
    result = { ...inspected(entry, observed), sha256: observed.sha256 }
    if (reference.expectedIdentity.kind === 'ARCHIVE_MANIFEST') {
      const seal = await context.transaction(async (tx) => {
        await current(context, tx, item.artworkId)
        return readArtworkDedupArchiveManifestEvidence(tx, {
          execution: context.execution, artworkId: item.artworkId, allowLegacyManifestMapping: true
        })
      })
      if (
        seal.revisionId !== reference.expectedIdentity.revisionId ||
        seal.providerKey !== reference.expectedIdentity.providerKey ||
        seal.externalId !== reference.expectedIdentity.externalId ||
        (seal.sealedManifestSha256 !== null
          ? seal.sealedManifestSha256 !== observed.sha256
          : !observed.mediaSignature || seal.manifestMediaSignature !== observed.mediaSignature) ||
        seal.memberCount !== BigInt(observed.mediaCount)
      )
        return blocked(result, 'ARCHIVE_MANIFEST_UNVERIFIED')
    }
    return result
  } catch (error) {
    return blocked(result, localError(error))
  }
}
/** At most fifty image references produce one hundred rows; their cursor commits with those exact rows. */
export async function prepareArtworkInventory(
  context: DedupPrepareContext,
  item: ArtworkDedupOperationArtwork
): Promise<boolean> {
  throwIfAborted(context.signal)
  const page = await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    return readArtworkDedupInventoryPage(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      afterImageId: item.afterImageId,
      limit: 50
    })
  })
  const entries: ArtworkDedupOperationFileInput[] = []
  let afterImageId = item.afterImageId
  const operation = await context.transaction(tx => assertArtworkDedupOperationExecution(tx, context.execution))
  const concurrency = [3, 4].includes(operation.protocolVersion ?? 0) ? 1 : 4
  for (const batch of chunks(page.images, concurrency)) {
    entries.push(...(await mapBounded(batch, concurrency, context.signal, (image) => inspectMedia(context, item, image))))
    for (const image of batch) if (image.chaptersPath) entries.push(await inspectChapter(context, item, image))
    afterImageId = batch.at(-1)!.id
    if (context.shouldYield()) break
  }
  const allImages = page.nextImageId === null && (page.images.length === 0 || afterImageId === page.images.at(-1)!.id)
  await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    await saveArtworkDedupOperationFilesPage(tx, { execution: context.execution, entries })
    await updateArtworkDedupOperationCheckpoint(tx, {
      execution: context.execution,
      data: { preparedFiles: { increment: entries.length } }
    })
    await updateArtworkDedupOperationArtwork(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: {
        afterImageId,
        fileCount: { increment: entries.length },
        ...(page.blockReasons[0] ? { errorCode: page.blockReasons[0], status: 'BLOCKED' } : {})
      }
    })
  })
  if (!allImages || (context.shouldYield() && page.images.length > 0)) return false
  // Each completed source row is its own durable cursor; never reread a large preceding source after a yield.
  for (const reference of page.sourceReferences) {
    const existing = await context.transaction(async (tx) => {
      await current(context, tx, item.artworkId)
      return tx.artworkDedupOperationFile.findUnique({
        where: {
          operationId_referenceKey: { operationId: context.execution.operationId, referenceKey: reference.referenceKey }
        },
        select: { fileId: true }
      })
    })
    if (existing) continue
    const entry = await inspectSource(context, item, reference)
    await context.transaction(async (tx) => {
      await current(context, tx, item.artworkId)
      await saveArtworkDedupOperationFilesPage(tx, { execution: context.execution, entries: [entry] })
      await updateArtworkDedupOperationArtwork(tx, {
        execution: context.execution,
        artworkId: item.artworkId,
        data: { fileCount: { increment: 1 } }
      })
      await updateArtworkDedupOperationCheckpoint(tx, {
        execution: context.execution,
        data: { preparedFiles: { increment: 1 } }
      })
    })
    if (context.shouldYield()) return false
  }
  await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    await updateArtworkDedupOperationArtwork(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: { inventoryComplete: true }
    })
  })
  return true
}
/** Unknown subtrees are recorded as blocked; only registered descendants justify walking deeper. */
export async function prepareArtworkDirectory(
  context: DedupPrepareContext,
  item: ArtworkDedupOperationArtwork
): Promise<boolean> {
  const inventory = await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    return readArtworkDedupInventoryPage(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      afterImageId: item.afterImageId,
      limit: 1
    })
  })
  if (!inventory.exclusiveDirectory) {
    await context.transaction(async (tx) => {
      await current(context, tx, item.artworkId)
      await updateArtworkDedupOperationArtwork(tx, {
        execution: context.execution,
        artworkId: item.artworkId,
        data: { inspectionComplete: true }
      })
    })
    return true
  }
  const directory = target(context, inventory.exclusiveDirectory.path, item.isUrl)
  let checkpoint
  try {
    checkpoint = readMaintenanceDirectoryCheckpoint(item.inspectionCheckpoint, directory.relativePath)
  } catch {
    throw new DedupPrepareError('INVALID_CHECKPOINT')
  }
  const frame = checkpoint.stack.at(-1)
  if (!frame) return true
  const page = await context.reader.inspectDirectory({
    ...directory,
    relativePath: frame.relativePath,
    afterName: frame.afterName,
    expectedState: decodeMaintenanceDirectoryState(frame.expectedState)
  })
  frame.expectedState = encodeMaintenanceDirectoryState(page.state)
  const entries: ArtworkDedupOperationFileInput[] = []
  // Bound DB reads to this directory page, keeping the snapshot lock out of individual file I/O.
  const knownPaths = await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    const where = {
      operationId: context.execution.operationId,
      artworkId: item.artworkId,
      rootIdentity: directory.root.rootIdentity
    }
    const rows = await tx.artworkDedupOperationFile.findMany({
      where: { ...where, canonicalPath: { in: page.entries.map((child) => `${frame.relativePath}/${child.name}`) } },
      select: {
        canonicalPath: true,
        referenceKey: true,
        role: true,
        status: true,
        blockReason: true,
        size: true,
        mtimeNs: true,
        ctimeNs: true,
        deviceId: true,
        inode: true,
        linkCount: true
      },
      distinct: ['canonicalPath'],
      take: 100
    })
    const exact = new Map(rows.map((row) => [row.canonicalPath, row]))
    const descendantDirectories = new Set<string>()
    for (const child of page.entries)
      if (child.kind === 'DIRECTORY' && !exact.has(`${frame.relativePath}/${child.name}`)) {
        const relativePath = `${frame.relativePath}/${child.name}`
        if (
          await tx.artworkDedupOperationFile.findFirst({
            where: { ...where, canonicalPath: { startsWith: `${relativePath}/` } },
            select: { fileId: true }
          })
        )
          descendantDirectories.add(relativePath)
      }
    return { exact, descendantDirectories }
  })
  let descended = false
  let addedFiles = 0
  for (const child of page.entries) {
    if (++checkpoint.visited > 10000) throw new MaintenanceFileError('DIRECTORY_BUDGET_EXCEEDED')
    const relativePath = `${frame.relativePath}/${child.name}`
    const known = knownPaths.exact.get(relativePath)
    frame.afterName = child.name
    if (child.kind === 'DIRECTORY' && knownPaths.descendantDirectories.has(relativePath)) {
      if (checkpoint.stack.length >= 12) throw new MaintenanceFileError('DIRECTORY_BUDGET_EXCEEDED')
      checkpoint.stack.push({ relativePath, afterName: null, expectedState: null })
      descended = true
      break
    }
    if (known) {
      const observed = await context.reader.inspectMaintenance({ ...directory, relativePath })
      const unchanged =
        child.kind === 'FILE' &&
        observed.kind === 'FILE' &&
        observed.state &&
        (['size', 'mtimeNs', 'ctimeNs', 'deviceId', 'inode', 'linkCount'] as const).every(
          (key) => observed.state![key] === known[key]
        )
      // A failed source read has no baseline to compare. Retain the original blocking
      // reason instead of replacing it with FILE_CHANGED when its attributes are null.
      if (!unchanged)
        entries.push(
          blocked(
            inspected(baseEntry(item, known.referenceKey, known.role, { ...directory, relativePath }), observed),
            known.status === 'BLOCKED' && known.blockReason ? known.blockReason : 'FILE_CHANGED'
          )
        )
    } else {
      const entry = baseEntry(
        item,
        `unknown:${item.artworkId}:${relativePath}`,
        child.kind === 'FILE' ? 'ATTACHMENT' : 'UNKNOWN',
        { ...directory, relativePath }
      )
      const observed = await context.reader.inspectMaintenance({ ...directory, relativePath })
      entries.push({ ...blocked(inspected(entry, observed), 'UNREVIEWED_ATTACHMENT'), requiresReview: true })
      addedFiles++
    }
    if (context.shouldYield()) break
  }
  if (
    !descended &&
    page.nextName === null &&
    (page.entries.length === 0 || frame.afterName === page.entries.at(-1)!.name)
  )
    checkpoint.stack.pop()
  const verified = await context.reader.inspectMaintenance({ ...directory, relativePath: frame.relativePath })
  if (verified.kind !== 'DIRECTORY' || !verified.state || !sameContentFileState(verified.state, page.state))
    throw new MediaContentFileError('FILE_CHANGED', 'Directory changed during inspection')
  const complete = checkpoint.stack.length === 0
  await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    await saveArtworkDedupOperationFilesPage(tx, { execution: context.execution, entries })
    await updateArtworkDedupOperationCheckpoint(tx, {
      execution: context.execution,
      data: { preparedFiles: { increment: addedFiles } }
    })
    await updateArtworkDedupOperationArtwork(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: { inspectionCheckpoint: checkpoint, inspectionComplete: complete, fileCount: { increment: addedFiles } }
    })
  })
  return complete
}
