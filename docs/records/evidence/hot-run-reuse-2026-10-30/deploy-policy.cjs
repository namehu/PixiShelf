const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const req = createRequire(path.join(repo, 'packages/pixishelf/package.json'))
const { PrismaClient } = req('@prisma/client')
const input = new URL(process.env.DATABASE_URL || '')
assert.equal(input.hostname, '127.0.0.1')
assert.equal(input.port, '55432')
assert.equal(input.pathname, '/dedup_hot_reuse_core_20261030')
const verifyOnly = process.argv.includes('--verify-only')
const kinds = process.argv.slice(2).filter((value) => value !== '--verify-only')
assert.ok(kinds.length > 0)
for (const kind of kinds)
  assert.ok(['core', 'after', 'browser', 'restart'].includes(kind), 'Baseline and unrelated databases are forbidden')
async function fingerprints(db) {
  const result = {}
  for (const table of [
    'Artwork',
    'Image',
    'MediaContentFingerprint',
    'MediaVisualFingerprint',
    'ArtworkDedupRun',
    'system_jobs'
  ]) {
    const key = table === 'MediaContentFingerprint' || table === 'MediaVisualFingerprint' ? 'imageId' : 'id'
    result[table] = (
      await db.$queryRawUnsafe(
        `SELECT count(*)::integer count, md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY "${key}"),'')) digest FROM "${table}" t`
      )
    )[0]
  }
  return result
}
async function main() {
  for (const kind of kinds) {
    const target = new URL(input)
    target.pathname = '/dedup_hot_reuse_' + kind + '_20261030'
    const db = new PrismaClient({ datasourceUrl: target.toString(), errorFormat: 'minimal' })
    try {
      const before = await fingerprints(db)
      if (!verifyOnly)
        await fs.writeFile(
          path.join(base, 'evidence', kind + '-policy-before.json'),
          JSON.stringify(before, null, 2) + '\n',
          { mode: 0o600, flag: 'wx' }
        )
      if (!verifyOnly)
        await new Promise((resolve, reject) => {
          const child = spawn('pnpm', ['--filter', '@pixishelf/db', 'db:deploy'], {
            cwd: repo,
            env: { ...process.env, DATABASE_URL: target.toString() },
            stdio: ['ignore', 'pipe', 'pipe']
          })
          let stdout = '',
            stderr = ''
          child.stdout.on('data', (data) => (stdout += data))
          child.stderr.on('data', (data) => (stderr += data))
          child.on('error', reject)
          child.on('close', async (code) => {
            await fs.writeFile(path.join(base, 'evidence', kind + '-policy-migration.log'), stdout + stderr, {
              mode: 0o600,
              flag: 'wx'
            })
            code === 0 ? resolve() : reject(Error('Migration failed; see private migration log'))
          })
        })
      const after = await fingerprints(db)
      assert.deepEqual(after, before, 'Existing domain rows changed during policy migration')
      const data = {
        id: randomUUID(),
        type: 'ARTWORK_DEDUP_SCAN',
        definitionVersion: 9,
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: new Date(),
        maxAttempts: 3,
        payload: { runId: 'policy-check', executionVersion: 1 }
      }
      await db.$transaction(async (tx) => {
        await tx.systemJob.create({ data })
        await tx.systemJob.delete({ where: { id: data.id } })
      })
      for (const override of [{ definitionVersion: 10 }, { queuePriority: 800, effectivePriority: 800 }]) {
        await assert.rejects(
          db.systemJob.create({ data: { ...data, ...override, id: randomUUID() } }),
          (error) =>
            String(error.message).includes('23514') && String(error.message).includes('system_jobs_dedup_policy')
        )
      }
      assert.deepEqual(await fingerprints(db), before, 'Policy probes left domain rows')
      const migrations = await db.$queryRawUnsafe(
        'SELECT count(*)::integer count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
      )
      const evidence = {
        at: new Date().toISOString(),
        database: target.pathname.slice(1),
        migration: '20261030000100_artwork_dedup_hot_run_reuse',
        migrationCount: migrations[0].count,
        existingRowsPreserved: true,
        verificationOnly: verifyOnly,
        rowFingerprints: before,
        checks: { scanV9Accepted: true, scanV10Rejected: true, invalidPriorityRejected: true, probesLeaveNoRows: true }
      }
      await fs.writeFile(path.join(base, 'evidence', kind + '-policy.json'), JSON.stringify(evidence, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx'
      })
      console.log(
        JSON.stringify({
          database: evidence.database,
          migrationCount: evidence.migrationCount,
          existingRowsPreserved: true,
          checks: evidence.checks
        })
      )
    } finally {
      await db.$disconnect()
    }
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
