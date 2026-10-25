// Offline only: node scripts/artwork-dedup-visual-pilot.mjs /private/tmp/pixishelf-visual-b2
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(repository, 'packages/pixishelf-job-executors/package.json'))
const sharp = require('sharp')
sharp.cache(false)
sharp.concurrency(1)
const execute = promisify(execFile)
const root = path.resolve(process.argv[2] || '/private/tmp/pixishelf-visual-b2')
if (!root.startsWith('/private/tmp/') || root === '/private/tmp')
  throw new Error('Experiment output must be an isolated tmp folder')
const implementation = path.join(root, 'visual-core.mjs')
const limits = { fileBytes: 32 * 1024 * 1024, pixels: 40_000_000, childMs: 10_000, heapMiB: 128 }
const rss = () => process.resourceUsage().maxRSS * 1024
const sha = (b) => createHash('sha256').update(b).digest('hex')
const identity = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':')
const inputOptions = { limitInputPixels: limits.pixels, failOn: 'warning', sequentialRead: true }

if (process.argv[3] === 'feature') {
  const core = await import(pathToFileURL(implementation))
  const file = process.argv[4]
  let readBytes = 0,
    decodeCount = 0
  try {
    const before = await fs.stat(file, { bigint: true })
    if (!before.isFile() || before.size > BigInt(limits.fileBytes)) throw new Error('File limit')
    const bytes = await fs.readFile(file)
    readBytes = bytes.length
    const metadata = await sharp(bytes, inputOptions).metadata()
    if ((metadata.pages || 1) !== 1) throw new Error('Animated/multipage input excluded')
    decodeCount++
    const { data, info } = await sharp(bytes, inputOptions)
      .rotate()
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .resize(96, 96, { fit: 'fill', kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 1) throw new Error('Unexpected normalization')
    const after = await fs.stat(file, { bigint: true })
    if (identity(before) !== identity(after)) throw new Error('Changed during decode')
    const rotate = [5, 6, 7, 8].includes(metadata.orientation)
    const width = rotate ? metadata.height : metadata.width
    const height = rotate ? metadata.width : metadata.height
    process.stdout.write(
      JSON.stringify({
        feature: core.featureFromGray96(data, width, height),
        sha: sha(bytes),
        identity: identity(after),
        readBytes,
        decodeCount,
        peakRSS: rss()
      })
    )
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error), readBytes, decodeCount, peakRSS: rss() }))
  }
  process.exit(0)
}

if (process.argv[3] === 'scale') {
  const start = performance.now(),
    n = 500_000,
    slots = 40
  const hashes = new Uint32Array(n * 20)
  let seed = 0x12345678
  for (let i = 0; i < hashes.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    hashes[i] = seed >>> 0
  }
  const heads = new Int32Array(slots * 65536).fill(-1)
  const next = new Int32Array(n * slots).fill(-1)
  for (let i = 0; i < n; i++)
    for (let slot = 0; slot < slots; slot++) {
      const key = slot * 65536 + ((hashes[i * 20 + (slot >>> 1)] >>> ((slot & 1) * 16)) & 65535)
      next[i * slots + slot] = heads[key]
      heads[key] = i
    }
  const built = performance.now()
  function query(id, budget) {
    const candidates = new Set()
    let visits = 0
    for (let slot = 0; slot < slots; slot++) {
      const key = slot * 65536 + ((hashes[id * 20 + (slot >>> 1)] >>> ((slot & 1) * 16)) & 65535)
      for (let i = heads[key]; i !== -1; i = next[i * slots + slot]) {
        if (++visits > budget) return { status: 'incomplete', candidates: candidates.size, visits: visits - 1, budget }
        candidates.add(i)
      }
    }
    return { status: 'complete', candidates: candidates.size, visits, budget }
  }
  const queries = Array.from({ length: 100 }, (_, i) => query(i * 4999, 20_000))
  // Deliberate pathological common bucket; preserve the explicit incomplete outcome.
  for (let i = 0; i < n; i++) next[i * slots] = i - 1
  heads[hashes[0] & 65535] = n - 1
  const highFrequency = query(0, 20_000)
  process.stdout.write(
    JSON.stringify({
      kind: 'synthetic-features-only',
      count: n,
      hashNetBytes: hashes.byteLength,
      indexTypedArrayBytes: heads.byteLength + next.byteLength,
      buildMs: built - start,
      totalMs: performance.now() - start,
      peakRSS: rss(),
      queries,
      highFrequency,
      realImageIoValidated: false,
      databaseValidated: false
    })
  )
  process.exit(0)
}

await fs.mkdir(root, { recursive: true })
const ts = require('typescript')
const source = await fs.readFile(
  path.join(repository, 'packages/pixishelf-job-executors/src/artwork-dedup/visual-experiment.ts'),
  'utf8'
)
await fs.writeFile(
  implementation,
  ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    .outputText
)
const core = await import(pathToFileURL(implementation))
const manifestBytes = await fs.readFile(path.join(root, 'samples.json'))
const manifest = JSON.parse(manifestBytes)
const groups = [...new Set(manifest.samples.map((s) => s.sourceGroup))]
if (groups.length < 5) throw new Error('Expected five independent source groups')
const split = (group) => (groups.indexOf(group) < 3 ? 'tune' : 'heldout')
const files = [],
  cases = []
const variants = path.join(root, 'variants')
await fs.mkdir(variants, { recursive: true })
const generationStart = performance.now()
const prepared = new Map()
for (const sample of manifest.samples) {
  if (!path.resolve(sample.file).startsWith(path.join(root, 'samples') + path.sep))
    throw new Error('Source outside readonly copies')
  const stats = await fs.stat(sample.file)
  if (stats.size > limits.fileBytes) throw new Error('Preparation input too large')
  const content = await fs.readFile(sample.file)
  if (sha(content) !== sample.sha256) throw new Error('Manifest copy changed')
  const result = await sharp(content, inputOptions)
    .rotate()
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  prepared.set(sample.id, result)
}
for (const sample of manifest.samples) {
  const { data, info } = prepared.get(sample.id),
    w = info.width,
    h = info.height
  files.push(sample.file)
  const target = async (kind, operation, expectation) => {
    const file = path.join(variants, `${sample.id}-${kind}.png`)
    await operation.toFile(file)
    files.push(file)
    cases.push({
      id: `${sample.id}-${kind}`,
      split: split(sample.sourceGroup),
      kind,
      expectation,
      a: sample.file,
      b: file
    })
  }
  const left = Math.floor(w * 0.42),
    top = Math.floor(h * 0.56),
    width = Math.floor(w * 0.18),
    height = Math.floor(h * 0.16)
  for (const color of ['black', 'white'])
    await target(
      `local-${color}`,
      sharp(data)
        .composite([{ input: { create: { width, height, channels: 3, background: color } }, left, top }])
        .png(),
      'must-hit'
    )
  const mosaicSmall = await sharp(data).extract({ left, top, width, height }).resize(5, 5).png().toBuffer()
  const mosaic = await sharp(mosaicSmall).resize(width, height, { kernel: 'nearest' }).png().toBuffer()
  await target(
    'mosaic',
    sharp(data)
      .composite([{ input: mosaic, left, top }])
      .png(),
    'must-hit'
  )
  await target(
    'jpeg-resize',
    sharp(data)
      .resize({ width: Math.floor(w * 0.6) })
      .jpeg({ quality: 40 }),
    'must-hit'
  )
  await target(
    'heavy-mask',
    sharp(data)
      .composite([
        {
          input: {
            create: { width: Math.floor(w * 0.7), height: Math.floor(h * 0.6), channels: 3, background: 'black' }
          },
          left: Math.floor(w * 0.15),
          top: Math.floor(h * 0.2)
        }
      ])
      .png(),
    'difficult'
  )
  await target(
    'crop',
    sharp(data)
      .extract({
        left: Math.floor(w * 0.1),
        top: Math.floor(h * 0.1),
        width: Math.floor(w * 0.8),
        height: Math.floor(h * 0.8)
      })
      .png(),
    'difficult'
  )
  await target(
    'white-border',
    sharp(data)
      .extend({
        top: Math.floor(h * 0.1),
        bottom: Math.floor(h * 0.1),
        left: Math.floor(w * 0.1),
        right: Math.floor(w * 0.1),
        background: 'white'
      })
      .png(),
    'difficult'
  )
  await target(
    'flat',
    sharp({ create: { width: w, height: h, channels: 3, background: 'white' } }).png(),
    'must-exclude'
  )
  const keyPatch = await sharp({
    create: { width: Math.floor(w / 3), height: Math.floor(h / 3), channels: 3, background: '#4080c0' }
  })
    .png()
    .toBuffer()
  await target(
    'key-content-edit',
    sharp(data)
      .composite([{ input: keyPatch, left: Math.floor(w / 3), top: Math.floor(h / 3) }])
      .png(),
    'semantic-ambiguity'
  )
  // Same fixed frame, independently generated main content: known synthetic negative.
  const templatePaths = []
  for (let variant = 0; variant < 2; variant++) {
    const channels = 3,
      size = 128,
      raw = Buffer.alloc(size * size * channels)
    let seed = 12345 + Number(sample.id.slice(-2)) * 8191 + variant * 100003
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        for (let c = 0; c < 3; c++)
          raw[(y * size + x) * 3 + c] = x < 10 || x >= 118 || y < 10 || y >= 118 ? 30 : (seed >>> (c * 8)) & 255
      }
    const file = path.join(variants, `${sample.id}-template-${variant}.png`)
    await sharp(raw, { raw: { width: size, height: size, channels } })
      .resize(512, 512, { kernel: 'nearest' })
      .png()
      .toFile(file)
    templatePaths.push(file)
    files.push(file)
  }
  cases.push({
    id: `${sample.id}-template`,
    split: split(sample.sourceGroup),
    kind: 'template-different-content',
    expectation: 'must-exclude',
    a: templatePaths[0],
    b: templatePaths[1]
  })
}
const preparationMs = performance.now() - generationStart
const cachePath = path.join(root, 'visual-cache.json')
let cache = { paths: {}, features: {} }
const version = `${core.VISUAL_EXPERIMENT_VERSION}:${core.VISUAL_NORMALIZATION_VERSION}`
async function pass(label) {
  const start = performance.now(),
    values = new Map(),
    metrics = {
      label,
      statCount: 0,
      readBytes: 0,
      decodeCount: 0,
      cacheHit: 0,
      contentReuse: 0,
      peakRSS: rss(),
      errors: []
    }
  for (const file of files) {
    try {
      const stats = await fs.stat(file, { bigint: true })
      metrics.statCount++
      const current = identity(stats),
        cached = cache.paths[file]
      if (cached?.identity === current && cached.version === version && cache.features[cached.key]) {
        metrics.cacheHit++
        values.set(file, cache.features[cached.key])
        continue
      }
      const child = await execute(
        process.execPath,
        [`--max-old-space-size=${limits.heapMiB}`, fileURLToPath(import.meta.url), root, 'feature', file],
        { timeout: limits.childMs, maxBuffer: 1024 * 1024 }
      )
      const result = JSON.parse(child.stdout),
        key = `${result.sha}:${version}`
      metrics.readBytes += result.readBytes
      metrics.decodeCount += result.decodeCount
      metrics.peakRSS = Math.max(metrics.peakRSS, result.peakRSS)
      if (result.error) throw new Error(result.error)
      if (cache.features[key]) metrics.contentReuse++
      cache.features[key] = result.feature
      cache.paths[file] = { identity: result.identity, version, key }
      values.set(file, result.feature)
    } catch (error) {
      metrics.errors.push({ file: path.basename(file), error: String(error) })
    }
  }
  await fs.writeFile(cachePath, JSON.stringify(cache))
  return {
    values,
    metrics: {
      ...metrics,
      elapsedMs: performance.now() - start,
      status: metrics.errors.length ? 'incomplete' : 'complete'
    }
  }
}
// Fresh cache run intentionally discards only this experiment's serialized cache.
const cold = await pass('cold')
cache = JSON.parse(await fs.readFile(cachePath, 'utf8'))
const hot = await pass('hot-persisted-reload')
function evaluate(selectedCases, parameters, local) {
  const rows = selectedCases.map((c) => {
    const a = cold.values.get(c.a),
      b = cold.values.get(c.b)
    return {
      id: c.id,
      kind: c.kind,
      expectation: c.expectation,
      ...(a && b ? core.compareVisual(a, b, parameters, local) : { incomplete: true })
    }
  })
  const matrix = Object.fromEntries(
    [...new Set(rows.map((r) => r.kind))].map((kind) => {
      const subset = rows.filter((r) => r.kind === kind)
      return [
        kind,
        {
          total: subset.length,
          matched: subset.filter((r) => r.matched).length,
          incomplete: subset.filter((r) => r.incomplete).length,
          expectation: subset[0].expectation
        }
      ]
    })
  )
  return {
    rows,
    matrix,
    misses: rows.filter((r) => r.expectation === 'must-hit' && !r.matched).length,
    falseMatches: rows.filter((r) => r.expectation === 'must-exclude' && r.matched).length
  }
}
const tuning = core.VISUAL_PARAMETER_PRESETS.map((parameters) => ({
  parameters,
  baseline: evaluate(
    cases.filter((c) => c.split === 'tune'),
    parameters,
    false
  ),
  local: evaluate(
    cases.filter((c) => c.split === 'tune'),
    parameters,
    true
  )
}))
// Fixed, predeclared ranking: minimize exclusions violated, then must-hit misses, then stricter preset.
const selected = tuning
  .map((t, i) => ({ i, score: t.local.falseMatches * 10000 + t.local.misses }))
  .sort((a, b) => a.score - b.score || a.i - b.i)[0].i
const parameters = core.VISUAL_PARAMETER_PRESETS[selected]
await fs.writeFile(
  path.join(root, 'parameter-lock.json'),
  JSON.stringify(
    {
      selected,
      parameters,
      version,
      manifestSHA: sha(manifestBytes),
      ranking: 'falseMatches*10000+misses; strict tie-break'
    },
    null,
    2
  )
)
// Heldout evaluated once, only after the parameter lock is written.
const heldout = {
  baseline: evaluate(
    cases.filter((c) => c.split === 'heldout'),
    parameters,
    false
  ),
  local: evaluate(
    cases.filter((c) => c.split === 'heldout'),
    parameters,
    true
  )
}
const exploratory = []
for (let i = 0; i < manifest.samples.length; i++)
  for (let j = i + 1; j < manifest.samples.length; j++) {
    const a = manifest.samples[i],
      b = manifest.samples[j]
    exploratory.push({
      a: a.id,
      b: b.id,
      truth: 'unlabelled',
      sameSourceGroup: a.sourceGroup === b.sourceGroup,
      baseline: core.compareVisual(cold.values.get(a.file), cold.values.get(b.file), parameters, false).matched,
      local: core.compareVisual(cold.values.get(a.file), cold.values.get(b.file), parameters, true).matched
    })
  }
const changedFile = cases.find((c) => c.kind === 'local-black').b
await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } })
  .png()
  .toFile(changedFile)
const changed = await pass('one-variant-changed')
let scale
try {
  scale = JSON.parse(
    (
      await execute(process.execPath, ['--max-old-space-size=384', fileURLToPath(import.meta.url), root, 'scale'], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024
      })
    ).stdout
  )
} catch (error) {
  scale = { kind: 'synthetic-features-only', status: 'incomplete', error: String(error) }
}
// Composition uses actual heldout outcomes as repeated page families, explicitly synthetic.
const heldoutVariants = cases.filter((c) => c.split === 'heldout' && c.expectation === 'must-hit')
const composition = {}
for (const local of [false, true]) {
  const visualLeft = Array.from({ length: 15 }, (_, i) => heldoutVariants[i % heldoutVariants.length])
  const adjacency = visualLeft.map((a) =>
    visualLeft.flatMap((b, j) =>
      core.compareVisual(cold.values.get(a.a), cold.values.get(b.b), parameters, local).matched ? [j] : []
    )
  )
  const visual = core.pairPages(adjacency, 35)
  composition[local ? 'local' : 'baseline'] = {
    kind: 'synthetic-80-vs-100-with-65-exact-15-visual-repeated-heldout-families',
    exactPairs: 65,
    visualPairs: visual.matched,
    matched: 65 + visual.matched,
    leftTotal: 80,
    rightTotal: 100,
    leftUnmatched: visual.leftUnmatched,
    rightUnmatched: visual.rightUnmatched,
    ambiguousLeft: visual.ambiguousLeft,
    ambiguousRight: visual.ambiguousRight,
    visualPairsEvidence: visual.pairs,
    crossSourceFamilyAssignments: visual.pairs.filter((pair) => visualLeft[pair.left].a !== visualLeft[pair.right].a)
      .length,
    exactMultiplicity: core.pairPages(
      Array.from({ length: 65 }, (_, i) => [i]),
      65
    ).matched
  }
}
const duplicateMultiplicity = core.pairPages([[0], [0]], 1)
// Four 16-bit bands per region. This approximate lookup can miss accepted high-distance pairs.
function bandMatch(a, b, local) {
  for (let region = 0; region < (local ? 10 : 1); region++) {
    if (Math.min(a.information[region], b.information[region]) < parameters.minimumInformation) continue
    for (let band = 0; band < 4; band++)
      if (a.hashes[region].slice(band * 4, band * 4 + 4) === b.hashes[region].slice(band * 4, band * 4 + 4)) return true
  }
  return false
}
const retrieval = Object.fromEntries(
  [false, true].map((local) => {
    const accepted = cases.filter(
      (c) =>
        c.split === 'heldout' &&
        core.compareVisual(cold.values.get(c.a), cold.values.get(c.b), parameters, local).matched
    )
    const retrieved = accepted.filter((c) => bandMatch(cold.values.get(c.a), cold.values.get(c.b), local))
    const mustHit = cases.filter((c) => c.split === 'heldout' && c.expectation === 'must-hit')
    return [
      local ? 'local' : 'baseline',
      {
        acceptedPairs: accepted.length,
        retrievedPairs: retrieved.length,
        missedAccepted: accepted
          .filter((c) => !retrieved.includes(c))
          .map(({ id, kind, expectation }) => ({ id, kind, expectation })),
        endToEndMustHit: {
          total: mustHit.length,
          matched: retrieved.filter((c) => c.expectation === 'must-hit').length
        }
      }
    ]
  })
)
const report = {
  status: 'experiment-only-stop-before-integration',
  createdAt: new Date().toISOString(),
  sampleBoundary: {
    realImages: manifest.samples.length,
    sourceGroups: groups.length,
    tuningGroups: 3,
    heldoutGroups: groups.length - 3,
    realLabeledVersionPairs: manifest.realLabeledVersionPairs.length,
    truth: 'technical-variants-only; real same/cross-group pairs unlabelled',
    manifestSHA: sha(manifestBytes)
  },
  algorithm: {
    version,
    sharpVersion: sharp.versions.sharp,
    dct: '32x32, 8x8 AC median, 63 bits plus reserved zero',
    normalization: core.VISUAL_NORMALIZATION_VERSION,
    selectedPreset: selected,
    parameters,
    limits
  },
  preparation: {
    elapsedMs: preparationMs,
    contentIoExcludedFromCacheMetrics: true,
    safety: 'sharp pixel/file bounds; preparation is trusted copied-input tooling, not production reader security'
  },
  tuning,
  heldout,
  exploratory,
  composition,
  duplicateMultiplicity,
  retrieval,
  cache: [cold.metrics, hot.metrics, changed.metrics],
  scale,
  limitations: [
    'No real labelled censored/uncensored pairs; recognition effectiveness unverified.',
    'Synthetic repeats are not 80 independent pages.',
    'Same-layout local edits are semantic ambiguity, not established false positives.',
    'Different real source groups are not automatically known negatives.',
    'Stat cache is experiment-only, not adversarial production identity proof.',
    'Feature child bounded by file/pixels/walltime; V8 heap limit is not a native RSS cap.',
    'Read bytes count application content buffers, not physical disk reads; decode count counts full image decodes, not metadata headers.',
    '500k random features do not validate independent images, NAS, database, or concurrent browsing latency.',
    'Approximate 16-bit exact bands can miss valid matches; high-frequency budget exits incomplete.',
    'No online pipeline, contracts, migrations, or deletion behavior changed.'
  ]
}
await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
process.stdout.write(
  JSON.stringify(
    {
      report: path.join(root, 'report.json'),
      selected,
      heldout: { baseline: heldout.baseline.matrix, local: heldout.local.matrix },
      cache: report.cache,
      scale: { ...scale, queries: scale.queries?.length }
    },
    null,
    2
  )
)
