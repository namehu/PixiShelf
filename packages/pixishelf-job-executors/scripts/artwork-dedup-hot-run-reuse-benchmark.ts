import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient, freezeArtworkDedupRun } from '@pixishelf/db'
import { PostgresQueueRepository, TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME } from '@pixishelf/job-runtime'
import { createArtworkDedupExecutor } from '../src/artwork-dedup/executor.ts'

// Dated isolated-fixture driver; the identical file is overlaid onto both frozen sources.
async function main() {
  const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
  const action = process.argv[2] ?? 'measure',
    label = process.argv[3] ?? action
  assert.ok(['measure', 'enqueue'].includes(action))
  assert.match(label, /^[a-z0-9-]+$/)
  const definitionVersion = Number(process.env.HOT_RUN_DEFINITION_VERSION ?? 9)
  assert.ok([8, 9].includes(definitionVersion))
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '55432')
  assert.match(url.pathname, /^\/dedup_hot_reuse_(baseline|after|browser|restart)_20261030$/)
  const manifestPath = process.env.HOT_RUN_MANIFEST ?? path.join(base, 'manifest.json')
  assert.ok(manifestPath.startsWith(base + '/'))
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const stringify = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v))
  const digest = (value: unknown) => createHash('sha256').update(stringify(value)).digest('hex')
  let active = false,
    started = 0,
    apiCalls = 0,
    sqlStatements = 0,
    sqlDurationMs = 0,
    schedulingWaitMs = 0
  let sampledPeakRssBytes = 0
  const sqlGroups = new Map<string, { sql: string; count: number; durationMs: number }>()
  const apiGroups = new Map<string, number>()
  const observations: unknown[] = [],
    readerMeasurements: unknown[] = [],
    slices: unknown[] = []
  const transactionWrappers: any[] = [],
    committedMutationTimings: unknown[] = []
  const raw = new PrismaClient({ datasourceUrl: url.toString(), log: [{ emit: 'event', level: 'query' }] })
  raw.$on('query', (event) => {
    if (!active) return
    sqlStatements++
    sqlDurationMs += event.duration
    // Never retain event.params or a database URL.
    const sql = event.query
      .replace(/\$\d+/g, '?')
      .replace(/\s+/g, ' ')
      .replace(/\?(?:\s*,\s*\?)+/g, '?…')
      .trim()
    const key = digest(sql),
      group = sqlGroups.get(key) ?? { sql, count: 0, durationMs: 0 }
    group.count++
    group.durationMs += event.duration
    sqlGroups.set(key, group)
  })
  const observeRun = (row: any, source: string) => {
    if (!active || !row) return
    observations.push({
      atMs: performance.now() - started,
      source,
      stage: row.stage ?? null,
      phase: row.performanceSummary?.phase ?? row.visualCheckpoint?.phase ?? null,
      performanceSummary: row.performanceSummary ?? null
    })
  }
  const db = raw.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (active) {
          apiCalls++
          const key = (model ?? '$raw') + '.' + operation
          apiGroups.set(key, (apiGroups.get(key) ?? 0) + 1)
        }
        const result = await query(args)
        if (model === 'ArtworkDedupRun' && ['update', 'findUnique', 'findUniqueOrThrow'].includes(operation))
          observeRun(result, operation)
        return result
      }
    }
  })
  const repository = new PostgresQueueRepository(db as any, { transactionTimeoutMs: 20_000 })
  const capabilities = [
    {
      jobType: 'ARTWORK_DEDUP_SCAN' as const,
      executionLane: 'BACKGROUND_WRITER' as const,
      definitionVersions: [definitionVersion]
    }
  ]
  function context(job: any): any {
    const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
    const wrap = async (kind: 'mutation' | 'finalization', operation: any, observeTiming?: any) => {
      const began = performance.now(),
        record: any = {
          kind,
          beganMs: began - started,
          beforeBodyMs: null,
          bodyMs: null,
          afterBodyMs: null,
          wallMs: null,
          committed: false
        }
      transactionWrappers.push(record)
      let bodyEnded = 0
      const body = async (transaction: any) => {
        const bodyBegan = performance.now()
        record.beforeBodyMs = bodyBegan - began
        try {
          return await operation(transaction)
        } finally {
          bodyEnded = performance.now()
          record.bodyMs = bodyEnded - bodyBegan
        }
      }
      try {
        const timing = (value: any) => {
          committedMutationTimings.push({ atMs: performance.now() - started, ...value })
          observeTiming?.(value)
        }
        const result =
          kind === 'mutation'
            ? await (repository.withFencedMutationTransaction as any)(fence, body, timing)
            : await repository.withFencedExecutionTransaction(fence, body)
        record.committed = true
        return result
      } finally {
        const ended = performance.now()
        record.wallMs = ended - began
        if (bodyEnded) record.afterBodyMs = ended - bodyEnded
      }
    }
    return {
      job,
      payload: job.payload,
      signal: new AbortController().signal,
      progress: (update: any) => repository.updateProgress({ ...fence, ...update }),
      enqueueChild: async () => {
        throw Error('Unexpected child job')
      },
      mutateInTransaction: (operation: any, observeTiming?: any) => wrap('mutation', operation, observeTiming),
      finalizeInTransaction: async (operation: any) => {
        await wrap('finalization', operation)
        return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
      },
      logger: {
        debug() {},
        warn() {},
        error() {},
        info(message: string, data: any) {
          if (message === 'artwork-dedup.performance')
            observations.push({ atMs: performance.now() - started, source: message, data })
        }
      }
    }
  }
  let memorySampler: ReturnType<typeof setInterval> | undefined
  try {
    assert.equal(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0]?.name,
      url.pathname.slice(1)
    )
    const identity = await db.$transaction(async (tx) => {
      const { run } = await freezeArtworkDedupRun(tx, {
        artistId: manifest.artistId,
        requestedBy: manifest.account.userId,
        idempotencyKey: randomUUID(),
        mode: 'INCREMENTAL',
        includeSuspectedVersions: true
      })
      const job = await tx.systemJob.create({
        data: {
          id: randomUUID(),
          type: 'ARTWORK_DEDUP_SCAN',
          definitionVersion,
          executionLane: 'BACKGROUND_WRITER',
          status: 'PENDING',
          triggerSource: 'SYSTEM',
          queuePriority: 900,
          effectivePriority: 900,
          availableAt: new Date(),
          maxAttempts: 3,
          payload: { runId: run.id, executionVersion: 1 }
        }
      })
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
      return { runId: run.id, jobId: job.id }
    })
    if (action === 'enqueue') {
      await fs.writeFile(path.join(base, label + '-run.json'), stringify(identity) + '\n', { mode: 0o600, flag: 'wx' })
      console.log(stringify({ action, label, ...identity }))
      return
    }
    const executor = createArtworkDedupExecutor(
      {
        database: db as any,
        sourceRoot: manifest.root,
        archiveRoot: manifest.root,
        readerOptions: {
          entrypoint: path.join(path.dirname(process.argv[1]!), 'artwork-dedup-reader.cjs'),
          execArgv: []
        },
        onMeasurement: (measurement) => readerMeasurements.push(measurement)
      },
      definitionVersion as any
    )
    const baselineRssBytes = process.memoryUsage().rss
    sampledPeakRssBytes = baselineRssBytes
    memorySampler = setInterval(() => {
      sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss)
    }, 20)
    started = performance.now()
    active = true
    for (;;) {
      const queued = await db.systemJob.findUniqueOrThrow({ where: { id: identity.jobId } })
      if (queued.status === 'COMPLETED') break
      assert.ok(['PENDING', 'RETRY_WAIT'].includes(queued.status), 'Unexpected queued state ' + queued.status)
      const waitMs = Math.max(0, queued.availableAt.getTime() - Date.now())
      if (waitMs) {
        const waitBegan = performance.now()
        await new Promise((resolve) => setTimeout(resolve, waitMs + 3))
        schedulingWaitMs += performance.now() - waitBegan
      }
      const job = await repository.claim('hot-run-reuse-' + label, capabilities)
      assert.equal(job?.id, identity.jobId)
      assert.ok(job)
      const began = performance.now(),
        beforeSql = sqlStatements,
        beforeTransactions = transactionWrappers.length
      const heartbeat = setInterval(() => {
        void repository.heartbeat({
          jobId: job.id,
          workerId: job.workerId,
          executionToken: job.executionToken,
          attempt: job.attempt
        })
      }, 15_000)
      try {
        await executor.execute(context(job))
      } finally {
        clearInterval(heartbeat)
      }
      const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: identity.runId } })
      const state = await db.systemJob.findUniqueOrThrow({ where: { id: identity.jobId } })
      const slice = {
        stage: run.stage,
        wallMs: performance.now() - began,
        elapsedMs: performance.now() - started,
        transactions: transactionWrappers.length - beforeTransactions,
        sqlStatements: sqlStatements - beforeSql,
        status: state.status,
        availableAt: state.availableAt,
        schedulingRemainingMs: Math.max(0, state.availableAt.getTime() - Date.now()),
        statMedia: run.statMedia,
        cacheHitMedia: run.cacheHitMedia
      }
      slices.push(slice)
      console.log('HOT_RUN_REUSE_SLICE ' + stringify({ label, ...slice }))
      if (state.status === 'COMPLETED') break
      assert.equal(state.status, 'RETRY_WAIT', 'Run failed: ' + run.errorCode)
    }
    active = false
    const elapsedMs = performance.now() - started
    clearInterval(memorySampler)
    memorySampler = undefined
    sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss)
    const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: identity.runId } })
    const groups = await db.artworkDedupGroup.findMany({
      where: { runId: run.id },
      include: { members: { orderBy: { artworkId: 'asc' } } }
    })
    const relations = await db.artworkDedupRelation.findMany({
      where: { runId: run.id },
      orderBy: [{ containedArtworkId: 'asc' }, { containerArtworkId: 'asc' }]
    })
    const pairs = await db.artworkDedupVisualPair.findMany({
      where: { runId: run.id },
      orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }],
      include: { pages: { orderBy: { ordinal: 'asc' } } }
    })
    const resultSummary = {
      status: run.status,
      stage: run.stage,
      statMedia: run.statMedia,
      hashedMedia: run.hashedMedia,
      cacheHitMedia: run.cacheHitMedia,
      readBytes: String(run.readBytes),
      groupCount: run.groupCount,
      duplicateArtworks: run.duplicateArtworks,
      failedArtworks: run.failedArtworks,
      changedArtworks: run.changedArtworks,
      visualStatus: run.visualStatus,
      visualIncompleteReasons: run.visualIncompleteReasons,
      visualSearchComplete: run.visualSearchComplete,
      visualSearchVersion: run.visualSearchVersion,
      groups: groups
        .map((group) => ({
          contentSha256: group.contentSha256,
          fileCount: String(group.fileCount),
          members: group.members.map((member) => member.artworkId)
        }))
        .sort((a, b) => a.members[0]! - b.members[0]!),
      relations: relations.map((relation) => ({
        contained: relation.containedArtworkId,
        container: relation.containerArtworkId,
        containedFileCount: String(relation.containedFileCount),
        containerFileCount: String(relation.containerFileCount)
      })),
      pairs: pairs.map((pair) => ({
        left: pair.leftArtworkId,
        right: pair.rightArtworkId,
        kind: pair.relationKind,
        summary: pair.summary,
        pages: pair.pages.map((page) => [
          page.kind,
          page.leftImageId,
          page.rightImageId,
          page.leftIndex,
          page.rightIndex
        ])
      }))
    }
    const resultDigest = digest(resultSummary)
    const result = {
      observedAt: new Date().toISOString(),
      label,
      action,
      definitionVersion,
      ...identity,
      node: process.version,
      input: {
        artistId: manifest.artistId,
        artworks: manifest.artworks.length,
        media: manifest.files,
        fileStateDigest: manifest.fileStateDigest
      },
      elapsedMs,
      schedulingWaitMs,
      memory: {
        baselineRssBytes,
        sampledPeakRssBytes,
        sampleIntervalMs: 20,
        processLifetimeMaxRssBytes: process.resourceUsage().maxRSS * 1024
      },
      sqlStatements,
      sqlDurationMs,
      sqlBeginTransactions: [...sqlGroups.values()]
        .filter((row) => /^BEGIN(?:\s|$)/.test(row.sql))
        .reduce((total, row) => total + row.count, 0),
      instrumentedApiCalls: apiCalls,
      apiGroups: Object.fromEntries(apiGroups),
      statements: [...sqlGroups.values()].sort((a, b) => b.count - a.count),
      transactionWrappers,
      committedMutationTimings: committedMutationTimings.length ? committedMutationTimings : null,
      runtimeTimingCoverage: {
        supported: committedMutationTimings.length > 0,
        samples: committedMutationTimings.length,
        finalizerSplitAvailable: false
      },
      observations,
      readerMeasurements,
      slices,
      run,
      resultSummary,
      resultDigest,
      metricMeaning:
        'Full executor and queue wall from first queue read to terminal settlement reads, including real availableAt waits. Fixture freeze/result audit excluded. Real Prisma SQL events include controls/queue/heartbeat, no parameters. No SQL phase inference. Observations are timestamps at persisted-run reads or telemetry callbacks, not exact phase wall. Wrapper beforeBody combines acquisition+pre-fence; afterBody combines post-fence+commit. Runtime observer splits committed mutations only; unsupported baseline and unobserved finalizers remain null/explicitly incomplete. RSS sampled for whole process during run; lifetime peak separately named. One warm input observation per revision.'
    }
    await fs.writeFile(path.join(base, 'evidence', label + '.json'), stringify(result) + '\n', {
      mode: 0o600,
      flag: 'wx'
    })
    console.log(
      'HOT_RUN_REUSE_RESULT ' +
        stringify({
          label,
          elapsedMs,
          transactions: transactionWrappers.length,
          sqlStatements,
          status: run.status,
          cacheHitMedia: run.cacheHitMedia,
          groups: run.groupCount,
          pairs: pairs.length,
          resultDigest
        })
    )
    assert.equal(run.status, 'COMPLETED')
    assert.equal(run.readBytes, 0n)
    assert.equal(run.hashedMedia, 0)
    assert.equal(run.cacheHitMedia, manifest.files)
  } finally {
    if (memorySampler) clearInterval(memorySampler)
    await raw.$disconnect()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
