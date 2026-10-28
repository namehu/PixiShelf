import { setImmediate } from 'node:timers/promises'
import { z } from 'zod'
import {
  Prisma, assertArtworkDedupExecution, assertArtworkDedupItemCurrent, assertArtworkContentSnapshot,
  assertArtworkDedupCacheDirectories, assertArtworkDedupVisualItems, artworkDedupRepresentativeSql, lockArtworkDedupRelationCache
} from '@pixishelf/db'
import { MediaContentFileError } from '../media-content/roots.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import type { DedupPipelineContext } from './pipeline.ts'
import { prepareVisualVersions } from './visual-pipeline.ts'
import { visualRelationSignature } from './relation-cache.ts'
import { VisualViewIndex } from './visual-experiment.ts'
import { QueryDirectoryScope } from './root-directory-scope.ts'
import { readCandidatePostings } from './candidate-postings.ts'
import { VISUAL_LIMITS, VISUAL_ALGORITHM_VERSION, validVisualViews, compareProductionVisual, assignVisualPair, type VisualPage, type VisualPairEvidence } from './visual-matching.ts'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const checkpointSchema = z.object({ version: z.literal(1), phase: z.enum(['INDEX', 'REUSE', 'QUERY', 'PAIR', 'PUBLISH']),
  indexAfter: integer, queryAfter: integer, candidateAfter: integer, queryImageId: integer, queryCandidates: z.array(integer).max(VISUAL_LIMITS.queryCandidates), pairLeft: integer, pairRight: integer, postings: integer, reuseInitialized: z.boolean(), reuseBaseId: z.string().nullable(), reuseAfter: integer })
type Checkpoint = z.infer<typeof checkpointSchema>
const initialCheckpoint: Checkpoint = { version: 1, phase: 'INDEX', indexAfter: 0, queryAfter: 0, candidateAfter: 0, queryImageId: 0, queryCandidates: [], pairLeft: 0, pairRight: 0, postings: 0, reuseInitialized: false, reuseBaseId: null, reuseAfter: 0 }
const edgeSchema = z.array(z.tuple([integer, integer])).max(VISUAL_LIMITS.edgesPerPair)
const evidenceSchema = z.array(z.object({ kind: z.enum(['EXACT', 'SIMILAR', 'UNMATCHED']), left: integer.nullable(), right: integer.nullable() })).max(VISUAL_LIMITS.artworkFiles * 2)
const keyIndex = new VisualViewIndex()
type Tx = Prisma.TransactionClient
type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>
class VisualBudget extends Error { constructor(readonly reason: string) { super(reason) } }
const fail = (reason: string): never => { throw new VisualBudget(reason) }
const changed = (): never => { throw new MediaContentFileError('FILE_CHANGED', 'Visual work input changed') }

async function guardArtworks(tx: Tx, context: DedupPipelineContext, artworkIds: number[], directories?: QueryDirectoryScope) {
  const ids = [...new Set(artworkIds)].sort((a, b) => a - b)
  if (!(await (directories ? directories.assert(tx, ids) : assertArtworkDedupCacheDirectories(tx, context.execution.runId, ids)))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
  if (!(await assertArtworkDedupVisualItems(tx, context.execution, ids))) changed()
}

async function save(tx: Tx, runId: string, checkpoint: Checkpoint) {
  await tx.artworkDedupRun.update({ where: { id: runId }, data: { visualCheckpoint: checkpoint } })
}
async function artworkPages(tx: Tx, runId: string, artworkId: number): Promise<VisualPage[]> {
  const rows = await tx.artworkDedupMedia.findMany({ where: { runId, artworkId }, orderBy: { imageId: 'asc' }, take: VISUAL_LIMITS.artworkFiles + 1 })
  if (rows.length > VISUAL_LIMITS.artworkFiles) return fail('VISUAL_ARTWORK_BUDGET')
  if (rows.some(r => r.visualStatus !== 'READY' || !r.sha256 || !validVisualViews(r.visualViews))) return []
  const images = await tx.image.findMany({ where: { id: { in: rows.map(r => r.imageId) } }, select: { id: true, sortOrder: true } })
  if (images.length !== rows.length) changed()
  const order = new Map(images.map(i => [i.id, i.sortOrder]))
  rows.sort((a, b) => order.get(a.imageId)! - order.get(b.imageId)! || a.imageId - b.imageId)
  return rows.map((r, index) => ({ imageId: r.imageId, artworkId, index, size: r.size, sha256: r.sha256!, views: r.visualViews as unknown as VisualPage['views'] }))
}
function encodeEvidence(pair: VisualPairEvidence): Prisma.InputJsonValue {
  return pair.pages.map(p => ({ kind: p.kind, left: p.left?.imageId ?? null, right: p.right?.imageId ?? null }))
}
function decodeEvidence(value: unknown, left: VisualPage[], right: VisualPage[]): VisualPairEvidence | null {
  const parsed = evidenceSchema.safeParse(value)
  if (!parsed.success || !left.length || !right.length) return null
  const a = new Map(left.map(p => [p.imageId, p])), b = new Map(right.map(p => [p.imageId, p]))
  const seenA = new Set<number>(), seenB = new Set<number>(), pages: VisualPairEvidence['pages'] = []
  for (const row of parsed.data) {
    const l = row.left === null ? null : a.get(row.left), r = row.right === null ? null : b.get(row.right)
    if (l === undefined || r === undefined || !l && !r || l && seenA.has(l.imageId) || r && seenB.has(r.imageId) ||
      (row.kind === 'UNMATCHED' ? !!l === !!r : !l || !r) || row.kind === 'EXACT' && (l!.size !== r!.size || l!.sha256 !== r!.sha256)) return null
    if (l) seenA.add(l.imageId)
    if (r) seenB.add(r.imageId)
    pages.push({ kind: row.kind, left: l, right: r })
  }
  const paired = pages.filter(p => p.kind !== 'UNMATCHED').length
  if (seenA.size !== left.length || seenB.size !== right.length || paired / Math.min(left.length, right.length) < 0.8 || !pages.some(p => p.kind === 'SIMILAR')) return null
  return { leftArtworkId: left[0]!.artworkId, rightArtworkId: right[0]!.artworkId, pages }
}
async function yieldCheck(context: DedupPipelineContext) {
  throwIfAborted(context.signal)
  await setImmediate()
  await context.transaction(tx => assertArtworkDedupExecution(tx, context.execution))
}

async function indexArtwork(context: DedupPipelineContext, run: Run, checkpoint: Checkpoint) {
  await context.transaction(async tx => {
    await assertArtworkDedupExecution(tx, context.execution)
    const item = await tx.artworkDedupItem.findFirst({ where: { runId: run.id, status: 'COMPLETE', artworkId: { gt: checkpoint.indexAfter } }, orderBy: { artworkId: 'asc' } })
    if (!item) { checkpoint.phase = 'REUSE'; await save(tx, run.id, checkpoint); return }
    await guardArtworks(tx, context, [item.artworkId])
    const unchecked = await tx.artworkDedupMedia.count({ where: { runId: run.id, artworkId: item.artworkId, visualStatus: { not: 'READY' } } })
    const pages = unchecked ? [] : await artworkPages(tx, run.id, item.artworkId)
    if (pages.length) {
      const rows = pages.flatMap(page => {
        const keys = new Map<string, number>()
        for (const key of keyIndex.keys(page.views)) keys.set(key, (keys.get(key) ?? 0) + 1)
        return [...keys].map(([key, multiplicity]) => ({ runId: run.id, key, imageId: page.imageId, multiplicity }))
      })
      checkpoint.postings += rows.reduce((sum, row) => sum + row.multiplicity, 0)
      if (checkpoint.postings > VISUAL_LIMITS.postings) fail('VISUAL_INDEX_BUDGET')
      for (let start = 0; start < rows.length; start += 1000) {
        throwIfAborted(context.signal)
        await tx.artworkDedupVisualPosting.createMany({ data: rows.slice(start, start + 1000) })
      }
      await tx.artworkDedupItem.update({ where: { runId_artworkId: { runId: run.id, artworkId: item.artworkId } }, data: { visualSignature: visualRelationSignature(pages) } })
    }
    throwIfAborted(context.signal)
    checkpoint.indexAfter = item.artworkId
    await save(tx, run.id, checkpoint)
  })
}

/** A fixed historical parent is locked per copied pair. Negative reuse is enabled
 * only after every candidate is materialized; history loss falls back to this run's index. */
async function snapshotReuse(context: DedupPipelineContext, run: Run, checkpoint: Checkpoint) {
  await context.transaction(async tx => {
    await assertArtworkDedupExecution(tx, context.execution)
    const miss = async () => {
      await tx.artworkDedupVisualCandidate.deleteMany({ where: { runId: run.id } })
      await tx.artworkDedupItem.updateMany({ where: { runId: run.id }, data: { visualReuseSignature: null } })
      checkpoint.phase = 'QUERY'; checkpoint.reuseBaseId = null
      await save(tx, run.id, checkpoint)
    }
    if (!checkpoint.reuseInitialized) {
      checkpoint.reuseInitialized = true
      checkpoint.reuseBaseId = context.forceRead ? null : await lockArtworkDedupRelationCache(tx, run, true)
      if (!checkpoint.reuseBaseId) { await miss(); return }
      const baseId = checkpoint.reuseBaseId
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ArtworkDedupItem" current SET "visualReuseSignature"=old."visualSignature"
        FROM "ArtworkDedupItem" old WHERE current."runId"=${run.id} AND old."runId"=${baseId}
          AND current."artworkId"=old."artworkId" AND current."visualSignature"=old."visualSignature"
          AND (${artworkDedupRepresentativeSql(baseId, Prisma.sql`old."artworkId"`)} = ${artworkDedupRepresentativeSql(run.id, Prisma.sql`current."artworkId"`)})`)
      throwIfAborted(context.signal)
      await save(tx, run.id, checkpoint)
      return
    }
    const baseId = checkpoint.reuseBaseId
    if (!baseId) { await miss(); return }
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "ArtworkDedupRun" WHERE id=${baseId} AND status='COMPLETED' AND "visualStatus"='COMPLETE' FOR SHARE`)
    if (!locked.length) { await miss(); return }
    const old = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: baseId }, select: { visualCandidatePairs: true } })
    const keys = old.visualCandidatePairs
    if (keys.length > VISUAL_LIMITS.artworkPairs || keys.some(key => !/^[1-9]\d*:[1-9]\d*$/.test(key)) || new Set(keys).size !== keys.length) { await miss(); return }
    const key = keys[checkpoint.reuseAfter]
    if (key === undefined) { checkpoint.phase = 'QUERY'; await save(tx, run.id, checkpoint); return }
    const [leftArtworkId, rightArtworkId] = key.split(':').map(Number) as [number, number]
    if (!Number.isSafeInteger(leftArtworkId) || !Number.isSafeInteger(rightArtworkId) || leftArtworkId >= rightArtworkId) { await miss(); return }
    if (await tx.artworkDedupItem.count({ where: { runId: run.id, artworkId: { in: [leftArtworkId, rightArtworkId] }, visualReuseSignature: { not: null } } }) === 2) {
      await guardArtworks(tx, context, [leftArtworkId, rightArtworkId])
      const oldPair = await tx.artworkDedupVisualPair.findFirst({ where: { runId: baseId, relationKind: 'VISUAL', leftArtworkId, rightArtworkId }, include: { pages: { orderBy: { ordinal: 'asc' }, take: VISUAL_LIMITS.artworkFiles * 2 + 1 } } })
      let evidence: Prisma.InputJsonValue | undefined
      if (oldPair) {
        const left = await artworkPages(tx, run.id, leftArtworkId), right = await artworkPages(tx, run.id, rightArtworkId)
        const decoded = decodeEvidence(oldPair.pages.map(p => ({ kind: p.kind, left: p.leftImageId, right: p.rightImageId })), left, right)
        if (!decoded) { await miss(); return }
        evidence = encodeEvidence(decoded)
      }
      await tx.artworkDedupVisualCandidate.create({ data: { runId: run.id, leftArtworkId, rightArtworkId, reused: true, ...(evidence ? { evidence } : {}) } })
    }
    checkpoint.reuseAfter++
    throwIfAborted(context.signal)
    await save(tx, run.id, checkpoint)
  })
}

const QUERY_GROUP_QUERIES = 8
const QUERY_GROUP_CANDIDATES = 50
const QUERY_GROUP_ARTWORKS = 51
const QUERY_GROUP_ASSEMBLY_MS = 100

/** Only run-local reads share this fence. Comparison remains outside it, and
 * the commit independently guards every accepted query/candidate artwork. */
async function readQuery(tx: Tx, context: DedupPipelineContext, run: Run, checkpoint: Checkpoint) {
  const started = performance.now()
  const pages = await tx.artworkDedupMedia.findMany({ where: { runId: run.id, imageId: checkpoint.queryImageId ? { gte: checkpoint.queryImageId } : { gt: checkpoint.queryAfter }, item: { visualSignature: { not: null } } }, orderBy: { imageId: 'asc' }, take: QUERY_GROUP_QUERIES, include: { item: { select: { visualReuseSignature: true } } } })
  if (checkpoint.queryImageId && pages[0]?.imageId !== checkpoint.queryImageId) changed()
  if (!pages.length) return null
  type Page = (typeof pages)[number]
  const plans: Array<{ page: Page; allIds: number[]; ids: number[]; blockIds: number[] }> = []
  let remaining = QUERY_GROUP_CANDIDATES
  for (const page of pages) {
    throwIfAborted(context.signal)
    if (plans.length && (performance.now() - started >= QUERY_GROUP_ASSEMBLY_MS || context.shouldYield())) break
    if (!validVisualViews(page.visualViews)) return changed()
    let allIds: number[]
    if (page.imageId === checkpoint.queryImageId) allIds = checkpoint.queryCandidates
    else {
      const keys = [...new Set(keyIndex.keys(page.visualViews))]
      const postings = await readCandidatePostings(tx, run.id, keys)
      const reason = postings.reduce((total, row) => total + row.multiplicity, 0) > VISUAL_LIMITS.queryPostings ? 'VISUAL_POSTING_BUDGET' : null
      allIds = [...new Set(postings.map(p => p.imageId))].sort((a, b) => a - b)
      const budget = reason ?? (allIds.length > VISUAL_LIMITS.queryCandidates ? 'VISUAL_CANDIDATE_BUDGET' : null)
      if (budget) {
        // Commit the earlier valid queries first. This page is read again and
        // reports its intrinsic budget failure without losing that prefix.
        if (plans.length) break
        fail(budget)
      }
    }
    const ids = page.imageId === checkpoint.queryImageId ? allIds.filter(id => id > checkpoint.candidateAfter) : allIds
    const blockIds = ids.slice(0, remaining)
    plans.push({ page, allIds, ids, blockIds })
    remaining -= blockIds.length
    if (!remaining) break
  }
  const ids = [...new Set(plans.flatMap(plan => plan.blockIds))]
  const candidates = ids.length ? await tx.artworkDedupMedia.findMany({ where: { runId: run.id, imageId: { in: ids } }, orderBy: { imageId: 'asc' }, include: { item: { select: { visualReuseSignature: true } } } }) : []
  if (candidates.length !== ids.length) changed()
  const byId = new Map(candidates.map(candidate => [candidate.imageId, candidate]))
  const artworks = new Set<number>()
  const blocks: Array<{ page: Page; candidates: Page[]; allIds: number[]; before: Checkpoint; checkpoint: Checkpoint }> = []
  let cursor = { ...checkpoint }
  for (const plan of plans) {
    if (!artworks.has(plan.page.artworkId) && artworks.size === QUERY_GROUP_ARTWORKS) break
    artworks.add(plan.page.artworkId)
    const accepted: Page[] = []
    for (const id of plan.blockIds) {
      const candidate = byId.get(id)!
      if (!artworks.has(candidate.artworkId) && artworks.size === QUERY_GROUP_ARTWORKS) break
      artworks.add(candidate.artworkId)
      accepted.push(candidate)
    }
    const before = cursor
    if (accepted.length === plan.ids.length) cursor = { ...cursor, queryAfter: plan.page.imageId, candidateAfter: 0, queryImageId: 0, queryCandidates: [] }
    else cursor = { ...cursor, queryImageId: plan.page.imageId, queryCandidates: plan.allIds, candidateAfter: accepted.at(-1)?.imageId ?? (plan.page.imageId === checkpoint.queryImageId ? checkpoint.candidateAfter : 0) }
    blocks.push({ page: plan.page, candidates: accepted, allIds: plan.allIds, before, checkpoint: cursor })
    if (cursor.queryImageId) break
  }
  return blocks
}

async function queryPage(context: DedupPipelineContext, run: Run, checkpoint: Checkpoint, queries: Awaited<ReturnType<typeof readQuery>>, directories: QueryDirectoryScope) {
  if (!queries) {
    checkpoint.phase = 'PAIR'
    await context.transaction(async tx => { await assertArtworkDedupExecution(tx, context.execution); await save(tx, run.id, checkpoint) })
    return
  }
  type Addition = { leftArtworkId: number; rightArtworkId: number; edges: Array<[number, number]> }
  const processed: Array<{ query: NonNullable<typeof queries>[number]; additions: Map<string, Addition>; reused: number; compared: number; budgetWaiting: boolean }> = []
  let reused = 0, compared = 0
  for (const query of queries) {
    if (processed.length && context.shouldYield()) break
    const blockAdditions = new Map<string, Addition>()
    let blockReused = 0, blockCompared = 0, accepted = 0
    let budgetWaiting = false
    try {
      for (const b of query.candidates) {
        throwIfAborted(context.signal)
        if (query.page.artworkId >= b.artworkId) { accepted++; continue }
        if (run.visualReusedComparisons + run.visualComparedComparisons - run.visualRoundStartComparisons + reused + compared + blockReused + blockCompared >= VISUAL_LIMITS.comparisons) {
          if (!run.visualComparisonRound) fail('VISUAL_COMPARISON_BUDGET')
          budgetWaiting = true
          break
        }
        accepted++
        if (query.page.item.visualReuseSignature && b.item.visualReuseSignature) { blockReused++; continue }
        blockCompared++
        if (!validVisualViews(b.visualViews)) changed()
        if (!compareProductionVisual(query.page.visualViews as unknown as VisualPage['views'], b.visualViews as unknown as VisualPage['views']).matched) continue
        const key = `${query.page.artworkId}:${b.artworkId}`
        const entry = blockAdditions.get(key) ?? { leftArtworkId: query.page.artworkId, rightArtworkId: b.artworkId, edges: [] }
        entry.edges.push([query.page.imageId, b.imageId]); blockAdditions.set(key, entry)
      }
    } catch (error) {
      if (error instanceof VisualBudget && processed.length) break
      throw error
    }
    compared += blockCompared; reused += blockReused
    const prefix = budgetWaiting ? { ...query, candidates: query.candidates.slice(0, accepted), checkpoint: {
      ...query.before, queryImageId: query.page.imageId, queryCandidates: query.allIds,
      candidateAfter: query.candidates[accepted - 1]?.imageId ?? (query.before.queryImageId === query.page.imageId ? query.before.candidateAfter : 0)
    } } : query
    processed.push({ query: prefix, additions: blockAdditions, compared: blockCompared, reused: blockReused, budgetWaiting })
    if (budgetWaiting) break
  }
  const combine = (blocks: typeof processed) => {
    const additions = new Map<string, Addition>(), artworkIds = new Set<number>()
    let compared = 0, reused = 0
    for (const block of blocks) {
      for (const [key, entry] of block.additions) {
        const existing = additions.get(key)
        if (existing) existing.edges.push(...entry.edges)
        else additions.set(key, { ...entry, edges: [...entry.edges] })
      }
      compared += block.compared; reused += block.reused
      artworkIds.add(block.query.page.artworkId)
      for (const candidate of block.query.candidates) artworkIds.add(candidate.artworkId)
    }
    return { additions, artworkIds: [...artworkIds], compared, reused, checkpoint: blocks.at(-1)!.query.checkpoint, budgetWaiting: blocks.at(-1)!.budgetWaiting }
  }
  throwIfAborted(context.signal)
  await setImmediate()
  throwIfAborted(context.signal)
  await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    let work = combine(processed)
    const existing = work.additions.size ? await tx.artworkDedupVisualCandidate.findMany({ where: { runId: run.id, OR: [...work.additions.values()].map(({ leftArtworkId, rightArtworkId }) => ({ leftArtworkId, rightArtworkId })) } }) : []
    const byPair = new Map(existing.map(candidate => [`${candidate.leftArtworkId}:${candidate.rightArtworkId}`, candidate]))
    if ([...work.additions.keys()].some(key => !byPair.has(key))) {
      const count = await tx.artworkDedupVisualCandidate.count({ where: { runId: run.id } })
      const newPairs = new Set<string>()
      let accepted = 0
      for (const block of processed) {
        for (const key of block.additions.keys()) if (!byPair.has(key)) newPairs.add(key)
        if (count + newPairs.size > VISUAL_LIMITS.artworkPairs) {
          if (!accepted) fail('VISUAL_PAIR_BUDGET')
          break
        }
        accepted++
      }
      if (accepted < processed.length) work = combine(processed.slice(0, accepted))
    }
    await guardArtworks(tx, context, work.artworkIds, directories)
    const missing = [...work.additions].filter(([key]) => !byPair.has(key)).map(([, entry]) => ({ runId: run.id, ...entry }))
    if (missing.length) await tx.artworkDedupVisualCandidate.createMany({ data: missing })
    for (const candidate of existing) {
      const entry = work.additions.get(`${candidate.leftArtworkId}:${candidate.rightArtworkId}`)
      if (!entry) continue
      const previous = edgeSchema.parse(candidate.edges)
      if (previous.length + entry.edges.length > VISUAL_LIMITS.edgesPerPair) fail(run.visualComparisonRound ? 'VISUAL_EDGE_BUDGET' : 'VISUAL_COMPARISON_BUDGET')
      await tx.artworkDedupVisualCandidate.update({ where: { runId_leftArtworkId_rightArtworkId: { runId: run.id, leftArtworkId: candidate.leftArtworkId, rightArtworkId: candidate.rightArtworkId } }, data: { edges: [...previous, ...entry.edges] } })
    }
    Object.assign(checkpoint, work.checkpoint)
    throwIfAborted(context.signal)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualCheckpoint: checkpoint, visualBudgetWaiting: work.budgetWaiting,
      visualReusedComparisons: latest.visualReusedComparisons + work.reused, visualComparedComparisons: latest.visualComparedComparisons + work.compared } })
  })
}

async function pairCandidate(context: DedupPipelineContext, run: Run, checkpoint: Checkpoint) {
  const work = await context.transaction(async tx => {
    await assertArtworkDedupExecution(tx, context.execution)
    const candidate = await tx.artworkDedupVisualCandidate.findFirst({ where: { runId: run.id, OR: [
      { leftArtworkId: { gt: checkpoint.pairLeft } }, { leftArtworkId: checkpoint.pairLeft, rightArtworkId: { gt: checkpoint.pairRight } }
    ] }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }] })
    if (!candidate) return null
    const left = await artworkPages(tx, run.id, candidate.leftArtworkId), right = await artworkPages(tx, run.id, candidate.rightArtworkId)
    if (!left.length || !right.length) changed()
    return { candidate, left, right }
  })
  if (!work) checkpoint.phase = 'PUBLISH'
  else {
    const { candidate, left, right } = work
    const edges = new Map<number, Set<number>>()
    for (const [a, b] of edgeSchema.parse(candidate.edges)) { const ids = edges.get(a) ?? new Set<number>(); ids.add(b); edges.set(a, ids) }
    const pair = candidate.reused ? candidate.evidence === null ? null : decodeEvidence(candidate.evidence, left, right) : assignVisualPair(left, right, edges)
    if (candidate.reused && candidate.evidence !== null && !pair) changed()
    await yieldCheck(context)
    await context.transaction(async tx => {
      await assertArtworkDedupExecution(tx, context.execution)
      await guardArtworks(tx, context, [candidate.leftArtworkId, candidate.rightArtworkId])
      await tx.artworkDedupVisualCandidate.update({ where: { runId_leftArtworkId_rightArtworkId: { runId: run.id, leftArtworkId: candidate.leftArtworkId, rightArtworkId: candidate.rightArtworkId } }, data: { evidence: pair ? encodeEvidence(pair) : Prisma.DbNull } })
      checkpoint.pairLeft = candidate.leftArtworkId; checkpoint.pairRight = candidate.rightArtworkId
      throwIfAborted(context.signal)
      await save(tx, run.id, checkpoint)
    })
    return
  }
  await context.transaction(async tx => { await assertArtworkDedupExecution(tx, context.execution); await save(tx, run.id, checkpoint) })
}

async function publishPair(tx: Tx, runId: string, pair: VisualPairEvidence) {
  const { leftArtworkId, rightArtworkId } = pair
  const original = await tx.artworkDedupRelation.findFirst({ where: { runId, OR: [
    { containedArtworkId: leftArtworkId, containerArtworkId: rightArtworkId }, { containedArtworkId: rightArtworkId, containerArtworkId: leftArtworkId }
  ] }, select: { id: true } })
  if (original || await tx.artworkDedupVisualPair.findUnique({ where: { runId_leftArtworkId_rightArtworkId: { runId, leftArtworkId, rightArtworkId } } })) return
  pair.pages.sort((a, b) => (a.left?.index ?? Infinity) - (b.left?.index ?? Infinity) || (a.right?.index ?? Infinity) - (b.right?.index ?? Infinity))
  const left = pair.pages.filter(p => p.left).length, right = pair.pages.filter(p => p.right).length
  const exact = pair.pages.filter(p => p.kind === 'EXACT').length, similar = pair.pages.filter(p => p.kind === 'SIMILAR').length
  const id = `visual:${runId}:${leftArtworkId}:${rightArtworkId}`
  const summary = { evidenceVersion: VISUAL_ALGORITHM_VERSION, leftArtworkId, rightArtworkId,
    leftFileCount: String(left), rightFileCount: String(right), pairedCount: String(exact + similar), exactCount: String(exact), similarCount: String(similar),
    leftUnmatchedCount: String(left - exact - similar), rightUnmatchedCount: String(right - exact - similar), leftUncheckedCount: '0', rightUncheckedCount: '0' }
  await tx.artworkDedupVisualPair.create({ data: { id, runId, leftArtworkId, rightArtworkId, summary } })
  for (let start = 0; start < pair.pages.length; start += 100) await tx.artworkDedupVisualPage.createMany({ data: pair.pages.slice(start, start + 100).map((p, i) => ({ pairId: id, ordinal: start + i + 1, kind: p.kind, leftImageId: p.left?.imageId ?? null, rightImageId: p.right?.imageId ?? null, leftIndex: p.left?.index ?? null, rightIndex: p.right?.index ?? null })) })
}
async function publish(context: DedupPipelineContext, run: Run) {
  await context.transaction(async tx => {
    const latest = await assertArtworkDedupExecution(tx, context.execution)
    if (!(await assertArtworkDedupCacheDirectories(tx, run.id))) throw new MediaContentFileError('ROOT_CHANGED', 'Visual directory changed')
    let after = 0
    for (;;) {
      const items = await tx.artworkDedupItem.findMany({ where: { runId: run.id, status: 'COMPLETE', artworkId: { gt: after } }, orderBy: { artworkId: 'asc' }, take: 100 })
      if (!items.length) break
      for (const item of items) {
        throwIfAborted(context.signal)
        if (!(await assertArtworkDedupItemCurrent(tx, { execution: context.execution, artworkId: item.artworkId })) || item.snapshotRevision === null || item.mediaEpoch === null || item.memberCount === null ||
          (await assertArtworkContentSnapshot(tx, { snapshot: { artworkId: item.artworkId, revision: item.snapshotRevision, mediaEpoch: item.mediaEpoch, memberCount: item.memberCount } })).status !== 'READY') changed()
      }
      after = items.at(-1)!.artworkId
    }
    await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id, relationKind: 'VISUAL' } })
    const keys: string[] = []
    let left = 0, right = 0
    for (;;) {
      const candidate = await tx.artworkDedupVisualCandidate.findFirst({ where: { runId: run.id, OR: [{ leftArtworkId: { gt: left } }, { leftArtworkId: left, rightArtworkId: { gt: right } }] }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }] })
      if (!candidate) break
      if (keys.length >= VISUAL_LIMITS.artworkPairs) fail('VISUAL_PAIR_BUDGET')
      keys.push(`${candidate.leftArtworkId}:${candidate.rightArtworkId}`)
      if (candidate.evidence !== null) {
        const a = await artworkPages(tx, run.id, candidate.leftArtworkId), b = await artworkPages(tx, run.id, candidate.rightArtworkId)
        const pair = decodeEvidence(candidate.evidence, a, b)
        if (!pair) changed()
        await publishPair(tx, run.id, pair!)
      }
      left = candidate.leftArtworkId; right = candidate.rightArtworkId
      throwIfAborted(context.signal)
    }
    const failed = await tx.artworkDedupItem.count({ where: { runId: run.id, status: { not: 'COMPLETE' } } })
    const excluded = await tx.artworkDedupItem.count({ where: { runId: run.id, status: 'COMPLETE', visualSignature: null } })
    const reasons = [...new Set([...latest.visualIncompleteReasons, ...(excluded ? ['UNSUPPORTED_MEDIA'] : []), ...(failed ? ['INCOMPLETE_ORIGINALS'] : [])])]
    throwIfAborted(context.signal)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: reasons.length ? 'INCOMPLETE' : 'COMPLETE', visualIncompleteReasons: reasons, visualCandidatePairs: keys } })
  })
}

/** v5 retains terminal budgets; v6 persists explicit per-round permission.
 * The optional file limit is an internal fixture seam, never an App input. */
export async function scanBatchedVisualVersions(context: DedupPipelineContext, fileLimit: number = VISUAL_LIMITS.files, comparisonRounds = false): Promise<boolean> {
  if (!(await prepareVisualVersions(context, fileLimit))) return false
  const queryDirectories = new QueryDirectoryScope(context.execution)
  try {
    for (;;) {
      throwIfAborted(context.signal)
      const work = await context.transaction(async tx => {
        let run = await assertArtworkDedupExecution(tx, context.execution)
        if (!run.includeSuspectedVersions || run.visualStatus === 'COMPLETE' || run.visualStatus === 'INCOMPLETE' && run.stage === 'DONE') return null
        if (run.visualBudgetWaiting) return 'WAITING' as const
        if (comparisonRounds && !run.visualComparisonRound) {
          run = await tx.artworkDedupRun.update({ where: { id: run.id }, data: { visualComparisonRound: 1 } })
        }
        const checkpoint = run.visualCheckpoint === null ? { ...initialCheckpoint } : checkpointSchema.parse(run.visualCheckpoint)
        return { run, checkpoint, query: checkpoint.phase === 'QUERY' ? await readQuery(tx, context, run, checkpoint) : null }
      })
      if (!work) return true
      if (work === 'WAITING') return false
      const { run, checkpoint, query } = work
      if (checkpoint.phase === 'INDEX') await indexArtwork(context, run, checkpoint)
      else if (checkpoint.phase === 'REUSE') await snapshotReuse(context, run, checkpoint)
      else if (checkpoint.phase === 'QUERY') await queryPage(context, run, checkpoint, query, queryDirectories)
      else if (checkpoint.phase === 'PAIR') await pairCandidate(context, run, checkpoint)
      else { await publish(context, run); return true }
      if (context.shouldYield()) return false
    }
  } catch (error) {
    if (!(error instanceof VisualBudget)) throw error
    await context.transaction(async tx => {
      const run = await assertArtworkDedupExecution(tx, context.execution)
      await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id, relationKind: 'VISUAL' } })
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { stage: 'DONE', visualStatus: 'INCOMPLETE', visualBudgetWaiting: false, visualIncompleteReasons: [...new Set([...run.visualIncompleteReasons, error.reason])] } })
    })
    return true
  }
}
