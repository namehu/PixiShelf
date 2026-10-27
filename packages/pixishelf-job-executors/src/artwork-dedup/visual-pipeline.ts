import { setImmediate } from 'node:timers/promises'
import { readVisualRelationReuse, visualRelationSignature } from './relation-cache.ts'
import {
  Prisma, assertArtworkDedupExecution, assertArtworkDedupItemCurrent, assertArtworkContentSnapshot,
  assertArtworkDedupVisualDirectories, readArtworkDedupSharedVisualFingerprints, type MediaContentDirectorySnapshot
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
function contentKey(row: { sha256: string | null; size: bigint }) {
  return row.sha256 && /^[a-f0-9]{64}$/.test(row.sha256)
    ? `${row.sha256}:${row.size}:${VISUAL_ALGORITHM_VERSION}:${VISUAL_NORMALIZATION_VERSION}` : undefined
}
function ownCacheValid(row: Media, cache: Prisma.MediaVisualFingerprintGetPayload<Record<string, never>> | undefined) {
  return cache?.identity === visualIdentity(row) && cache.algorithmVersion === VISUAL_ALGORITHM_VERSION &&
    cache.normalizationVersion === VISUAL_NORMALIZATION_VERSION && validVisualViews(cache.views)
}
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
    await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id, relationKind: 'VISUAL' } })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: 'INCOMPLETE',
      visualIncompleteReasons: [...new Set([...run.visualIncompleteReasons, reason])] } })
  })
  return true
}
/** Feature cursor commits only complete decoder output under the same scan fence. */
export async function prepareVisualVersions(context: DedupPipelineContext, fileLimit: number = VISUAL_LIMITS.files): Promise<boolean> {
  const run = await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution))
  if (!run.includeSuspectedVersions) return true
  if (run.visualStatus === 'COMPLETE' || run.visualStatus === 'INCOMPLETE' && run.stage === 'DONE') return true
  const counts = await context.transaction(tx => tx.artworkDedupMedia.count({ where: { runId: run.id, item: { status: 'COMPLETE' } } }))
  if (counts > fileLimit) return incomplete(context, 'VISUAL_FILE_BUDGET')
  for (;;) {
    throwIfAborted(context.signal)
    const page = await context.transaction(async tx => {
      const latest = await assertArtworkDedupExecution(tx, context.execution)
      const rows = await tx.artworkDedupMedia.findMany({ where: { runId: run.id, imageId: { gt: latest.visualAfterImageId }, item: { status: 'COMPLETE' } }, orderBy: { imageId: 'asc' }, take: 50 })
      const ids = rows.map(row => row.imageId)
      const images = ids.length ? await tx.image.findMany({ where: { id: { in: ids } },
        select: { id: true, artworkId: true, path: true, mediaType: true, contentSource: true } }) : []
      const cached = ids.length && !context.forceRead
        ? await tx.mediaVisualFingerprint.findMany({ where: { imageId: { in: ids } } }) : []
      const byId = new Map(cached.map(cache => [cache.imageId, cache]))
      const shared = new Map<string, Prisma.InputJsonValue>()
      if (!context.forceRead) {
        const missing = new Map(rows.filter(row => !ownCacheValid(row, byId.get(row.imageId)) && contentKey(row))
          .map(row => [contentKey(row)!, { contentSha256: row.sha256!, contentSize: row.size,
            algorithmVersion: VISUAL_ALGORITHM_VERSION, normalizationVersion: VISUAL_NORMALIZATION_VERSION }]))
        for (const cache of await readArtworkDedupSharedVisualFingerprints(tx, [...missing.values()])) {
          if (validVisualViews(cache.views)) shared.set(contentKey({ sha256: cache.contentSha256, size: cache.contentSize })!, cache.views as unknown as Prisma.InputJsonValue)
        }
      }
      return { rows, images: new Map(images.map(image => [image.id, image])), cached: byId, shared }
    })
    if (!page.rows.length) break
    const completed: Array<{ row: Media; views: Prisma.InputJsonValue | undefined; unchecked: boolean; bytes: bigint; dirty: boolean }> = []
    let yielding = false
    for (const row of page.rows) {
      throwIfAborted(context.signal)
      const image = page.images.get(row.imageId)
      let views: Prisma.InputJsonValue | undefined, unchecked = false, bytes = 0n, dirty = false
      if (!image || image.artworkId !== row.artworkId || image.path !== row.sourcePath ||
        (image.contentSource?.revision ?? 0n) !== row.sourceRevision || image.contentSource?.writeToken ||
        image.contentSource?.directoryStateId !== row.directoryId)
        throw new MediaContentFileError('FILE_CHANGED', 'Visual image changed')
      const root = row.logicalRoot === 'source-media:v1' ? context.roots.source : context.roots.archive
      if (root.rootIdentity !== row.rootIdentity || root.logicalRoot !== row.logicalRoot)
        throw new MediaContentFileError('ROOT_CHANGED', 'Visual root changed')
      if (image.mediaType === 'VIDEO' || image.mediaType === 'ANIMATION' || row.size > BigInt(VISUAL_LIMITS.bytes)) unchecked = true
      else {
        const cached = page.cached.get(row.imageId)
        const key = context.forceRead ? undefined : contentKey(row)
        if (ownCacheValid(row, cached)) views = cached!.views as unknown as Prisma.InputJsonValue
        else if (key && page.shared.has(key)) { views = page.shared.get(key)!; dirty = true }
        else {
          try {
            const read = await context.reader.visual({ root, relativePath: row.canonicalPath, signal: context.signal })
            if (read.sha256 !== row.sha256 || !sameContentFileState(read.state, row)) throw new MediaContentFileError('FILE_CHANGED', 'Visual content changed')
            views = read.views as unknown as Prisma.InputJsonValue; bytes = read.bytesRead; dirty = true
            if (key && validVisualViews(read.views)) page.shared.set(key, views)
          } catch (error) {
            if (error instanceof MediaContentFileError && ['INVALID_FILE', 'NOT_READABLE'].includes(error.code)) unchecked = true
            else throw error
          }
        }
      }
      completed.push({ row, views, unchecked, bytes, dirty })
      if (context.shouldYield()) { yielding = true; break }
    }
    throwIfAborted(context.signal)
    await context.transaction(async tx => {
      const latest = await assertArtworkDedupExecution(tx, context.execution)
      // Lock every directory before any artwork; reuse guards only within this commit.
      const directories = completed.map(({ row }) => directory(row))
      if (!(await assertArtworkDedupVisualDirectories(tx, directories))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
      const artworks = [...new Map(completed.map(({ row }) => [row.artworkId, row])).values()].sort((a, b) => a.artworkId - b.artworkId)
      for (const row of artworks) await current(tx, context, row, true)
      const images = await tx.image.findMany({ where: { id: { in: completed.map(({ row }) => row.imageId) } },
        select: { id: true, artworkId: true, path: true, mediaType: true, contentSource: true } })
      const byId = new Map(images.map(image => [image.id, image]))
      for (const { row } of completed) {
        const image = byId.get(row.imageId)
        if (!image || image.artworkId !== row.artworkId || image.path !== row.sourcePath ||
          image.mediaType !== page.images.get(row.imageId)!.mediaType ||
          (image.contentSource?.revision ?? 0n) !== row.sourceRevision || image.contentSource?.writeToken ||
          image.contentSource?.directoryStateId !== row.directoryId)
          throw new MediaContentFileError('FILE_CHANGED', 'Visual image changed')
      }
      throwIfAborted(context.signal)
      const dirty = completed.filter(entry => entry.dirty)
      if (dirty.length) await tx.$executeRaw(Prisma.sql`
        INSERT INTO "MediaVisualFingerprint" ("imageId",identity,"algorithmVersion","normalizationVersion","contentSha256","contentSize",views,"updatedAt")
        VALUES ${Prisma.join(dirty.map(({ row, views }) => Prisma.sql`(${row.imageId},${visualIdentity(row)},${VISUAL_ALGORITHM_VERSION},${VISUAL_NORMALIZATION_VERSION},${row.sha256},${row.size},${JSON.stringify(views)}::jsonb,CURRENT_TIMESTAMP)`))}
        ON CONFLICT ("imageId") DO UPDATE SET identity=EXCLUDED.identity,"algorithmVersion"=EXCLUDED."algorithmVersion",
          "normalizationVersion"=EXCLUDED."normalizationVersion","contentSha256"=EXCLUDED."contentSha256","contentSize"=EXCLUDED."contentSize",
          views=EXCLUDED.views,"updatedAt"=EXCLUDED."updatedAt"`)
      // Task-local results and cursor are durable together, including a short yield prefix.
      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE "ArtworkDedupMedia" m SET "visualStatus"=v.status,"visualViews"=v.views
        FROM (VALUES ${Prisma.join(completed.map(({ row, unchecked, views }) => Prisma.sql`(${row.artworkId}::integer,${row.imageId}::integer,${unchecked ? 'UNCHECKED' : 'READY'}::text,${views ? JSON.stringify(views) : null}::jsonb)`))}) AS v("artworkId","imageId",status,views)
        WHERE m."runId"=${run.id} AND m."artworkId"=v."artworkId" AND m."imageId"=v."imageId"`)
      if (updated !== completed.length) throw new MediaContentFileError('FILE_CHANGED', 'Visual media changed')
      throwIfAborted(context.signal)
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualAfterImageId: completed.at(-1)!.row.imageId,
        readBytes: { increment: completed.reduce((total, entry) => total + entry.bytes, 0n) },
        ...(completed.some(entry => entry.unchecked) ? { visualIncompleteReasons: [...new Set([...latest.visualIncompleteReasons, 'UNSUPPORTED_MEDIA'])] } : {}) } })
    })
    if (yielding || context.shouldYield()) return false
  }
  return true
}

/** Compatibility path for scan definitions 1–4. */
export async function scanVisualVersions(context: DedupPipelineContext): Promise<boolean> {
  if (!(await prepareVisualVersions(context))) return false
  const run = await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution))
  if (!run.includeSuspectedVersions || run.visualStatus === 'COMPLETE' || run.visualStatus === 'INCOMPLETE' && run.stage === 'DONE') return true
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
  const byArtwork = new Map<number, VisualPage[]>()
  for (const page of pages) { const list = byArtwork.get(page.artworkId) ?? []; list.push(page); byArtwork.set(page.artworkId, list) }
  const signatures = new Map([...byArtwork].map(([id, list]) => [id, visualRelationSignature(list)]))
  const reuse = await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    return context.forceRead ? undefined : readVisualRelationReuse(tx, latest, pages, signatures)
  })
  const result = await matchVisualPages(pages, async () => { throwIfAborted(context.signal); await setImmediate(); await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution)) }, reuse)
  if (result.reason) return incomplete(context, result.reason)
  await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id, relationKind: 'VISUAL' } })
    // Complete negative evidence is about every checked original, not only matches.
    const directories = [...new Map(bounded.map(row => [row.directoryId, directory(row)])).values()]
    if (!(await assertArtworkDedupVisualDirectories(tx, directories))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
    const checked = new Set<string>()
    for (const row of bounded) {
      const key = `${row.artworkId}:${row.directoryId}:${row.directoryGeneration}`
      if (!checked.has(key)) { await current(tx, context, row, true); checked.add(key) }
    }
    // Projection uses current display order. The old run's page indexes and
    // ordinals are never copied, including repeated byte-identical occurrences.
    const currentOrder = await tx.image.findMany({ where: { id: { in: pages.map(p => p.imageId) } }, select: { id: true, sortOrder: true } })
    const currentById = new Map(currentOrder.map(i => [i.id, i.sortOrder]))
    for (const list of byArtwork.values()) {
      list.sort((a, b) => (currentById.get(a.imageId) ?? 0) - (currentById.get(b.imageId) ?? 0) || a.imageId - b.imageId)
      list.forEach((page, index) => { page.index = index })
    }
    for (const pair of result.pairs) {
      pair.pages.sort((a, b) => (a.left?.index ?? Infinity) - (b.left?.index ?? Infinity) || (a.right?.index ?? Infinity) - (b.right?.index ?? Infinity))
      // Original equality/containment always takes precedence over a visual suggestion.
      const original = await tx.artworkDedupRelation.findFirst({ where: { runId: run.id, OR: [
        { containedArtworkId: pair.leftArtworkId, containerArtworkId: pair.rightArtworkId }, { containedArtworkId: pair.rightArtworkId, containerArtworkId: pair.leftArtworkId }
      ] }, select: { id: true } })
      if (original || await tx.artworkDedupVisualPair.findUnique({ where: { runId_leftArtworkId_rightArtworkId: { runId: run.id, leftArtworkId: pair.leftArtworkId, rightArtworkId: pair.rightArtworkId } } })) continue
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
    const entries = [...signatures]
    for (let start = 0; start < entries.length; start += 100) await tx.$executeRaw(Prisma.sql`
      UPDATE "ArtworkDedupItem" i SET "visualSignature"=v.signature
      FROM (VALUES ${Prisma.join(entries.slice(start, start + 100).map(([id, signature]) => Prisma.sql`(${id}::integer,${signature}::text)`))}) AS v(id,signature)
      WHERE i."runId"=${run.id} AND i."artworkId"=v.id`)
    throwIfAborted(context.signal)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: reasons.length ? 'INCOMPLETE' : 'COMPLETE', visualIncompleteReasons: reasons,
      visualCandidatePairs: result.candidatePairs ?? [], visualReusedComparisons: result.reusedComparisons ?? 0, visualComparedComparisons: result.comparedComparisons ?? 0 } })
  })
  return true
}
