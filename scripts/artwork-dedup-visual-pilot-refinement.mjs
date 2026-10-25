// One frozen offline evaluation. No database access or production exports.
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
const root = path.resolve(process.argv[2] || '/private/tmp/pixishelf-visual-refinement')
if (!root.startsWith('/private/tmp/') || root === '/private/tmp') throw new Error('Requires isolated tmp folder')
const output = path.join(root, 'run-v2')
const implementation = path.join(output, 'visual-core.mjs')
const limits = { fileBytes: 32 * 1024 * 1024, pixels: 40_000_000, childMs: 10_000, heapMiB: 128 }
const options = { limitInputPixels: limits.pixels, failOn: 'warning', sequentialRead: true }
const sha = (value) => createHash('sha256').update(value).digest('hex')
const identity = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':')
const rss = () => process.resourceUsage().maxRSS * 1024
const lock = {
  version: 'white245-995-edge20-crop5-10-v1',
  parameters: {
    globalDistance: 12,
    localDistance: 10,
    agreeingRegions: 7,
    localGlobalCeiling: 28,
    minimumInformation: 8,
    aspectTolerance: 0.08
  },
  views: ['original', 'white-trim', 'trim-crop5', 'trim-crop10'],
  white: { channelMin: 245, fraction: 0.995, edgeMax: 0.2, retainedMin: 0.6, previewMax: 720 },
  postingBudget: 20_000,
  candidateBudget: 20_000,
  cases: [
    'border10',
    'border-asym-3-7-5-9',
    'border250-10',
    'crop2.5',
    'crop5',
    'crop7.5',
    'crop10',
    'crop-asym-3-6-4-7',
    'local-black',
    'local-white',
    'mosaic',
    'jpeg-resize',
    'flat',
    'semantic-edit',
    'template-different-content'
  ],
  evaluations: 1,
  retune: false
}

if (process.argv[3] === 'feature') {
  const core = await import(pathToFileURL(implementation))
  const file = process.argv[4],
    refined = process.argv[5] === 'v2'
  let readBytes = 0,
    decodeCount = 0
  const started = performance.now()
  try {
    const real = await fs.realpath(file)
    if (!real.startsWith(root + path.sep)) throw new Error('Input outside experiment')
    const before = await fs.stat(file, { bigint: true })
    if (!before.isFile() || before.size > BigInt(limits.fileBytes)) throw new Error('File limit')
    const bytes = await fs.readFile(file)
    readBytes = bytes.length
    const metadata = await sharp(bytes, options).metadata()
    if ((metadata.pages || 1) !== 1) throw new Error('Multipage input excluded')
    const rotate = [5, 6, 7, 8].includes(metadata.orientation)
    const width = rotate ? metadata.height : metadata.width,
      height = rotate ? metadata.width : metadata.height
    decodeCount++
    const gray = await sharp(bytes, options)
      .rotate()
      .toColourspace('srgb')
      .flatten({ background: 'white' })
      .resize(96, 96, { fit: 'fill', kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer()
    const views = [{ name: 'original', feature: core.featureFromGray96(gray, width, height) }]
    let whiteRectangle = null,
      previewSize = null
    if (refined) {
      decodeCount++
      const preview = await sharp(bytes, options)
        .rotate()
        .toColourspace('srgb')
        .flatten({ background: 'white' })
        .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (preview.info.channels !== 3) throw new Error('Expected RGB preview')
      previewSize = [preview.info.width, preview.info.height]
      whiteRectangle = core.whiteBorderRectangle(preview.data, ...previewSize)
      const rectangles = []
      if (whiteRectangle.width !== preview.info.width || whiteRectangle.height !== preview.info.height)
        rectangles.push({ name: 'white-trim', rectangle: whiteRectangle })
      rectangles.push(
        { name: 'trim-crop5', rectangle: core.insetRectangle(whiteRectangle, 0.05) },
        { name: 'trim-crop10', rectangle: core.insetRectangle(whiteRectangle, 0.1) }
      )
      for (const { name, rectangle } of rectangles) {
        const pixels = await sharp(preview.data, {
          raw: { width: preview.info.width, height: preview.info.height, channels: 3 }
        })
          .extract(rectangle)
          .resize(96, 96, { fit: 'fill', kernel: 'lanczos3' })
          .greyscale()
          .raw()
          .toBuffer()
        views.push({ name, feature: core.featureFromGray96(pixels, rectangle.width, rectangle.height) })
      }
    }
    const after = await fs.stat(file, { bigint: true })
    if (identity(before) !== identity(after)) throw new Error('Changed during decode')
    process.stdout.write(
      JSON.stringify({
        views,
        whiteRectangle,
        previewSize,
        sha: sha(bytes),
        identity: identity(after),
        readBytes,
        decodeCount,
        peakRSS: rss(),
        elapsedMs: performance.now() - started
      })
    )
  } catch (error) {
    // Error classes only: filenames and private source context never enter the public report.
    process.stdout.write(
      JSON.stringify({
        error: error?.code || error?.name || 'FeatureFailure',
        readBytes,
        decodeCount,
        peakRSS: rss(),
        elapsedMs: performance.now() - started
      })
    )
  }
  process.exit(0)
}

await fs.mkdir(root, { recursive: true })
const lockFile = path.join(root, 'refinement-parameter-lock.json')
try {
  await fs.writeFile(lockFile, JSON.stringify(lock, null, 2), { flag: 'wx' })
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  if (JSON.stringify(JSON.parse(await fs.readFile(lockFile, 'utf8'))) !== JSON.stringify(lock))
    throw new Error('Frozen parameter mismatch')
}
// Exclusive run directory prevents accidental re-evaluation after viewing results.
await fs.mkdir(output)
const ts = require('typescript')
const coreSource = await fs.readFile(
  path.join(repository, 'packages/pixishelf-job-executors/src/artwork-dedup/visual-experiment.ts'),
  'utf8'
)
await fs.writeFile(
  implementation,
  ts.transpileModule(coreSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    .outputText
)
const core = await import(pathToFileURL(implementation))
if (core.VISUAL_REFINEMENT_VERSION !== lock.version) throw new Error('Version mismatch')
const manifestBytes = await fs.readFile(path.join(root, 'samples.json'))
const privateManifest = JSON.parse(manifestBytes)
const samples = privateManifest.samples.map((sample, i) => ({
  id: `fresh-${String(i + 1).padStart(2, '0')}`,
  file: sample.file,
  sha256: sample.sha256
}))
const files = [],
  cases = [],
  addFile = (id, file) => {
    files.push({ id, file })
    return files.length - 1
  }
const generationStart = performance.now()
let preparationReadBytes = 0
for (const sample of samples) {
  const real = await fs.realpath(sample.file)
  if (!real.startsWith(path.join(root, 'samples') + path.sep)) throw new Error('Source outside readonly copies')
  const stat = await fs.stat(real)
  if (stat.size > limits.fileBytes) throw new Error('Preparation file limit')
  const bytes = await fs.readFile(real)
  preparationReadBytes += bytes.length
  if (sha(bytes) !== sample.sha256) throw new Error('Copy checksum mismatch')
  const original = addFile(sample.id, real)
  const { data, info } = await sharp(bytes, options)
    .rotate()
    .toColourspace('srgb')
    .flatten({ background: 'white' })
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  const w = info.width,
    h = info.height
  const variant = async (kind, operation, expectation) => {
    const id = `${sample.id}-${kind}`,
      file = path.join(output, `${id}.png`)
    await operation.toFile(file)
    const target = addFile(id, file)
    cases.push({ id, kind, expectation, a: original, b: target })
  }
  const extend = (left, right, top, bottom, background) =>
    sharp(data)
      .extend({
        left: Math.floor(w * left),
        right: Math.floor(w * right),
        top: Math.floor(h * top),
        bottom: Math.floor(h * bottom),
        background
      })
      .png()
  await variant('border10', extend(0.1, 0.1, 0.1, 0.1, 'white'), 'geometry-target')
  await variant('border-asym-3-7-5-9', extend(0.03, 0.07, 0.05, 0.09, 'white'), 'geometry-target')
  await variant('border250-10', extend(0.1, 0.1, 0.1, 0.1, { r: 250, g: 250, b: 250 }), 'geometry-target')
  const crop = (left, right, top, bottom) =>
    sharp(data)
      .extract({
        left: Math.floor(w * left),
        top: Math.floor(h * top),
        width: w - Math.floor(w * left) - Math.floor(w * right),
        height: h - Math.floor(h * top) - Math.floor(h * bottom)
      })
      .png()
  for (const percentage of [2.5, 5, 7.5, 10])
    await variant(`crop${percentage}`, crop(...Array(4).fill(percentage / 100)), 'geometry-target')
  await variant('crop-asym-3-6-4-7', crop(0.03, 0.06, 0.04, 0.07), 'geometry-target')
  const left = Math.floor(w * 0.42),
    top = Math.floor(h * 0.56),
    width = Math.floor(w * 0.18),
    height = Math.floor(h * 0.16)
  for (const color of ['black', 'white'])
    await variant(
      `local-${color}`,
      sharp(data)
        .composite([{ input: { create: { width, height, channels: 3, background: color } }, left, top }])
        .png(),
      'regression-target'
    )
  const small = await sharp(data).extract({ left, top, width, height }).resize(5, 5).png().toBuffer()
  const mosaic = await sharp(small).resize(width, height, { kernel: 'nearest' }).png().toBuffer()
  await variant(
    'mosaic',
    sharp(data)
      .composite([{ input: mosaic, left, top }])
      .png(),
    'regression-target'
  )
  await variant(
    'jpeg-resize',
    sharp(data)
      .resize({ width: Math.floor(w * 0.6) })
      .jpeg({ quality: 40 }),
    'regression-target'
  )
  await variant(
    'flat',
    sharp({ create: { width: w, height: h, channels: 3, background: 'white' } }).png(),
    'must-exclude'
  )
  await variant(
    'semantic-edit',
    sharp(data)
      .composite([
        {
          input: {
            create: { width: Math.floor(w / 3), height: Math.floor(h / 3), channels: 3, background: '#4080c0' }
          },
          left: Math.floor(w / 3),
          top: Math.floor(h / 3)
        }
      ])
      .png(),
    'semantic-ambiguity'
  )
  const templatePages = []
  for (let v = 0; v < 2; v++) {
    const raw = Buffer.alloc(128 * 128 * 3)
    let seed = 12345 + Number(sample.id.slice(-2)) * 8191 + v * 100003
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        for (let c = 0; c < 3; c++)
          raw[(y * 128 + x) * 3 + c] = x < 10 || x >= 118 || y < 10 || y >= 118 ? 30 : (seed >>> (c * 8)) & 255
      }
    const id = `${sample.id}-template-${v}`,
      file = path.join(output, `${id}.png`)
    await sharp(raw, { raw: { width: 128, height: 128, channels: 3 } })
      .resize(512, 512, { kernel: 'nearest' })
      .png()
      .toFile(file)
    templatePages.push(addFile(id, file))
  }
  cases.push({
    id: `${sample.id}-template-different-content`,
    kind: 'template-different-content',
    expectation: 'must-exclude',
    a: templatePages[0],
    b: templatePages[1]
  })
}
if (cases.length !== samples.length * lock.cases.length || cases.some((c) => !lock.cases.includes(c.kind)))
  throw new Error('Unexpected case matrix')
const preparationMs = performance.now() - generationStart
const cacheFile = path.join(output, 'cache.json')
let cache = { paths: {}, features: {} }
const oldVersion = `${core.VISUAL_EXPERIMENT_VERSION}:${core.VISUAL_NORMALIZATION_VERSION}`
const newVersion = `${oldVersion}:${core.VISUAL_REFINEMENT_VERSION}`
async function pass(label, version) {
  const start = performance.now(),
    values = []
  const metrics = {
    label,
    statCount: 0,
    cacheHit: 0,
    oldVersionRejected: 0,
    readBytes: 0,
    decodeCount: 0,
    featureProcessingMs: 0,
    maxChildPeakRSS: 0,
    errors: []
  }
  for (const { id, file } of files) {
    try {
      const stat = await fs.stat(file, { bigint: true })
      metrics.statCount++
      const current = identity(stat),
        cached = cache.paths[file]
      if (cached?.identity === current && cached.version === version && cache.features[cached.key]) {
        metrics.cacheHit++
        values.push(cache.features[cached.key])
        continue
      }
      if (cached?.identity === current && cached.version !== version) metrics.oldVersionRejected++
      const child = await execute(
        process.execPath,
        [
          `--max-old-space-size=${limits.heapMiB}`,
          fileURLToPath(import.meta.url),
          root,
          'feature',
          file,
          version === newVersion ? 'v2' : 'v1'
        ],
        { timeout: limits.childMs, maxBuffer: 1024 * 1024 }
      )
      const result = JSON.parse(child.stdout)
      metrics.readBytes += result.readBytes
      metrics.decodeCount += result.decodeCount
      metrics.featureProcessingMs += result.elapsedMs
      metrics.maxChildPeakRSS = Math.max(metrics.maxChildPeakRSS, result.peakRSS)
      if (result.error) throw new Error('FeatureFailure')
      const key = `${result.sha}:${version}`
      cache.paths[file] = { identity: result.identity, version, key }
      cache.features[key] = {
        views: result.views,
        whiteRectangle: result.whiteRectangle,
        previewSize: result.previewSize
      }
      values.push(cache.features[key])
    } catch (error) {
      metrics.errors.push({ id, error: error?.code || error?.name || 'Failure' })
      values.push(null)
    }
  }
  await fs.writeFile(cacheFile, JSON.stringify(cache))
  return {
    values,
    metrics: {
      ...metrics,
      elapsedMs: performance.now() - start,
      parentLifetimePeakRSS: rss(),
      status: metrics.errors.length ? 'incomplete' : 'complete'
    }
  }
}
const old = await pass('v1-cold', oldVersion)
const refined = await pass('v2-cold-version-upgrade', newVersion)
cache = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
const warm = await pass('v2-persisted-hot', newVersion)

function evaluate(values) {
  const start = performance.now(),
    index = new core.VisualViewIndex(lock.parameters.minimumInformation)
  values.forEach((value, i) => {
    if (value) index.add(i, value.views)
  })
  const queryResults = new Map(),
    queryRows = []
  for (const source of new Set(cases.map((c) => c.a))) {
    if (!values[source]) continue
    const query = index.query(values[source].views, lock.postingBudget, lock.candidateBudget)
    const matched = new Map()
    let comparisons = 0
    for (const target of query.candidates) {
      const result = core.compareVisualViews(values[source].views, values[target].views, lock.parameters)
      comparisons += result.comparisons
      if (result.matched) matched.set(target, result.matches)
    }
    queryResults.set(source, { ...query, matched })
    queryRows.push({
      source: files[source].id,
      status: query.status,
      reason: query.reason,
      postingVisits: query.postingVisits,
      candidateCount: query.candidates.length,
      viewComparisons: comparisons,
      matchedPagesIncludingSelf: matched.size,
      matchedTargetIds: [...matched.keys()].map((target) => files[target].id)
    })
  }
  const rows = cases.map((c) => {
    if (!values[c.a] || !values[c.b])
      return { id: c.id, kind: c.kind, expectation: c.expectation, status: 'incomplete' }
    const direct = core.compareVisualViews(values[c.a].views, values[c.b].views, lock.parameters)
    const query = queryResults.get(c.a)
    return {
      id: c.id,
      kind: c.kind,
      expectation: c.expectation,
      status: query.status,
      direct: direct.matched,
      retrieved: query.candidates.includes(c.b),
      endToEnd: query.status === 'complete' && query.matched.has(c.b),
      evidence: direct.matches
    }
  })
  const matrix = Object.fromEntries(
    lock.cases.map((kind) => {
      const selected = rows.filter((r) => r.kind === kind)
      return [
        kind,
        {
          expectation: selected[0].expectation,
          total: selected.length,
          direct: selected.filter((r) => r.direct).length,
          retrieved: selected.filter((r) => r.retrieved).length,
          endToEnd: selected.filter((r) => r.endToEnd).length,
          incomplete: selected.filter((r) => r.status !== 'complete').length
        }
      ]
    })
  )
  return { matrix, rows, queries: queryRows, elapsedMs: performance.now() - start, parentLifetimePeakRSS: rss() }
}
// The only fresh-sample evaluation; parameters were frozen before reading any sample.
const evaluation = { v1: evaluate(old.values), v2: evaluate(refined.values) }
const changedTarget = cases.find((c) => c.kind === 'local-black').b
await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } })
  .png()
  .toFile(files[changedTarget].file)
const changed = await pass('v2-one-variant-changed', newVersion)
const anonymousInput = samples.map(({ id, sha256 }) => ({ id, sha256 }))
const report = {
  status:
    [old, refined, warm, changed].some((pass) => pass.metrics.status !== 'complete') ||
    Object.values(evaluation).some((result) => result.rows.some((row) => row.status !== 'complete'))
      ? 'offline-refinement-incomplete-stop-for-review'
      : 'offline-refinement-complete-stop-for-review',
  sampleBoundary: {
    realImages: samples.length,
    sourceDirectories: new Set(privateManifest.samples.map((sample) => sample.sourceGroup)).size,
    realLabeledVersionPairs: privateManifest.realLabeledVersionPairs.length,
    contentDisjointFromPrior: privateManifest.contentDisjointFromPrior,
    independentArtworkFamilies: false,
    description: 'Unseen SHA, includes unseen pages from prior artwork families; no real version truth.'
  },
  parameterLock: lock,
  parameterLockSHA: sha(await fs.readFile(lockFile)),
  anonymousInputSHA: sha(JSON.stringify(anonymousInput)),
  versions: { v1: oldVersion, v2: newVersion, sharp: sharp.versions.sharp },
  preparation: { elapsedMs: preparationMs, readBytes: preparationReadBytes, excludedFromFeatureCacheMetrics: true },
  evaluation,
  cache: [old.metrics, refined.metrics, warm.metrics, changed.metrics],
  resources: {
    limits,
    imageCountIncludingVariants: files.length,
    v1HashPayloadBytes: old.values.reduce((sum, value) => sum + (value?.views.length || 0) * 80, 0),
    v2HashPayloadBytes: refined.values.reduce((sum, value) => sum + (value?.views.length || 0) * 80, 0),
    maxViewsPerImage: Math.max(...refined.values.map((value) => value?.views.length || 0)),
    parentLifetimePeakRSS: rss(),
    measurement:
      'RSS uses maxRSS KiB *1024; parent and max single child reported separately, not concurrent process-tree RSS. Hash payload excludes JS/JSON/index/information metadata. v2 decodes original compressed input twice to preserve exact v1 view and build RGB preview; raw-view resizes are not counted as compressed decodes. Read bytes are application buffers, not physical disk IO.'
  },
  limitations: [
    'Zero manually confirmed real version pairs; no online or deletion integration.',
    'One frozen fresh-content evaluation, not new independent artwork-family validation.',
    'White trimming can remove genuine artwork whitespace; preserve original view evidence.',
    'Synthetic random subjects in common frame are limited negative controls, not real semantic evidence.',
    'Same-source local semantic edits are ambiguity, not known negatives.',
    'Exact 16-bit bands remain approximate and may miss accepted comparisons.',
    'V8 heap limit does not cap native RSS; subprocess/pixel/file/walltime bounds are experimental.',
    'Preparation uses trusted copies and pixel/file limits; no production safe-reader claim.',
    'No 500k, NAS, database, production I/O, or browsing-concurrency test.'
  ]
}
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      report: path.join(output, 'report.json'),
      matrix: { v1: evaluation.v1.matrix, v2: evaluation.v2.matrix },
      cache: report.cache,
      resources: report.resources
    },
    null,
    2
  )
)
