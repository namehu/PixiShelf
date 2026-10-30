const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const req = createRequire(path.join(repo, 'packages/pixishelf/package.json'))
const { PrismaClient } = req('@prisma/client')
const input = new URL(process.env.DATABASE_URL || '')
assert.equal(input.hostname, '127.0.0.1')
assert.equal(input.port, '55432')
assert.equal(input.pathname, '/dedup_hot_reuse_restart_20261030')
async function main() {
  for (const kind of ['restart', 'browser']) {
    const target = new URL(input)
    target.pathname = '/dedup_hot_reuse_' + kind + '_20261030'
    const db = new PrismaClient({ datasourceUrl: target.toString() })
    try {
      const root = path.join(base, kind + '-media')
      assert.ok((await fs.stat(root)).isDirectory())
      assert.equal(
        await db.systemJob.count({
          where: { status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSING', 'PAUSED', 'CANCELLING'] } }
        }),
        0
      )
      assert.equal(await db.mediaContentPathWrite.count(), 0)
      const before = {
        contentFingerprints: await db.mediaContentFingerprint.count(),
        visualFingerprints: await db.mediaVisualFingerprint.count(),
        artworkFingerprints: await db.artworkContentFingerprint.count(),
        directoryStates: await db.mediaContentDirectoryState.count()
      }
      await db.$transaction(async (tx) => {
        await tx.mediaContentFingerprint.deleteMany()
        await tx.mediaVisualFingerprint.deleteMany()
        await tx.artworkContentFingerprint.deleteMany()
        await tx.mediaContentSource.updateMany({ data: { directoryStateId: null } })
        await tx.mediaContentDirectoryState.deleteMany()
        await tx.setting.update({ where: { key: 'scanPath' }, data: { value: root } })
      })
      const evidence = {
        at: new Date().toISOString(),
        database: target.pathname.slice(1),
        root,
        before,
        reason:
          'Independent copied fixture root has a new filesystem/root identity; discard only rebuildable clone-local cache/directory namespace before first cold run. Historical results and media bytes retained.',
        preservedMeasurementInputsModified: false,
        historicalRunsRetained: await db.artworkDedupRun.count()
      }
      await fs.writeFile(
        path.join(base, 'evidence', kind + '-root-retarget.json'),
        JSON.stringify(evidence, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' }
      )
      console.log(JSON.stringify(evidence))
    } finally {
      await db.$disconnect()
    }
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
