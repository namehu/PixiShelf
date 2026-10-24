// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { captureArtworkDedupSources, createDatabaseClient, disconnectDatabase, Prisma } from '@pixishelf/db'
import { parseArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ database: null as unknown, root: '' }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return state.database
  }
}))
vi.mock('@/services/setting.service', () => ({
  getScanPath: async () => state.root,
  getSystemSettings: async () => ({ local_import_default_tag_ids: [] })
}))
vi.mock('@/services/migration-service', () => ({ buildMigrationSelection: vi.fn() }))
import {
  enqueueCentralScan,
  enqueueCentralArtworkRescan,
  enqueueCentralLocalDirectoryImport
} from '../media-root-central-service'

const url = process.env.PIXISHELF_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_app_inputs112') {
    throw new Error('Requires the dedicated synthetic App input database')
  }
}
const describePostgres = url ? describe : describe.skip
const database = createDatabaseClient(url ? { datasourceUrl: url } : undefined)
state.database = database
const prefix = `dedup-scan-input-${randomUUID()}`
const userId = `${prefix}-user`
const externalIds = ['7718100001', '7718100002', '7718100003', '7718100004']
let artistId: number
const sourceIds = new Set<string>()

describePostgres('App scan frozen source proof transaction', () => {
  beforeAll(async () => {
    await database.$connect()
    state.root = await mkdtemp(path.join(os.tmpdir(), 'dedup-app-scan-input-'))
    for (const id of externalIds) await writeFile(path.join(state.root, `${id}-meta.json`), JSON.stringify({ id }))
    await mkdir(path.join(state.root, 'local-imports/fixture/work'), { recursive: true })
    await writeFile(path.join(state.root, 'local-imports/fixture/work/1.jpg'), 'synthetic-media')
    artistId = (await database.artist.create({ data: { name: prefix } })).id
    await database.localImportArtistMapping.create({ data: { artistDirectory: 'fixture', artistId } })
  })
  afterAll(async () => {
    const jobs = await database.systemJob.findMany({ where: { requestedByUserId: userId }, select: { id: true } })
    await database.scanRun.deleteMany({ where: { systemJobId: { in: jobs.map((job) => job.id) } } })
    await database.systemJob.deleteMany({ where: { requestedByUserId: userId } })
    await database.artwork.deleteMany({ where: { title: prefix } })
    await database.localImportArtistMapping.deleteMany({ where: { artistId } })
    await database.artist.delete({ where: { id: artistId } })
    await database.artworkDedupSourceIdentity.deleteMany({
      where: { OR: [{ id: { in: [...sourceIds] } }, { providerKey: 'pixiv', externalId: { in: externalIds } }] }
    })
    await disconnectDatabase(database)
    await rm(state.root, { recursive: true, force: true })
  })

  it('freezes two Pixiv identities in the queued transaction and never renews reused input proof', async () => {
    const input = {
      type: 'list' as const,
      metadataList: externalIds.slice(0, 2).map((id) => `${id}-meta.json`),
      requestedByUserId: userId
    }
    const queued = await enqueueCentralScan(input)
    const rows = await database.scanRunMetadataInput.findMany({
      where: { scanRunId: queued.scanRunId },
      orderBy: { ordinal: 'asc' }
    })
    expect(rows).toHaveLength(2)
    for (const [index, row] of rows.entries()) {
      const proof = parseArtworkDedupSourceSnapshot(row.dedupSourceSnapshot)
      proof.sources.forEach((source) => sourceIds.add(source.sourceId))
      expect(proof.sources.map((source) => source.identity)).toEqual([
        { kind: 'PROVIDER', providerKey: 'pixiv', externalId: externalIds[index] },
        {
          kind: 'PATH',
          logicalRoot: 'source-media:v1',
          rootIdentity: expect.any(String),
          canonicalPath: `${externalIds[index]}-meta.json`
        }
      ])
    }
    expect((await enqueueCentralScan(input)).reused).toBe(true)
    await database.scanRunMetadataInput.update({
      where: { id: rows[0]!.id },
      data: { dedupSourceSnapshot: Prisma.DbNull }
    })
    await expect(enqueueCentralScan(input)).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
    expect(
      (await database.scanRunMetadataInput.findUniqueOrThrow({ where: { id: rows[0]!.id } })).dedupSourceSnapshot
    ).toBeNull()
    await database.systemJob.update({ where: { id: queued.jobId }, data: { status: 'COMPLETED' } })
  })

  it('rolls back ScanRun, inputs and new job together if one provider is held', async () => {
    const heldId = externalIds[3]!
    const [held] = await database.$transaction((tx) =>
      captureArtworkDedupSources(tx, { identities: [{ kind: 'PROVIDER', providerKey: 'pixiv', externalId: heldId }] })
    )
    sourceIds.add(held!.sourceId)
    await database.artworkDedupSourceIdentity.update({
      where: { id: held!.sourceId },
      data: { status: 'HOLD', ownerOperationId: `${prefix}-owner` }
    })
    const before = await database.systemJob.count({ where: { requestedByUserId: userId } })
    await expect(
      enqueueCentralScan({
        type: 'list',
        metadataList: externalIds.slice(2).map((id) => `${id}-meta.json`),
        requestedByUserId: userId
      })
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })
    expect(await database.systemJob.count({ where: { requestedByUserId: userId } })).toBe(before)
    expect(
      await database.artworkDedupSourceIdentity.count({ where: { providerKey: 'pixiv', externalId: externalIds[2] } })
    ).toBe(0)
  })

  it('freezes confirmed local import and rescan DIRECTORY proofs under the same root', async () => {
    const storagePath = 'local-imports/fixture/work'
    const queued = await enqueueCentralLocalDirectoryImport({ requestedByUserId: userId, storagePaths: [storagePath] })
    const input = await database.scanRunLocalWorkInput.findFirstOrThrow({ where: { scanRunId: queued.scanRunId } })
    const proof = parseArtworkDedupSourceSnapshot(input.dedupSourceSnapshot)
    proof.sources.forEach((source) => sourceIds.add(source.sourceId))
    expect(proof.sources).toHaveLength(1)
    expect(proof.sources[0]!.identity).toMatchObject({
      kind: 'DIRECTORY',
      logicalRoot: 'source-media:v1',
      canonicalPath: storagePath
    })
    const artwork = await database.artwork.create({
      data: { title: prefix, source: 'LOCAL_IMPORT', createdVia: 'LOCAL_DIRECTORY', storagePath }
    })
    const rescan = await enqueueCentralArtworkRescan({ artworkId: artwork.id, requestedByUserId: userId })
    const rescanInput = await database.scanRunLocalWorkInput.findFirstOrThrow({
      where: { scanRunId: rescan.scanRunId }
    })
    expect(rescanInput.dedupSourceSnapshot).toEqual(input.dedupSourceSnapshot)
  })
})
