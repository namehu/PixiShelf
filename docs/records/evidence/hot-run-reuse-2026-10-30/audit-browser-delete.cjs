const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const repo = '/private/tmp/pixishelf-dedup-hot-run-reuse/PixiShelf'
const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const operationId = 'a705515b-9ea3-487b-bbe0-293565711fa9'
const action = process.argv[2]
assert.ok(['before', 'after'].includes(action))
const url = new URL(process.env.DATABASE_URL || '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.port, '55432')
assert.equal(url.pathname, '/dedup_hot_reuse_browser_20261030')
const req = createRequire(path.join(repo, 'packages/pixishelf/package.json'))
const { PrismaClient } = req('@prisma/client')
const db = new PrismaClient({ datasourceUrl: url.toString(), errorFormat: 'minimal' })
const json = (value) => JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item))
const hash = (value) => createHash('sha256').update(value).digest('hex')

async function main() {
  const operation = await db.artworkDedupOperation.findUniqueOrThrow({
    where: { id: operationId },
    select: {
      id: true,
      status: true,
      stage: true,
      keepers: true,
      copies: true,
      deletedFiles: true,
      directDeleteConfirmedAt: true,
      artworks: {
        orderBy: { artworkId: 'asc' },
        select: { artworkId: true, role: true, status: true, fileCount: true }
      }
    }
  })
  assert.equal(operation.status, action === 'before' ? 'READY' : 'DELETED')
  assert.equal(operation.stage, action === 'before' ? 'CONFIRM' : 'DONE')
  assert.equal(operation.deletedFiles, action === 'before' ? 0n : 2n)
  assert.equal(operation.keepers, 1)
  assert.equal(operation.copies, 1)
  assert.deepEqual(
    operation.artworks.map((row) => [row.artworkId, row.role, String(row.fileCount)]),
    [
      [51, 'KEEPER', '2'],
      [52, 'COPY', '2']
    ]
  )
  const manifests = []
  for (const name of [
    'browser-warm-manifest.json',
    'browser-exact-contains-manifest.json',
    'browser-partial-manifest.json',
    'browser-mixed-visual-manifest.json'
  ]) {
    const manifest = JSON.parse(await fs.readFile(path.join(base, name), 'utf8'))
    assert.equal(manifest.root, path.join(base, 'browser-media'))
    manifests.push(manifest)
  }
  const otherFileState = createHash('sha256'),
    targetFiles = []
  let othersVerified = 0
  for (const manifest of manifests)
    for (const artwork of manifest.artworks)
      for (const file of artwork.files) {
        const location = path.join(manifest.root, file.path)
        assert.ok(location.startsWith(path.join(base, 'browser-media') + '/'))
        if (artwork.id === 52 && action === 'after') {
          await assert.rejects(fs.stat(location), (error) => error.code === 'ENOENT')
          targetFiles.push({ artworkId: 52, path: file.path, exists: false })
          continue
        }
        const bytes = await fs.readFile(location),
          sha256 = hash(bytes),
          stat = await fs.stat(location, { bigint: true })
        assert.equal(sha256, file.sha256, 'Registered original changed: ' + file.path)
        if (artwork.id === 52) targetFiles.push({ artworkId: 52, path: file.path, exists: true, sha256 })
        else {
          otherFileState.update(
            json([artwork.id, file.path, sha256, stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.dev])
          )
          othersVerified++
        }
      }
  assert.equal(othersVerified, 2028)
  assert.equal(targetFiles.length, 2)
  const artworkIds = manifests
    .flatMap((manifest) => manifest.artworks.map((artwork) => artwork.id))
    .sort((a, b) => a - b)
  assert.equal(artworkIds.length, 58)
  const artworkRows = await db.artwork.findMany({
    where: { id: { in: artworkIds } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      source: true,
      createdVia: true,
      storagePath: true,
      storageKey: true,
      deletedAt: true,
      images: { orderBy: { id: 'asc' }, select: { id: true, path: true, size: true, mediaType: true, sortOrder: true } }
    }
  })
  const otherRows = artworkRows.filter((row) => row.id !== 52)
  const target = artworkRows.find((row) => row.id === 52)
  assert.equal(otherRows.length, 57)
  assert.equal(target?.images.length ?? 0, action === 'before' ? 2 : 0)
  assert.equal(!!target, action === 'before')
  const activeJobs = await db.systemJob.count({
    where: { status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSING', 'PAUSED', 'CANCELLING'] } }
  })
  assert.equal(activeJobs, 0)
  const result = {
    at: new Date().toISOString(),
    action,
    scope:
      'Read-only audit of the single user-approved synthetic operation. Actual delete is performed only through the browser.',
    database: url.pathname.slice(1),
    operation,
    activeJobs,
    targetFiles,
    targetArtworkPresent: !!target,
    targetImageRows: target?.images.length ?? 0,
    otherArtworksVerified: otherRows.length,
    otherOriginalsVerified: othersVerified,
    otherFileStateDigest: otherFileState.digest('hex'),
    otherDatabaseProjectionDigest: hash(json(otherRows)),
    keeper51: otherRows.find((row) => row.id === 51)
  }
  if (action === 'after') {
    const before = JSON.parse(await fs.readFile(path.join(base, 'evidence/browser-delete-resume-before.json'), 'utf8'))
    assert.equal(result.otherFileStateDigest, before.otherFileStateDigest, 'Other original file bytes/metadata changed')
    assert.equal(
      result.otherDatabaseProjectionDigest,
      before.otherDatabaseProjectionDigest,
      'Other artwork/media rows changed'
    )
    result.otherDataUnchanged = true
  }
  const filename = 'browser-delete-resume-' + action + '.json'
  const output = json(result) + '\n'
  await fs.writeFile(path.join(base, 'evidence', filename), output, { mode: 0o600, flag: 'wx' })
  await fs.writeFile(path.join(repo, 'docs/records/evidence/hot-run-reuse-2026-10-30', filename), output, {
    flag: 'wx'
  })
  console.log(
    json({
      action,
      operationId,
      status: operation.status,
      deletedFiles: operation.deletedFiles,
      targetArtworkPresent: result.targetArtworkPresent,
      otherArtworksVerified: result.otherArtworksVerified,
      otherOriginalsVerified: othersVerified,
      otherDataUnchanged: result.otherDataUnchanged ?? null
    })
  )
}
main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
