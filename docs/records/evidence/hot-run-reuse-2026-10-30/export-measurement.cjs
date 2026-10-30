const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const out = path.join(repo, 'docs/records/evidence/hot-run-reuse-2026-10-30')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const write = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)

async function main() {
  const input = {},
    sources = {}
  for (const label of ['baseline', 'after']) {
    const bytes = await fs.readFile(path.join(base, 'evidence', label + '.json'))
    const raw = JSON.parse(bytes)
    assert.equal(raw.run.status, 'COMPLETED')
    const wrappers = raw.transactionWrappers
    const timing = raw.committedMutationTimings
    const split = timing
      ? Object.fromEntries(
          [
            'acquisitionMs',
            'preFenceMs',
            'bodyMs',
            'postFenceMs',
            'commitFinalizationMs',
            'wallMs',
            'fenceReadCalls'
          ].map((field) => [field, sum(timing, field)])
        )
      : null
    const runtime = raw.run.performanceSummary ?? null
    input[label] = {
      observedAt: raw.observedAt,
      definitionVersion: raw.definitionVersion,
      node: raw.node,
      input: raw.input,
      elapsedMs: raw.elapsedMs,
      schedulingWaitMs: raw.schedulingWaitMs,
      memory: raw.memory,
      contextTransactions: wrappers.length,
      contextMutationTransactions: wrappers.filter((row) => row.kind === 'mutation').length,
      contextFinalizationTransactions: wrappers.filter((row) => row.kind === 'finalization').length,
      contextTransactionWallMs: sum(wrappers, 'wallMs'),
      contextWrapperBoundaries: Object.fromEntries(
        ['mutation', 'finalization'].map((kind) => {
          const rows = wrappers.filter((row) => row.kind === kind)
          return [
            kind,
            {
              count: rows.length,
              beforeBodyMs: sum(rows, 'beforeBodyMs'),
              bodyMs: sum(rows, 'bodyMs'),
              afterBodyMs: sum(rows, 'afterBodyMs'),
              wallMs: sum(rows, 'wallMs')
            }
          ]
        })
      ),
      runtimeCommittedMutationSplit: split,
      runtimeTimingCoverage: raw.runtimeTimingCoverage,
      sqlStatements: raw.sqlStatements,
      sqlBeginTransactions: raw.sqlBeginTransactions,
      sqlDurationMs: raw.sqlDurationMs,
      instrumentedApiCalls: raw.instrumentedApiCalls,
      apiGroups: raw.apiGroups,
      readerMeasurements: raw.readerMeasurements,
      slices: raw.slices,
      phaseObservations: raw.observations.filter((row) => row.source === 'artwork-dedup.performance'),
      performanceSummary: runtime,
      resultSummary: raw.resultSummary,
      resultDigest: raw.resultDigest,
      privateRawSha256: hash(bytes),
      metricMeaning: raw.metricMeaning
    }
    const groups = raw.statements
    const selected = new Set([
      ...groups.slice(0, 30),
      ...[...groups].sort((a, b) => b.durationMs - a.durationMs).slice(0, 15)
    ])
    const omitted = groups.filter((row) => !selected.has(row))
    const sql = {
      statements: raw.sqlStatements,
      queryEventDurationMs: raw.sqlDurationMs,
      groupsTotal: groups.length,
      selectedGroups: [...selected],
      omitted: {
        groups: omitted.length,
        statements: sum(omitted, 'count'),
        queryEventDurationMs: sum(omitted, 'durationMs')
      },
      privateRawSha256: hash(bytes),
      note: 'Normalized real SQL query events, no bind values. Selected union of top30 frequency and top15 query-event-duration groups. Omitted totals reconcile to whole-run SQL; there is no inferred phase assignment.'
    }
    assert.equal(sum(sql.selectedGroups, 'count') + sql.omitted.statements, sql.statements)
    assert.equal(sum(sql.selectedGroups, 'durationMs') + sql.omitted.queryEventDurationMs, sql.queryEventDurationMs)
    await write(label + '-sql.json', sql)
    sources[label] = JSON.parse(await fs.readFile(path.join(base, 'evidence', label + '-source.json'), 'utf8'))
  }
  assert.deepEqual(input.baseline.input, input.after.input)
  assert.equal(input.baseline.resultDigest, input.after.resultDigest, 'Semantic result digests differ')
  assert.equal(sources.baseline.driverSha256, sources.after.driverSha256)
  const comparison = {
    wallReductionPercent: (1 - input.after.elapsedMs / input.baseline.elapsedMs) * 100,
    contextTransactionReductionPercent:
      (1 - input.after.contextTransactions / input.baseline.contextTransactions) * 100,
    sqlTransactionReductionPercent: (1 - input.after.sqlBeginTransactions / input.baseline.sqlBeginTransactions) * 100,
    semanticResultEqual: true,
    observationsPerRevision: 1,
    targets: { wallReductionPercent: 60, contextTransactionReductionPercent: 80 }
  }
  await write('measurement.json', { before: input.baseline, after: input.after, comparison })
  await write('source-hashes.json', {
    baselineCommit: 'c8d1f380',
    baselineArchiveSha256: hash(await fs.readFile(path.join(base, 'baseline-source.tar'))),
    sources
  })
  const format = (value) => value.toLocaleString('en-US', { maximumFractionDigits: 3 })
  const before = input.baseline,
    after = input.after
  const note = `# Hot-run reuse same-input measurement — 2026-10-30\n\nOne isolated full-executor incremental run per revision: v0.55.2 c8d1f380 (v8) and frozen new source (v9). This is a warm local observation, with no repeated big benchmark or full App validation, and no NAS latency claim.\n\n## Frozen input and recovery basis\n\nThe exact retained 2,000 physical images / 50 artworks were read-only reused. File digest includes relative path, SHA-256, size, mtimeNs, inode and device: \`${before.input.fileStateDigest}\`. Both measured databases were restored from the same preserved warm dump SHA-256 \`27f56230021955550eae72292d8db06e02894177ced3008653e1a2fe46835b0a\`. The old sample and dump were not changed. New v9 clones received only the job-policy migration to accept scan version9; row preservation and negative policy probes are in the dated policy evidence. The v8 baseline clone retained133 migrations.\n\nSource and bundle hashes, including the identical common driver hash, are in [source-hashes.json](./source-hashes.json). Private dump, credentials, account fixture and full raw outputs remain outside Git in the task temp directory. Browser media is an independent copy. No App or Worker service competed during the comparison.\n\n## Results and boundaries\n\n| Metric | Before | After |\n| --- | ---: | ---: |\n| Full measured wall, including real queue waits | ${format(before.elapsedMs)} ms | ${format(after.elapsedMs)} ms |\n| Context mutation/finalization transactions | ${before.contextTransactions} | ${after.contextTransactions} |\n| SQL BEGIN, including queue/fence work | ${before.sqlBeginTransactions} | ${after.sqlBeginTransactions} |\n| Real SQL statements, including controls | ${before.sqlStatements} | ${after.sqlStatements} |\n| Instrumented Prisma API operations | ${before.instrumentedApiCalls} | ${after.instrumentedApiCalls} |\n| Sampled whole-process RSS peak | ${before.memory.sampledPeakRssBytes} bytes | ${after.memory.sampledPeakRssBytes} bytes |\n| Scheduling waits actually slept | ${format(before.schedulingWaitMs)} ms | ${format(after.schedulingWaitMs)} ms |\n\nWall reduction is ${format(comparison.wallReductionPercent)}%; context transaction reduction is ${format(comparison.contextTransactionReductionPercent)}%. Targets were60% and80%, respectively. These are sequential single observations, not confidence intervals. Both return semantic result digest \`${before.resultDigest}\`. See [measurement.json](./measurement.json) for exact result graph, cache/read/decoding/search counters and memory.\n\nWall starts before the first measured queue read and ends after terminal settlement reads; fixture freezing and result audit are excluded. SQL is captured by a dedicated Prisma client query-event listener, with no parameters or connection credentials. API methods, context transactions, runtime persisted counters and real SQL statements have separately named scopes.\n\nThe common wrapper measures beforeBody (transaction acquisition plus pre-fence), body, and afterBody (post-fence plus commit/finalization) for both versions. New runtime observers further split only successfully committed mutation transactions into acquisition/pre-fence/body/post-fence/commit-finalization. Baseline unsupported splits are null. Finalizer split is unavailable; persisted snapshots are explicitly incomplete at their cutoff. Timestamped persisted-run observations are not represented as exact end-to-end phase wall, and SQL is not assigned to inferred phases.\n\nRSS sampled every20 ms covers the whole benchmark process during the run; process-lifetime high-water and reader child peaks are separate. metadataPeakBytes estimates task metadata, not total Worker memory or a container limit.\n\nThe SQL files retain the union of top30 frequency and top15 query-event-duration groups with exact aggregate counts/durations for all omitted groups. These reconcile to whole-run totals. Full raw groups remain private with checksums.\n\n## Replay\n\nUse a fresh uniquely named isolated clone of the preserved checkpoint, the same physical fixture and both frozen sources. The helpers refuse existing output/database names. Build the identical dated driver against each source with build-benchmark.cjs; measure baseline with HOT_RUN_DEFINITION_VERSION=8 and new source with9. Do not reuse completed measured databases as if they were the warm checkpoint. The driver honors real availableAt waits. Keep output, SQL groups and source hashes together.\n`
  await fs.writeFile(path.join(out, 'measurement-notes.md'), note, { flag: 'wx' })
  console.log(JSON.stringify(comparison))
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
