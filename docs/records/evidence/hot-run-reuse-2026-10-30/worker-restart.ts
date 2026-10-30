import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { PrismaClient, freezeArtworkDedupRun } from '@pixishelf/db'

const base = '/private/tmp/pixishelf-hot-run-reuse-20261030'
const root = path.join(base, 'restart-media'),
  out = path.join(base, 'evidence/worker-restart')
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.port, '55432')
assert.equal(url.pathname, '/dedup_hot_reuse_restart_20261030')
assert.equal(process.env.SOURCE_MEDIA_ROOT, root)
const db = new PrismaClient({ datasourceUrl: url.toString() })
const json = (value: unknown) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item), 2) + '\n'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex')
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
let worker: ChildProcess | undefined, log: Awaited<ReturnType<typeof fs.open>> | undefined
const processes: any[] = [],
  cases: any[] = []
let releaseBarrier: (() => void) | undefined, barrierTransaction: Promise<void> | undefined
const save = (name: string, value: unknown) =>
  fs.writeFile(path.join(out, name + '.json'), json(value), { mode: 0o600 })

async function start(label: string) {
  log = await fs.open(path.join(out, label + '.log'), 'wx', 0o600)
  worker = spawn(process.execPath, [path.join(base, 'service-bundle/main.cjs')], {
    env: process.env,
    stdio: ['ignore', log.fd, log.fd]
  })
  const entry: any = { label, pid: worker.pid, workerId: process.env.WORKER_ID, at: new Date().toISOString() }
  processes.push(entry)
  worker.on('exit', (code, signal) => {
    entry.exitAt = new Date().toISOString()
    entry.code = code
    entry.signal = signal
  })
  await save('processes', processes)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    assert.ok(worker.pid && alive(worker.pid), 'Owned Worker exited during startup')
    const ready = await fetch('http://127.0.0.1:' + process.env.WORKER_HEALTH_PORT + '/readyz').then(
      (response) => response.ok,
      () => false
    )
    if (ready) return
    await sleep(100)
  }
  throw Error('Owned Worker did not become ready')
}
async function stop(signal: NodeJS.Signals = 'SIGTERM') {
  if (worker?.pid && alive(worker.pid)) {
    worker.kill(signal)
    const deadline = Date.now() + 2500
    while (Date.now() < deadline && alive(worker.pid)) await sleep(50)
    if (alive(worker.pid)) worker.kill('SIGKILL')
  }
  await log?.close()
  log = undefined
  worker = undefined
  await save('processes', processes)
}
async function enqueue(artistId: number, requestedBy: string, mode: 'FULL' | 'INCREMENTAL') {
  return db.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId,
      requestedBy,
      idempotencyKey: randomUUID(),
      mode,
      includeSuspectedVersions: false
    })
    const job = await tx.systemJob.create({
      data: {
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
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return { runId: run.id, jobId: job.id }
  })
}
async function snapshot(identity: { runId: string; jobId: string }) {
  const run = await db.artworkDedupRun.findUniqueOrThrow({
    where: { id: identity.runId },
    select: {
      id: true,
      status: true,
      stage: true,
      statMedia: true,
      cacheHitMedia: true,
      hashedMedia: true,
      readBytes: true,
      changedArtworks: true,
      failedArtworks: true,
      groupCount: true,
      visualCheckpoint: true,
      performanceSummary: true,
      readerOwner: true
    }
  })
  const readerPid = (run.readerOwner as any)?.childPid ?? null
  const { readerOwner: _readerOwner, ...safeRun } = run
  const job = await db.systemJob.findUniqueOrThrow({
    where: { id: identity.jobId },
    select: { id: true, status: true, stage: true, progress: true, attempt: true }
  })
  return {
    at: new Date().toISOString(),
    run: safeRun,
    readerPid,
    readerAlive: readerPid ? alive(readerPid) : null,
    job,
    media: await db.artworkDedupMedia.count({ where: { runId: identity.runId } }),
    groups: await db.artworkDedupGroup.count({ where: { runId: identity.runId } }),
    members: await db.artworkDedupGroupMember.count({ where: { runId: identity.runId } })
  }
}
async function terminal(identity: { runId: string; jobId: string }) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const current = await snapshot(identity)
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.job.status)) {
      assert.equal(current.job.status, 'COMPLETED', json(current))
      return current
    }
    assert.ok(worker?.pid && alive(worker.pid), 'Owned Worker exited before terminal state')
    await sleep(40)
  }
  throw Error('Timed out waiting for small restart fixture')
}
async function barrier(runId: string, kind: 'originals' | 'copy') {
  const key = 7371
  let held!: () => void
  const heldPromise = new Promise<void>((resolve) => (held = resolve))
  const released = new Promise<void>((resolve) => (releaseBarrier = resolve))
  barrierTransaction = db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', key)
      held()
      await released
    },
    { timeout: 90_000 }
  )
  await heldPromise
  const predicate =
    kind === 'originals'
      ? 'NEW."statMedia" > 500'
      : "NEW.\"visualCheckpoint\"->>'kind' = 'hot-run-reuse' AND NEW.\"visualCheckpoint\"->>'stage' = 'relations'"
  // This test-only barrier makes the next transaction wait after a committed prefix.
  // SIGKILL then proves rollback and replay without depending on a polling race.
  assert.match(runId, /^[0-9a-f-]{36}$/)
  await db.$executeRawUnsafe(
    `CREATE FUNCTION hot_run_restart_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${runId}' AND (${predicate}) THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`
  )
  await db.$executeRawUnsafe(
    'CREATE TRIGGER hot_run_restart_barrier BEFORE UPDATE ON "ArtworkDedupRun" FOR EACH ROW EXECUTE FUNCTION hot_run_restart_barrier()'
  )
}
async function clearBarrier() {
  releaseBarrier?.()
  releaseBarrier = undefined
  await barrierTransaction
  barrierTransaction = undefined
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS hot_run_restart_barrier ON "ArtworkDedupRun"')
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS hot_run_restart_barrier()')
}

async function main() {
  await fs.mkdir(out, { recursive: false, mode: 0o700 })
  const reuseFixture = process.argv.includes('--reuse-fixture')
  if (!reuseFixture) await fs.mkdir(root, { recursive: false })
  const manifest = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'))
  const artist = reuseFixture
    ? await db.artist.findFirstOrThrow({ where: { name: '热检进程重启 · 502 极小原件' } })
    : await db.artist.create({ data: { name: '热检进程重启 · 502 极小原件' } })
  const artworks: number[] = reuseFixture
    ? (await db.artwork.findMany({ where: { creators: { some: { artistId: artist.id } } }, select: { id: true } })).map(
        (work) => work.id
      )
    : []
  if (reuseFixture) {
    assert.equal(artworks.length, 2)
    assert.equal(await db.image.count({ where: { artworkId: { in: artworks } } }), 502)
  }
  for (const side of reuseFixture ? [] : ['a', 'b']) {
    const directory = 'small-restart-' + side
    await fs.mkdir(path.join(root, directory))
    const images = []
    for (let index = 0; index < 251; index++) {
      const relative = directory + '/' + String(index).padStart(3, '0') + '.bin',
        bytes = Buffer.from('hot-reuse-restart-' + index)
      await fs.writeFile(path.join(root, relative), bytes, { flag: 'wx' })
      images.push({ path: relative, size: BigInt(bytes.length), mediaType: 'UNKNOWN' as const, sortOrder: index })
    }
    const artwork = await db.artwork.create({
      data: {
        title: '重启极小原件 ' + side,
        source: 'LOCAL_CREATED',
        createdVia: 'MANUAL_CREATE',
        storagePath: directory,
        storageKey: directory,
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } }
          }
        },
        images: { create: images }
      }
    })
    artworks.push(artwork.id)
  }
  await start('warm')
  const warmIdentity = await enqueue(artist.id, manifest.account.userId, 'FULL')
  const warm = await terminal(warmIdentity)
  assert.equal(warm.run.statMedia, 502)
  assert.equal(warm.groups, 1)
  assert.equal(warm.members, 2)
  await save('warm', warm)
  await stop()
  for (const kind of ['originals', 'copy'] as const) {
    const identity = await enqueue(artist.id, manifest.account.userId, 'INCREMENTAL')
    await barrier(identity.runId, kind)
    await start(kind + '-before-kill')
    let before: Awaited<ReturnType<typeof snapshot>> | undefined
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const blocked = await db.$queryRawUnsafe<Array<{ blocked: bigint }>>(
        "SELECT count(*) blocked FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'"
      )
      if (Number(blocked[0]!.blocked) > 0) {
        before = await snapshot(identity)
        break
      }
      await sleep(10)
    }
    assert.ok(before, 'Worker never reached deterministic ' + kind + ' barrier')
    if (kind === 'originals') {
      assert.equal(before.run.statMedia, 500)
      assert.equal(before.media, 500)
    } else {
      assert.equal((before.run.visualCheckpoint as any)?.stage, 'members')
      assert.equal(before.groups, 1)
      assert.equal(before.members, 0)
    }
    await save(kind + '-before-sigkill', before)
    const killedPid = worker!.pid!
    await stop('SIGKILL')
    assert.equal(alive(killedPid), false)
    const afterKill = await snapshot(identity)
    assert.equal(afterKill.run.statMedia, before.run.statMedia)
    assert.equal(afterKill.media, before.media)
    assert.equal(afterKill.members, before.members)
    if (before.readerPid) {
      const readerDeadline = Date.now() + 5000
      while (Date.now() < readerDeadline && alive(before.readerPid)) await sleep(50)
      assert.equal(alive(before.readerPid), false, 'Owned reader survived its killed Worker')
    }
    await save(kind + '-after-sigkill', afterKill)
    await clearBarrier()
    await start(kind + '-after-restart')
    const completed = await terminal(identity)
    assert.ok(completed.job.attempt > before.job.attempt)
    assert.equal(completed.run.statMedia, 502)
    assert.equal(completed.run.cacheHitMedia, 502)
    assert.equal(completed.run.hashedMedia, 0)
    assert.equal(completed.run.readBytes, 0n)
    assert.equal(completed.run.changedArtworks + completed.run.failedArtworks, 0)
    assert.equal(completed.media, 502)
    assert.equal(completed.groups, 1)
    assert.equal(completed.members, 2)
    assert.equal((completed.run.visualCheckpoint as any)?.stage, 'done')
    const groups = await db.artworkDedupGroup.findMany({
      where: { runId: identity.runId },
      include: { members: { orderBy: { artworkId: 'asc' } } }
    })
    const resultDigest = hash(
      groups.map((group) => ({
        contentSha256: group.contentSha256,
        fileCount: group.fileCount,
        members: group.members.map((member) => member.artworkId)
      }))
    )
    cases.push({
      kind,
      identity,
      killedPid,
      committedPrefix: {
        statMedia: before.run.statMedia,
        media: before.media,
        groups: before.groups,
        members: before.members,
        copyStage: (before.run.visualCheckpoint as any)?.stage ?? null
      },
      restartAttempt: completed.job.attempt,
      resultDigest,
      completed
    })
    await save(kind + '-completed', completed)
    await stop()
  }
  assert.equal(cases[0].resultDigest, cases[1].resultDigest)
  await save('assertions', {
    passed: true,
    fixture: { artistId: artist.id, artworks, originals: 502, bytesPerFile: '21–23' },
    scope:
      'Actual Worker SIGKILL/restart on small synthetic fixture; deterministic database barrier holds only the uncommitted next batch. No measurement database or preserved file mutation.',
    cases
  })
  console.log(
    json({
      passed: true,
      cases: cases.map(({ kind, committedPrefix, restartAttempt, resultDigest }) => ({
        kind,
        committedPrefix,
        restartAttempt,
        resultDigest
      }))
    })
  )
}
main()
  .catch(async (error) => {
    console.error(error.message)
    await save('error', { error: error.stack ?? String(error) }).catch(() => {})
    process.exitCode = 1
  })
  .finally(async () => {
    await stop().catch(() => {})
    await clearBarrier().catch(() => {})
    await db.$disconnect()
  })
