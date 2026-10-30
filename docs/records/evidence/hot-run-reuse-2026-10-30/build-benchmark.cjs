const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const source = path.resolve(process.argv[2] || ''),
  label = process.argv[3]
assert.ok(source.startsWith(base + '/'))
assert.match(label || '', /^[a-z0-9-]+$/)
const req = createRequire(path.join(repo, 'packages/pixishelf-worker/package.json'))
const { build } = req('esbuild')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const driver = 'packages/pixishelf-job-executors/scripts/artwork-dedup-hot-run-reuse-benchmark.ts'

async function main() {
  for (const packageName of await fs.readdir(path.join(source, 'packages'))) {
    const modules = path.join(repo, 'packages', packageName, 'node_modules')
    if (
      await fs.stat(modules).then(
        () => true,
        () => false
      )
    ) {
      const target = path.join(source, 'packages', packageName, 'node_modules')
      if (
        !(await fs.lstat(target).then(
          () => true,
          () => false
        ))
      )
        await fs.symlink(modules, target)
    }
  }
  await fs.copyFile(path.join(repo, driver), path.join(source, driver))
  const out = path.join(base, label + '-bundle')
  await fs.mkdir(out, { recursive: false })
  const result = await build({
    metafile: true,
    absWorkingDir: path.join(source, 'packages/pixishelf-worker'),
    entryPoints: {
      'hot-run-reuse-benchmark': '../pixishelf-job-executors/scripts/artwork-dedup-hot-run-reuse-benchmark.ts',
      'artwork-dedup-reader': '../pixishelf-job-executors/src/artwork-dedup/reader-child.ts',
      'artwork-dedup-visual-search': '../pixishelf-job-executors/src/artwork-dedup/visual-search-thread.ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outdir: out,
    outExtension: { '.js': '.cjs' },
    tsconfig: path.join(source, 'packages/pixishelf-worker/tsconfig.json'),
    alias: Object.fromEntries(
      ['db', 'job-contracts', 'job-runtime', 'job-executors'].map((name) => [
        '@pixishelf/' + name,
        path.join(source, 'packages/pixishelf-' + name, 'src/index.ts')
      ])
    ),
    external: ['@prisma/client', '.prisma/client', 'sharp'],
    logLevel: 'warning'
  })
  await fs.symlink(path.join(repo, 'packages/pixishelf-worker/node_modules'), path.join(out, 'node_modules'))
  await fs.copyFile(
    '/private/tmp/pixishelf-dedup-hot-20261030/service-bundle/artwork-dedup-native.node',
    path.join(out, 'artwork-dedup-native.node')
  )
  const files = {},
    bundles = {}
  for (const input of Object.keys(result.metafile.inputs)) {
    const absolute = path.resolve(source, 'packages/pixishelf-worker', input)
    if (absolute.includes('/node_modules/')) continue
    assert.ok(absolute.startsWith(source + '/'), 'Source escaped frozen archive: ' + absolute)
    files[path.relative(source, absolute)] = hash(await fs.readFile(absolute))
  }
  for (const file of await fs.readdir(out))
    if (file.endsWith('.cjs') || file.endsWith('.node')) bundles[file] = hash(await fs.readFile(path.join(out, file)))
  const evidence = {
    at: new Date().toISOString(),
    source,
    label,
    baselineCommit: 'c8d1f380',
    driverSha256: hash(await fs.readFile(path.join(source, driver))),
    files: Object.fromEntries(Object.entries(files).sort()),
    bundles
  }
  await fs.writeFile(path.join(base, 'evidence', label + '-source.json'), JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx'
  })
  console.log(
    JSON.stringify({ label, out, sourceFiles: Object.keys(files).length, driverSha256: evidence.driverSha256, bundles })
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
