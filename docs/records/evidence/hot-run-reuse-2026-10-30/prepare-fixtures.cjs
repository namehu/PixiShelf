const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')

const preserved = '/private/tmp/pixishelf-dedup-hot-20261030'
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const expectedDump = '27f56230021955550eae72292d8db06e02894177ced3008653e1a2fe46835b0a'
const input = new URL(process.env.DATABASE_URL || '')
assert.equal(input.hostname, '127.0.0.1')
assert.equal(input.port, '55432')
assert.equal(input.pathname, '/dedup_hot_seed_20261030')
const pg = {
  ...process.env,
  PGHOST: input.hostname,
  PGPORT: input.port,
  PGUSER: decodeURIComponent(input.username),
  PGPASSWORD: decodeURIComponent(input.password),
  PGDATABASE: 'postgres'
}
const bin = '/opt/homebrew/opt/libpq/bin/'
const json = (value) => JSON.stringify(value, null, 2) + '\n'
const hash = (value) => createHash('sha256').update(value).digest('hex')
function run(exe, args, env = pg) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env, cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(Error(stderr.replaceAll(decodeURIComponent(input.password), '<redacted>')))
    )
  })
}
const sql = (query) => run(bin + 'psql', ['-XAt', '-v', 'ON_ERROR_STOP=1', '-c', query])
async function save(name, data) {
  await fs.writeFile(path.join(base, 'evidence', name), json(data), { mode: 0o600, flag: 'wx' })
}

async function main() {
  await fs.mkdir(base, { recursive: false, mode: 0o700 })
  await fs.mkdir(path.join(base, 'evidence'), { mode: 0o700 })
  const dump = path.join(preserved, 'checkpoint.dump')
  assert.equal(hash(await fs.readFile(dump)), expectedDump, 'Preserved dump checksum differs')
  const manifest = JSON.parse(await fs.readFile(path.join(preserved, 'manifest.json'), 'utf8'))
  assert.equal(manifest.files, 2000)
  assert.equal(manifest.artworks.length, 50)
  const content = createHash('sha256')
  let files = 0
  for (const artwork of manifest.artworks)
    for (const file of artwork.files) {
      const location = path.join(manifest.root, file.path)
      assert.ok(location.startsWith(preserved + '/media/'))
      const bytes = await fs.readFile(location),
        sha256 = hash(bytes),
        stat = await fs.stat(location, { bigint: true })
      assert.equal(sha256, file.sha256)
      content.update(
        JSON.stringify([file.path, sha256, String(stat.size), String(stat.mtimeNs), String(stat.ino), String(stat.dev)])
      )
      files++
    }
  const fileStateDigest = content.digest('hex')
  assert.equal(files, 2000)
  assert.equal(fileStateDigest, manifest.fileStateDigest, 'Preserved physical fixture metadata changed')
  await fs.writeFile(path.join(base, 'manifest.json'), json({ ...manifest, reusedBy: 'hot-run-reuse-2026-10-30' }), {
    mode: 0o600,
    flag: 'wx'
  })
  const sqlDump = await run(bin + 'pg_restore', ['--file', '-', dump])
  const restore = path.join(base, 'checkpoint-restore.sql')
  await fs.writeFile(restore, sqlDump.replace(/^SET transaction_timeout = 0;\n/m, ''), { mode: 0o600, flag: 'wx' })
  const evidence = {
    at: new Date().toISOString(),
    dumpSha256: expectedDump,
    fileStateDigest,
    files,
    artworks: 50,
    preservedSourceModified: false,
    compatibility:
      'Only SET transaction_timeout = 0 removed from private SQL restore for PostgreSQL server compatibility.',
    clones: []
  }
  for (const kind of ['baseline', 'after', 'browser', 'restart', 'core']) {
    const name = 'dedup_hot_reuse_' + kind + '_20261030'
    assert.match(name, /^dedup_hot_reuse_(baseline|after|browser|restart|core)_20261030$/)
    assert.equal(
      (await sql("SELECT datname FROM pg_database WHERE datname = '" + name + "'")).trim(),
      '',
      'Refusing existing database'
    )
    await sql('CREATE DATABASE ' + name + ' TEMPLATE template0')
    const target = new URL(input)
    target.pathname = '/' + name
    let exports = ''
    for (const key of ['DATABASE_URL', 'QUEUE_KERNEL_TEST_DATABASE_URL', 'ARTWORK_DEDUP_V2_TEST_DATABASE_URL'])
      exports += 'export ' + key + "='" + target.toString().replaceAll("'", "'\\''") + "'\n"
    await fs.writeFile(path.join(base, kind + '.env.sh'), exports, { mode: 0o600, flag: 'wx' })
    if (kind === 'core') {
      const output = await run('pnpm', ['--filter', '@pixishelf/db', 'db:deploy'], {
        ...process.env,
        DATABASE_URL: target.toString()
      })
      await fs.writeFile(path.join(base, 'evidence/core-migrate.log'), output, { mode: 0o600, flag: 'wx' })
    } else await run(bin + 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--dbname', name, '--file', restore])
    const counts = (
      await run(
        bin + 'psql',
        [
          '-XAt',
          '-c',
          'SELECT (SELECT count(*) FROM "Artwork"), (SELECT count(*) FROM "Image"), (SELECT count(*) FROM "MediaContentFingerprint"), (SELECT count(*) FROM "MediaVisualFingerprint"), (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)'
        ],
        { ...pg, PGDATABASE: name }
      )
    ).trim()
    const currentMigrationCount = (
      await fs.readdir(path.join(repo, 'packages/pixishelf-db/prisma/migrations'), { withFileTypes: true })
    ).filter((entry) => entry.isDirectory()).length
    assert.equal(counts, kind === 'core' ? '0|0|0|0|' + currentMigrationCount : '50|2000|2000|2000|133')
    evidence.clones.push({
      database: name,
      counts,
      restore: kind === 'core' ? 'empty migrated test database' : 'same verified warm dump'
    })
    await fs.writeFile(path.join(base, 'evidence/checkpoint-progress.json'), json(evidence), { mode: 0o600 })
  }
  await save('checkpoint.json', evidence)
  console.log(json(evidence))
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
