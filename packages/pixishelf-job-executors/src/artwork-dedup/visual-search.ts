import { createHash } from 'node:crypto'
import { Prisma, assertArtworkDedupExecution, assertArtworkDedupCacheDirectories, assertArtworkDedupVisualItemsFenced } from '@pixishelf/db'
import { artworkDedupPerformanceSummarySchema, type ArtworkDedupPerformanceSummary } from '@pixishelf/job-contracts'
import { MediaContentFileError } from '../media-content/roots.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import type { DedupPipelineContext } from './pipeline.ts'
import { prepareVisualVersions } from './visual-pipeline.ts'
import { checkpointSchema, initialCheckpoint, pairCandidate, publish, snapshotReuse, VisualBudget, type Checkpoint } from './visual-batches.ts'
import { visualRelationSignature } from './relation-cache.ts'
import { VISUAL_LIMITS, validVisualViews, type VisualPage } from './visual-matching.ts'
import { VISUAL_SEARCH_VERSION, type SearchPage } from './visual-search-index.ts'
import { advanceArtworkDedupPerformance, artworkDedupProgress, createArtworkDedupPerformance, type ArtworkDedupPerformanceDelta } from './telemetry.ts'

type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>
type V2Checkpoint = Checkpoint & { version: 3; queryCompleted: number; queryTotal: number; uncheckedMedia: number }
const changed = (): never => { throw new MediaContentFileError('FILE_CHANGED', 'Visual search input changed') }

async function guard(tx: Prisma.TransactionClient, run: Run, ids: number[]) {
  if (!ids.length) return
  if (!(await assertArtworkDedupCacheDirectories(tx, run.id, ids))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
  if (!(await assertArtworkDedupVisualItemsFenced(tx, run, ids))) changed()
}
async function progress(context: DedupPipelineContext, tx: Prisma.TransactionClient, run: Run, checkpoint: V2Checkpoint, summary: ArtworkDedupPerformanceSummary) {
  const phase = summary.phase === 'COMPLETED' ? 'COMPLETED' : checkpoint.phase === 'QUERY' ? 'VISUAL' : checkpoint.phase === 'REUSE' ? 'INDEX' : checkpoint.phase
  await tx.systemJob.update({ where: { id: run.jobId! }, data: { progressData: artworkDedupProgress({
    phase, completed: checkpoint.phase === 'QUERY' ? checkpoint.queryCompleted : null,
    total: checkpoint.phase === 'QUERY' ? checkpoint.queryTotal : null, unit: 'images', uncheckedMedia: checkpoint.uncheckedMedia,
    waitReason: run.visualBudgetWaiting ? 'VISUAL_COMPARISON_BUDGET' : null, updatedAt: summary.updatedAt
  }) as unknown as Prisma.InputJsonValue } })
  await context.onPerformanceSnapshot?.(tx, summary)
}

/** One bounded read snapshot per page, outside the queue's mutation fence. */
async function initialize(context: DedupPipelineContext, run: Run, checkpoint: V2Checkpoint, summary: ArtworkDedupPerformanceSummary) {
  const read = context.read ?? context.transaction
  const groups = new Map<number, VisualPage[]>()
  let after = 0, unchecked = 0, total = 0
  for (;;) {
    throwIfAborted(context.signal)
    const rows = await read(tx => tx.artworkDedupMedia.findMany({ where: { runId: run.id, imageId: { gt: after }, item: { status: 'COMPLETE' } }, orderBy: { imageId: 'asc' }, take: 500 }))
    if (!rows.length) break
    total += rows.length
    if (total > VISUAL_LIMITS.files) throw new VisualBudget('VISUAL_FILE_BUDGET')
    for (const row of rows) {
      if (!row.sha256 || (row.visualStatus !== 'UNCHECKED' && (row.visualStatus !== 'READY' || !validVisualViews(row.visualViews)))) changed()
      const pages = groups.get(row.artworkId) ?? []
      if (pages.length >= VISUAL_LIMITS.artworkFiles) throw new VisualBudget('VISUAL_ARTWORK_BUDGET')
      if (row.visualStatus === 'UNCHECKED') unchecked++
      pages.push({ imageId: row.imageId, artworkId: row.artworkId, index: pages.length, size: row.size, sha256: row.sha256!, unchecked: row.visualStatus === 'UNCHECKED', views: row.visualStatus === 'UNCHECKED' ? [] : row.visualViews as unknown as VisualPage['views'] })
      groups.set(row.artworkId, pages)
    }
    after = rows.at(-1)!.imageId
  }
  const signatures = [...groups].map(([id, pages]) => [id, visualRelationSignature(pages)] as const).sort((a, b) => a[0] - b[0])
  const digest = createHash('sha256').update(JSON.stringify([VISUAL_SEARCH_VERSION, signatures])).digest('hex')
  Object.assign(checkpoint, { phase: 'REUSE', queryTotal: total - unchecked, uncheckedMedia: unchecked })
  const next = advanceArtworkDedupPerformance(summary, { updatedAt: new Date().toISOString(), searchVersion: VISUAL_SEARCH_VERSION, phase: 'INDEX', inputDigest: digest,
    progress: { staticImages: total - unchecked, uncheckedMedia: unchecked, queryTotal: total - unchecked, queryCompleted: 0 },
    counters: { indexNodeVisits: 0, wholeChannelHits: 0, localChannelHits: 0, candidatePairs: 0, compareCalls: 0, indexRebuilds: 0 }, durationsMs: { compare: 0 } })
  await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    await guard(tx, latest, signatures.map(([id]) => id))
    for (let start = 0; start < signatures.length; start += 500) await tx.$executeRaw(Prisma.sql`
      UPDATE "ArtworkDedupItem" i SET "visualSignature"=v.signature
      FROM (VALUES ${Prisma.join(signatures.slice(start, start + 500).map(([id, signature]) => Prisma.sql`(${id}::integer,${signature}::text)`))}) v(id,signature)
      WHERE i."runId"=${run.id} AND i."artworkId"=v.id`)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: {
      visualSearchVersion: VISUAL_SEARCH_VERSION, visualSearchComplete: false, visualInputDigest: digest,
      visualComparisonRound: latest.visualComparisonRound || 1, visualCheckpoint: checkpoint, performanceSummary: next as unknown as Prisma.InputJsonValue
    } })
    await progress(context, tx, latest, checkpoint, next)
  })
  return next
}

/** The worker holds immutable features only; every commit obtains fresh authority. */
export async function scanVisualSearch(context: DedupPipelineContext, fileLimit: number = VISUAL_LIMITS.files): Promise<boolean> {
  const read = context.read ?? context.transaction
  let run = await read(tx => tx.artworkDedupRun.findUniqueOrThrow({ where: { id: context.execution.runId } }))
  if (!run.visualCheckpoint && !(await prepareVisualVersions(context, fileLimit))) return false
  run = await read(tx => tx.artworkDedupRun.findUniqueOrThrow({ where: { id: context.execution.runId } }))
  if (run.stage === 'DONE') return true
  let summary = run.performanceSummary === null ? createArtworkDedupPerformance({ runId: run.id, jobId: context.execution.jobId,
    protocolVersion: 8, searchVersion: VISUAL_SEARCH_VERSION, inputDigest: run.visualInputDigest, phase: 'INDEX', updatedAt: new Date().toISOString() })
    : { ...artworkDedupPerformanceSummarySchema.parse(run.performanceSummary), searchVersion: VISUAL_SEARCH_VERSION }
  const checkpoint = (run.visualCheckpoint === null ? { ...initialCheckpoint, version: 3, queryCompleted: 0, queryTotal: 0, uncheckedMedia: 0 } : checkpointSchema.parse(run.visualCheckpoint)) as V2Checkpoint
  if (checkpoint.version !== 3) changed()
  let built = context.searchCache?.built ?? false
  const saveSummary = async (delta: ArtworkDedupPerformanceDelta) => {
    const next = advanceArtworkDedupPerformance(summary, delta)
    await context.transaction(async tx => {
      const current = await assertArtworkDedupExecution(tx, context.execution)
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { performanceSummary: next as unknown as Prisma.InputJsonValue } })
      await progress(context, tx, current, checkpoint, next)
    })
    summary = next
    context.onPerformance?.(summary)
  }
  try {
    for (;;) {
      throwIfAborted(context.signal)
      run = await read(tx => tx.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } }))
      if (run.visualBudgetWaiting) return false
      if (checkpoint.phase === 'INDEX') {
        summary = await initialize(context, run, checkpoint, summary)
        context.onPerformance?.(summary)
      } else if (checkpoint.phase === 'REUSE') {
        let reusedSummary = summary
        await snapshotReuse(context, run, checkpoint, async tx => {
          if (checkpoint.phase !== 'QUERY') return
          const reused = await tx.artworkDedupVisualCandidate.count({ where: { runId: run.id, reused: true, NOT: { evidence: { equals: Prisma.DbNull } } } })
          const reasons: ArtworkDedupPerformanceSummary['cacheInvalidationReasons'] = []
          let invalidated: number | undefined
          if (context.forceRead || run.mode === 'FULL') reasons.push('FULL')
          else if (checkpoint.reuseBaseId) {
            const changedItems = await tx.artworkDedupItem.count({ where: { runId: run.id, status: 'COMPLETE', visualReuseSignature: null } })
            if (changedItems) reasons.push('INPUT_CHANGED')
            const historical = await tx.artworkDedupVisualPair.count({ where: { runId: checkpoint.reuseBaseId, relationKind: 'VISUAL' } })
            invalidated = historical - reused
          } else {
            const previous = await tx.artworkDedupRun.findFirst({ where: { artistId: run.artistId, id: { not: run.id } }, orderBy: [{ frozenAt: 'desc' }, { id: 'desc' }], select: { visualSearchVersion: true, visualSearchComplete: true, status: true, stage: true } })
            if (!previous) reasons.push('MISSING')
            else if (previous.visualSearchVersion !== VISUAL_SEARCH_VERSION) reasons.push('SEARCH_VERSION')
            else if (!previous.visualSearchComplete || previous.status !== 'COMPLETED' || previous.stage !== 'DONE') reasons.push('INCOMPLETE')
          }
          reusedSummary = advanceArtworkDedupPerformance(summary, { updatedAt: new Date().toISOString(), phase: 'VISUAL', cacheInvalidationReasons: reasons,
            counters: { relationReusedPairs: reused, ...(invalidated === undefined ? {} : { relationInvalidatedPairs: invalidated }) } })
          await tx.artworkDedupRun.update({ where: { id: run.id }, data: { performanceSummary: reusedSummary as unknown as Prisma.InputJsonValue } })
          await progress(context, tx, run, checkpoint, reusedSummary)
        })
        if (reusedSummary !== summary) { summary = reusedSummary; context.onPerformance?.(summary) }
        if (checkpoint.phase as string === 'QUERY') {
          const changedCount = await read(tx => tx.artworkDedupItem.count({ where: { runId: run.id, status: 'COMPLETE', visualReuseSignature: null } }))
          if (!changedCount) {
            checkpoint.phase = 'PUBLISH'; checkpoint.queryCompleted = checkpoint.queryTotal
            const next = advanceArtworkDedupPerformance(summary, { updatedAt: new Date().toISOString(), phase: 'PUBLISH', progress: { queryCompleted: checkpoint.queryTotal } })
            await context.transaction(async tx => {
              const current = await assertArtworkDedupExecution(tx, context.execution)
              await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualCheckpoint: checkpoint, performanceSummary: next as unknown as Prisma.InputJsonValue } })
              await progress(context, tx, current, checkpoint, next)
            })
            summary = next; context.onPerformance?.(summary)
          }
        }
      } else if (checkpoint.phase === 'QUERY') {
        const worker = context.searchWorker!
        if (!built) {
          let after = 0
          for (;;) {
            throwIfAborted(context.signal)
            const rows = await read(tx => tx.artworkDedupMedia.findMany({ where: { runId: run.id, visualStatus: 'READY', imageId: { gt: after }, item: { visualSignature: { not: null } } }, orderBy: { imageId: 'asc' }, take: 500, include: { item: { select: { visualReuseSignature: true } } } }))
            if (!rows.length) break
            await worker.load(rows.map(row => ({ imageId: row.imageId, artworkId: row.artworkId, views: row.visualViews, reused: row.item.visualReuseSignature !== null })) as unknown as SearchPage[])
            after = rows.at(-1)!.imageId
          }
          const result = await worker.build(); built = true
          if (context.searchCache) context.searchCache.built = true
          await saveSummary({ updatedAt: new Date().toISOString(), phase: 'VISUAL', inputDigest: run.visualInputDigest,
            counters: { indexRebuilds: 1 }, durationsMs: { index: result.indexMs }, memoryPeakBytes: result.memoryPeakBytes })
        }
        const start = performance.now()
        const work = await context.searchWorker!.batch(checkpoint, VISUAL_LIMITS.comparisons - (run.visualComparedComparisons - run.visualRoundStartComparisons))
        throwIfAborted(context.signal)
        const nextCheckpoint = { ...checkpoint, ...work.cursor, ...(work.complete ? { phase: 'PAIR' as const } : {}) }
        const next = advanceArtworkDedupPerformance(summary, { updatedAt: new Date().toISOString(), phase: work.complete ? 'PAIR' : 'VISUAL',
          progress: { queryCompleted: work.cursor.queryCompleted, queryTotal: checkpoint.queryTotal },
          counters: { indexNodeVisits: work.nodeVisits, wholeChannelHits: work.globalHits, localChannelHits: work.localHits, candidatePairs: work.candidates, compareCalls: work.comparisons, ...(work.replayedQueries === null ? {} : { replayedQueries: work.replayedQueries }) }, durationsMs: { compare: work.compareMs, query: performance.now() - start } })
        await context.transaction(async tx => {
          const current = await assertArtworkDedupExecution(tx, context.execution)
          await guard(tx, current, work.artworkIds)
          const additions = new Map<string, { leftArtworkId: number; rightArtworkId: number; edges: number[][] }>()
          for (const [leftArtworkId, rightArtworkId, a, b] of work.edges) {
            const key = `${leftArtworkId}:${rightArtworkId}`, entry = additions.get(key) ?? { leftArtworkId, rightArtworkId, edges: [] }
            entry.edges.push([a, b]); additions.set(key, entry)
          }
          if (additions.size) {
            const existing = await tx.artworkDedupVisualCandidate.findMany({ where: { runId: run.id }, select: { leftArtworkId: true, rightArtworkId: true, edges: true } })
            const byKey = new Map(existing.map(row => [`${row.leftArtworkId}:${row.rightArtworkId}`, row]))
            if (existing.length + [...additions.keys()].filter(key => !byKey.has(key)).length > VISUAL_LIMITS.artworkPairs) throw new VisualBudget('VISUAL_PAIR_BUDGET')
            for (const [key, entry] of additions) if (((byKey.get(key)?.edges as unknown[] | null)?.length ?? 0) + entry.edges.length > VISUAL_LIMITS.edgesPerPair) throw new VisualBudget('VISUAL_EDGE_BUDGET')
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO "ArtworkDedupVisualCandidate" ("runId","leftArtworkId","rightArtworkId",edges,reused)
              VALUES ${Prisma.join([...additions.values()].map(e => Prisma.sql`(${run.id},${e.leftArtworkId},${e.rightArtworkId},${JSON.stringify(e.edges)}::jsonb,false)`))}
              ON CONFLICT ("runId","leftArtworkId","rightArtworkId") DO UPDATE SET edges="ArtworkDedupVisualCandidate".edges || EXCLUDED.edges`)
          }
          throwIfAborted(context.signal)
          await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualCheckpoint: nextCheckpoint, visualComparedComparisons: { increment: work.comparisons }, visualBudgetWaiting: work.budgetWaiting, performanceSummary: next as unknown as Prisma.InputJsonValue } })
          await progress(context, tx, { ...current, visualBudgetWaiting: work.budgetWaiting }, nextCheckpoint, next)
        })
        Object.assign(checkpoint, nextCheckpoint); summary = next
        context.onPerformance?.(summary)
      } else if (checkpoint.phase === 'PAIR') {
        const started = performance.now()
        let next = summary
        await pairCandidate(context, run, checkpoint, async tx => {
          next = advanceArtworkDedupPerformance(summary, { updatedAt: new Date().toISOString(), phase: checkpoint.phase === 'PUBLISH' ? 'PUBLISH' : 'PAIR', durationsMs: { pair: performance.now() - started } })
          await tx.artworkDedupRun.update({ where: { id: run.id }, data: { performanceSummary: next as unknown as Prisma.InputJsonValue } })
          await progress(context, tx, run, checkpoint, next)
        })
        summary = next; context.onPerformance?.(summary)
      } else {
        await publish(context, run)
        await saveSummary({ updatedAt: new Date().toISOString(), phase: 'PUBLISH', complete: false, progress: { queryCompleted: checkpoint.queryCompleted } })
        return true
      }
      if (context.shouldYield()) return false
    }
  } catch (error) {
    if (!(error instanceof VisualBudget) && !(error instanceof Error && error.message === 'VISUAL_INDEX_MEMORY_BUDGET')) throw error
    await context.transaction(async tx => {
      const current = await assertArtworkDedupExecution(tx, context.execution)
      await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id, relationKind: 'VISUAL' } })
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: 'INCOMPLETE', visualSearchComplete: false, visualBudgetWaiting: false, visualIncompleteReasons: [...new Set([...current.visualIncompleteReasons, error instanceof VisualBudget ? error.reason : error.message])] } })
    })
    return true
  }
}
