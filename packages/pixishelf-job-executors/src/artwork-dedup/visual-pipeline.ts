import { setImmediate } from 'node:timers/promises'
import {
  Prisma, assertArtworkDedupExecution, assertArtworkDedupItemCurrent, assertArtworkContentSnapshot,
  assertArtworkDedupVisualDirectories, type MediaContentDirectorySnapshot
} from '@pixishelf/db'
import { MediaContentFileError } from '../media-content/roots.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import type { DedupPipelineContext } from './pipeline.ts'
import {
  VISUAL_ALGORITHM_VERSION, VISUAL_NORMALIZATION_VERSION, VISUAL_LIMITS,
  validVisualViews, visualIdentity, matchVisualPages, type VisualPage
} from './visual-matching.ts'
type Media = Prisma.ArtworkDedupMediaGetPayload<Record<string, never>>
function directory(row: Media): MediaContentDirectorySnapshot {
  if (row.logicalRoot !== 'source-media:v1' && row.logicalRoot !== 'archive-media:v1') throw new MediaContentFileError('ROOT_CHANGED', 'Visual root changed')
  return { logicalRoot: row.logicalRoot, rootIdentity: row.rootIdentity, relativeDirectory: row.relativeDirectory, directoryId: row.directoryId, generation: row.directoryGeneration }
}
async function current(tx: Prisma.TransactionClient, context: DedupPipelineContext, row: Media, directoriesLocked = false) {
  if (!directoriesLocked && !(await assertArtworkDedupVisualDirectories(tx, [directory(row)])))
    throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
  if (!(await assertArtworkDedupItemCurrent(tx, { execution: context.execution, artworkId: row.artworkId })))
    throw new MediaContentFileError('FILE_CHANGED', 'Visual snapshot changed')
  const item = await tx.artworkDedupItem.findUniqueOrThrow({ where: { runId_artworkId: { runId: row.runId, artworkId: row.artworkId } } })
  if (item.status !== 'COMPLETE' || item.snapshotRevision === null || item.mediaEpoch === null || item.memberCount === null ||
    (await assertArtworkContentSnapshot(tx, { snapshot: { artworkId: row.artworkId, revision: item.snapshotRevision, mediaEpoch: item.mediaEpoch, memberCount: item.memberCount } })).status !== 'READY')
    throw new MediaContentFileError('FILE_CHANGED', 'Visual snapshot changed')
}
async function incomplete(context: DedupPipelineContext, reason: string) {
  await context.transaction(async tx => {
    const run = await assertArtworkDedupExecution(tx, context.execution)
    await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id } })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: 'INCOMPLETE',
      visualIncompleteReasons: [...new Set([...run.visualIncompleteReasons, reason])] } })
  })
  return true
}
/** Feature cursor commits only complete decoder output under the same scan fence. */
export async function scanVisualVersions(context: DedupPipelineContext): Promise<boolean> {
  const run = await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution))
  if (!run.includeSuspectedVersions) return true
  if (run.visualStatus === 'COMPLETE' || run.visualStatus === 'INCOMPLETE' && run.stage === 'DONE') return true
  const counts = await context.transaction(tx => tx.artworkDedupMedia.count({ where: { runId: run.id, item: { status: 'COMPLETE' } } }))
  if (counts > VISUAL_LIMITS.files) return incomplete(context, 'VISUAL_FILE_BUDGET')
  for (;;) {
    throwIfAborted(context.signal)
    const rows = await context.transaction(async tx => {
      const latest = await assertArtworkDedupExecution(tx, context.execution)
      return tx.artworkDedupMedia.findMany({ where: { runId: run.id, imageId: { gt: latest.visualAfterImageId }, item: { status: 'COMPLETE' } }, orderBy: { imageId: 'asc' }, take: 50 })
    })
    if (!rows.length) break
    for (const row of rows) {
      const image = await context.transaction(tx => tx.image.findUnique({ where: { id: row.imageId }, select: { artworkId: true, mediaType: true } }))
      let views: Prisma.InputJsonValue | undefined, unchecked = false, bytes = 0n
      const identity = visualIdentity(row)
      if (!image || image.artworkId !== row.artworkId) throw new MediaContentFileError('FILE_CHANGED', 'Visual image changed')
      if (image.mediaType === 'VIDEO' || image.mediaType === 'ANIMATION' || row.size > BigInt(VISUAL_LIMITS.bytes)) unchecked = true
      else {
        const cached = context.forceRead ? null : await context.transaction(tx => tx.mediaVisualFingerprint.findUnique({ where: { imageId: row.imageId } }))
        if (cached?.identity === identity && cached.algorithmVersion === VISUAL_ALGORITHM_VERSION && cached.normalizationVersion === VISUAL_NORMALIZATION_VERSION && validVisualViews(cached.views)) views = cached.views as unknown as Prisma.InputJsonValue
        else {
          const root = row.logicalRoot === 'source-media:v1' ? context.roots.source : context.roots.archive
          if (root.rootIdentity !== row.rootIdentity || root.logicalRoot !== row.logicalRoot) throw new MediaContentFileError('ROOT_CHANGED', 'Visual root changed')
          try {
            const read = await context.reader.visual({ root, relativePath: row.canonicalPath, signal: context.signal })
            if (read.sha256 !== row.sha256 || !sameContentFileState(read.state, row)) throw new MediaContentFileError('FILE_CHANGED', 'Visual content changed')
            views = read.views as unknown as Prisma.InputJsonValue; bytes = read.bytesRead
          } catch (error) {
            if (error instanceof MediaContentFileError && ['INVALID_FILE', 'NOT_READABLE'].includes(error.code)) unchecked = true
            else throw error
          }
        }
      }
      await context.transaction(async tx => {
        await current(tx, context, row)
        if (views) await tx.mediaVisualFingerprint.upsert({ where: { imageId: row.imageId },
          create: { imageId: row.imageId, identity, algorithmVersion: VISUAL_ALGORITHM_VERSION, normalizationVersion: VISUAL_NORMALIZATION_VERSION, views },
          update: { identity, algorithmVersion: VISUAL_ALGORITHM_VERSION, normalizationVersion: VISUAL_NORMALIZATION_VERSION, views } })
        await tx.artworkDedupMedia.update({ where: { runId_artworkId_imageId: { runId: run.id, artworkId: row.artworkId, imageId: row.imageId } },
          data: { visualStatus: unchecked ? 'UNCHECKED' : 'READY', visualViews: views ?? Prisma.DbNull } })
        const latest = await assertArtworkDedupExecution(tx, context.execution)
        await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualAfterImageId: row.imageId, readBytes: { increment: bytes },
          ...(unchecked ? { visualIncompleteReasons: [...new Set([...latest.visualIncompleteReasons, 'UNSUPPORTED_MEDIA'])] } : {}) } })
      })
      if (context.shouldYield()) return false
    }
  }
  const bounded = await context.transaction(async tx => {
    await assertArtworkDedupExecution(tx, context.execution)
    return tx.artworkDedupMedia.findMany({ where: { runId: run.id, item: { status: 'COMPLETE' } }, orderBy: [{ artworkId: 'asc' }, { imageId: 'asc' }], take: VISUAL_LIMITS.files + 1 })
  })
  if (bounded.length > VISUAL_LIMITS.files) return incomplete(context, 'VISUAL_FILE_BUDGET')
  const excluded = new Set(bounded.filter(row => row.visualStatus !== 'READY' || !validVisualViews(row.visualViews)).map(row => row.artworkId))
  const metadata = await context.transaction(tx => tx.image.findMany({ where: { id: { in: bounded.map(r => r.imageId) } }, select: { id: true, sortOrder: true } }))
  const order = new Map(metadata.map(m => [m.id, m.sortOrder]))
  bounded.sort((a, b) => a.artworkId - b.artworkId || (order.get(a.imageId) ?? 0) - (order.get(b.imageId) ?? 0) || a.imageId - b.imageId)
  let previous = 0, pageIndex = 0
  const pages: VisualPage[] = []
  for (const row of bounded) {
    if (row.artworkId !== previous) { previous = row.artworkId; pageIndex = 0 }
    if (!excluded.has(row.artworkId) && row.sha256 && validVisualViews(row.visualViews)) pages.push({ imageId: row.imageId, artworkId: row.artworkId, index: pageIndex, size: row.size, sha256: row.sha256, views: row.visualViews })
    pageIndex++
  }
  const result = await matchVisualPages(pages, async () => { throwIfAborted(context.signal); await setImmediate(); await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution)) })
  if (result.reason) return incomplete(context, result.reason)
  await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id } })
    // Validate each participating original's source/directory snapshot again at publication.
    const participating = new Set(result.pairs.flatMap(p => [p.leftArtworkId, p.rightArtworkId]))
    const directories = [...new Map(bounded.filter(row => participating.has(row.artworkId)).map(row => [row.directoryId, directory(row)])).values()]
    if (!(await assertArtworkDedupVisualDirectories(tx, directories))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
    const checked = new Set<string>()
    for (const row of bounded) if (participating.has(row.artworkId)) {
      const key = `${row.artworkId}:${row.directoryId}:${row.directoryGeneration}`
      if (!checked.has(key)) { await current(tx, context, row, true); checked.add(key) }
    }
    for (const pair of result.pairs) {
      // Original equality/containment always takes precedence over a visual suggestion.
      const original = await tx.artworkDedupRelation.findFirst({ where: { runId: run.id, OR: [
        { containedArtworkId: pair.leftArtworkId, containerArtworkId: pair.rightArtworkId }, { containedArtworkId: pair.rightArtworkId, containerArtworkId: pair.leftArtworkId }
      ] }, select: { id: true } })
      if (original) continue
      const id = `visual:${run.id}:${pair.leftArtworkId}:${pair.rightArtworkId}`
      const left = pair.pages.filter(p => p.left).length, right = pair.pages.filter(p => p.right).length
      const exact = pair.pages.filter(p => p.kind === 'EXACT').length, similar = pair.pages.filter(p => p.kind === 'SIMILAR').length
      const summary = { evidenceVersion: VISUAL_ALGORITHM_VERSION, leftArtworkId: pair.leftArtworkId, rightArtworkId: pair.rightArtworkId,
        leftFileCount: String(left), rightFileCount: String(right), pairedCount: String(exact + similar), exactCount: String(exact), similarCount: String(similar),
        leftUnmatchedCount: String(left - exact - similar), rightUnmatchedCount: String(right - exact - similar), leftUncheckedCount: '0', rightUncheckedCount: '0' }
      await tx.artworkDedupVisualPair.create({ data: { id, runId: run.id, leftArtworkId: pair.leftArtworkId, rightArtworkId: pair.rightArtworkId, summary } })
      for (let start = 0; start < pair.pages.length; start += 100) await tx.artworkDedupVisualPage.createMany({ data: pair.pages.slice(start, start + 100).map((p, i) => ({ pairId: id, ordinal: start + i + 1, kind: p.kind, leftImageId: p.left?.imageId ?? null, rightImageId: p.right?.imageId ?? null, leftIndex: p.left?.index ?? null, rightIndex: p.right?.index ?? null })) })
    }
    const failed = await tx.artworkDedupItem.count({ where: { runId: run.id, status: { not: 'COMPLETE' } } })
    const reasons = [...new Set([...latest.visualIncompleteReasons, ...(excluded.size ? ['UNSUPPORTED_MEDIA'] : []), ...(failed ? ['INCOMPLETE_ORIGINALS'] : [])])]
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: reasons.length ? 'INCOMPLETE' : 'COMPLETE', visualIncompleteReasons: reasons } })
  })
  return true
}
