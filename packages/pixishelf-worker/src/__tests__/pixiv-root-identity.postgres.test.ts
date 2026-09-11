import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDatabaseClient } from '@pixishelf/db'
import { bindPixivInventoryRoot, resolveSafeScanRoot } from '@pixishelf/job-executors'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { inspectPixivRoot, maintainPixivRoot } from '../pixiv-root-identity.ts'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
const other = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
const suite = url ? describe.sequential : describe.skip
const prefix = `root-cli-${randomUUID()}`
const directories: string[] = []
let root: string

async function cleanup() {
  await database.jobResourceLease.deleteMany({ where: { workerId: prefix } })
  await database.systemJob.deleteMany({ where: { workerId: prefix } })
  await database.workerInstance.deleteMany({ where: { workerId: prefix } })
  await database.pixivMetadataInventoryState.deleteMany({ where: { id: 'pixiv' } })
}

suite('root identity maintenance with PostgreSQL', () => {
  beforeEach(async () => {
    await cleanup()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixiv-root-cli-'))
    directories.push(root)
    const current = await resolveSafeScanRoot(root)
    await database.pixivMetadataInventoryState.create({
      data: {
        id: 'pixiv',
        status: 'READY',
        rootPathHash: createHash('sha256').update(current.absolutePath).digest('hex'),
        rootDeviceId: current.deviceId + 2n,
        rootInode: current.inode,
        baselineGeneration: 7,
        baselineCompletedAt: new Date(1000)
      }
    })
  })
  afterAll(async () => {
    await cleanup()
    await Promise.all([database.$disconnect(), other.$disconnect()])
    await Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true, force: true })))
  })

  async function write(command: 'bind' | 'restore-marker' = 'bind', expected?: string) {
    return maintainPixivRoot({
      database,
      scanRoot: root,
      command,
      expected: expected ?? (await inspectPixivRoot(database, root)).fingerprint,
      confirmSameLibrary: true
    })
  }

  it('inspects without mutation, then explicitly binds legacy device drift without resetting the baseline', async () => {
    const old = await database.pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })
    const inspection = await inspectPixivRoot(database, root)
    expect(inspection.marker.status).toBe('MISSING')
    expect(await fs.readdir(root)).toEqual([])
    expect(await database.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })).toEqual(old)
    const result = await write('bind', inspection.fingerprint)
    expect(result.after).toMatchObject({
      status: old.status,
      baselineGeneration: 7,
      baselineCompletedAt: old.baselineCompletedAt
    })
    expect(result.after.rootIdentity).toMatch(/^[a-f0-9-]{36}$/)
    expect((await inspectPixivRoot(database, root)).marker.identity).toBe(result.after.rootIdentity)
  })

  it('requires explicit confirmation and rejects stale database observations without filesystem writes', async () => {
    const inspection = await inspectPixivRoot(database, root)
    await expect(
      maintainPixivRoot({
        database,
        scanRoot: root,
        command: 'bind',
        expected: inspection.fingerprint,
        confirmSameLibrary: false
      })
    ).rejects.toThrow('require --expect')
    await database.pixivMetadataInventoryState.update({ where: { id: 'pixiv' }, data: { baselineGeneration: 8 } })
    await expect(write('bind', inspection.fingerprint)).rejects.toThrow('stale')
    expect(await fs.readdir(root)).toEqual([])
  })

  it('rejects stale marker observations and never overwrites a malformed marker', async () => {
    const inspection = await inspectPixivRoot(database, root)
    await fs.writeFile(path.join(root, '.pixishelf-root'), '{')
    await expect(write('bind', inspection.fingerprint)).rejects.toThrow('stale')
    expect((await inspectPixivRoot(database, root)).marker.status).toBe('INVALID')
    await expect(write()).rejects.toThrow('Invalid root marker')
    expect(await fs.readFile(path.join(root, '.pixishelf-root'), 'utf8')).toBe('{')
  })

  it('restores only a missing marker using the original database UUID', async () => {
    const bound = await write()
    await expect(write('restore-marker')).rejects.toThrow('missing marker')
    await fs.unlink(path.join(root, '.pixishelf-root'))
    const restored = await write('restore-marker')
    expect(restored.after.rootIdentity).toBe(bound.after.rootIdentity)
    await expect(write()).rejects.toThrow('already has a UUID')
    await fs.writeFile(path.join(root, '.pixishelf-root'), JSON.stringify({ version: 1, id: randomUUID() }))
    await expect(write('restore-marker')).rejects.toThrow('missing marker')
  })

  it('reuses the complete marker after a database transaction fails', async () => {
    const current = await resolveSafeScanRoot(root)
    await expect(
      database.$transaction(async (tx) => {
        await bindPixivInventoryRoot(tx, current, new Date(), true)
        throw new Error('injected rollback')
      })
    ).rejects.toThrow('injected rollback')
    const inspection = await inspectPixivRoot(database, root)
    expect(inspection.state?.rootIdentity).toBeNull()
    expect(inspection.marker.status).toBe('VALID')
    expect((await write()).after.rootIdentity).toBe(inspection.marker.identity)
  })

  it('serializes competing bind commands, so only one writes', async () => {
    const expected = (await inspectPixivRoot(database, root)).fingerprint
    const outcomes = await Promise.allSettled([
      write('bind', expected),
      maintainPixivRoot({
        database: other,
        scanRoot: root,
        command: 'bind',
        expected,
        confirmSameLibrary: true
      })
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await inspectPixivRoot(database, root)).marker.identity).toBeTruthy()
  })

  it('shares the dispatcher lock and refuses to bind while queue claim holds it', async () => {
    await other.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended('lane/background-writer', 0)) IS NULL AS locked"
      )
      await expect(write()).rejects.toThrow('scheduling is busy')
    })
    expect(await fs.readdir(root)).toEqual([])
  })

  it('rejects a live Worker even if no job is currently running', async () => {
    await database.workerInstance.create({
      data: {
        workerId: prefix,
        status: 'READY',
        serviceVersion: 'test',
        hostname: 'test',
        processId: 1,
        heartbeatAt: new Date()
      }
    })
    await expect(write()).rejects.toThrow('Stop Worker')
    expect(await fs.readdir(root)).toEqual([])
  })

  it.each(['job', 'lease'] as const)('rejects an active %s with zero marker writes', async (kind) => {
    const job = await database.systemJob.create({
      data: {
        type: 'SCAN',
        workerId: prefix,
        status: kind === 'job' ? 'RUNNING' : 'PENDING',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        heartbeatAt: new Date(),
        attempt: 1
      }
    })
    if (kind === 'lease')
      await database.jobResourceLease.create({
        data: {
          resourceKey: 'lane/background-writer',
          ownerJobId: job.id,
          workerId: prefix,
          leaseToken: job.leaseToken!,
          expiresAt: new Date(Date.now() + 60_000),
          heartbeatAt: new Date()
        }
      })
    await expect(write()).rejects.toThrow('Stop Worker')
    expect(await fs.readdir(root)).toEqual([])
  })
})
