const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const label = process.argv[2] ?? 'after'
assert.ok(['after', 'runtime'].includes(label))
const source = path.join(base, label + '-source')
const hash = (value) => createHash('sha256').update(value).digest('hex')
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    const output = [],
      errors = []
    child.stdout.on('data', (data) => output.push(data))
    child.stderr.on('data', (data) => errors.push(data))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(output)) : reject(Error(Buffer.concat(errors).toString()))
    )
  })
}
async function main() {
  const head = (await run('git', ['rev-parse', 'HEAD'])).toString().trim()
  assert.ok(head.startsWith('c8d1f380'), 'Expected uncommitted implementation over the agreed v0.55.2 source')
  await fs.mkdir(source, { recursive: false })
  await run('tar', ['-xf', path.join(base, 'baseline-source.tar'), '-C', source])
  const diff = await run('git', ['diff', '--binary', 'HEAD'])
  await fs.writeFile(path.join(base, label + '-source.patch'), diff, { mode: 0o600, flag: 'wx' })
  const tracked = (await run('git', ['diff', '--name-only', '-z', 'HEAD'])).toString().split('\0').filter(Boolean)
  const untracked = (await run('git', ['ls-files', '--others', '--exclude-standard', '-z']))
    .toString()
    .split('\0')
    .filter(Boolean)
  const overlays = {}
  for (const relative of [...new Set([...tracked, ...untracked])].sort()) {
    assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative))
    const original = path.join(repo, relative),
      destination = path.join(source, relative)
    const exists = await fs.stat(original).then(
      () => true,
      () => false
    )
    if (!exists) {
      await fs.rm(destination)
      overlays[relative] = null
      continue
    }
    const bytes = await fs.readFile(original)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, bytes)
    overlays[relative] = hash(bytes)
  }
  const evidence = { at: new Date().toISOString(), baseCommit: head, source, diffSha256: hash(diff), overlays }
  await fs.writeFile(path.join(base, 'evidence', label + '-freeze.json'), JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx'
  })
  console.log(
    JSON.stringify({
      source,
      baseCommit: head,
      diffSha256: evidence.diffSha256,
      overlaidFiles: Object.keys(overlays).length
    })
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
