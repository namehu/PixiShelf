import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  systemEnqueue: vi.fn(),
  getScanPath: vi.fn(),
  getSystemSettings: vi.fn(),
  buildMigrationSelection: vi.fn(),
  artworkFindUnique: vi.fn(),
  artworkFindMany: vi.fn(),
  mappingFindMany: vi.fn(),
  fingerprint: vi.fn(),
  discoverBounded: vi.fn(),
  fsRealpath: vi.fn(),
  fsLstat: vi.fn(),
  fsReadFile: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/background-task/manual-job-singleton', () => ({
  enqueueSingletonManualJobWithResult: mocks.enqueue,
  enqueueSingletonSystemJobWithResult: mocks.systemEnqueue
}))
vi.mock('@/services/setting.service', () => ({
  getScanPath: mocks.getScanPath,
  getSystemSettings: mocks.getSystemSettings
}))
vi.mock('@/services/migration-service', () => ({ buildMigrationSelection: mocks.buildMigrationSelection }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { findUnique: mocks.artworkFindUnique, findMany: mocks.artworkFindMany },
    localImportArtistMapping: { findMany: mocks.mappingFindMany }
  }
}))
vi.mock('@pixishelf/job-executors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pixishelf/job-executors')>()),
  computeLocalWorkContentFingerprint: mocks.fingerprint,
  discoverBoundedLocalWorkCandidates: mocks.discoverBounded
}))
vi.mock('node:fs/promises', () => ({
  default: {
    realpath: mocks.fsRealpath,
    lstat: mocks.fsLstat,
    readFile: mocks.fsReadFile
  }
}))

import {
  enqueueCentralArtworkRescan,
  enqueueCentralLocalDirectoryImport,
  enqueueCentralMigration,
  enqueueCentralScan
} from '../media-root-central-service'
import { localWorkInputDigest } from '@pixishelf/job-executors'

describe('central media root enqueue semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getScanPath.mockResolvedValue('D:/scan')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 7,
      source: 'LOCAL_IMPORT',
      storagePath: 'local-imports/artist/work',
      metaSource: null,
      externalRefs: []
    })
    mocks.fingerprint.mockResolvedValue('a'.repeat(64))
    mocks.artworkFindMany.mockResolvedValue([])
    mocks.mappingFindMany.mockResolvedValue([])
    mocks.discoverBounded.mockResolvedValue([])
    mocks.getSystemSettings.mockResolvedValue({ local_import_default_tag_ids: [] })
    mocks.fsRealpath.mockImplementation(async (value: string) => value)
    mocks.fsLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, size: 2 })
    mocks.fsReadFile.mockResolvedValue(Buffer.from('{}'))
    mocks.buildMigrationSelection.mockResolvedValue({ mode: 'ARTWORK_IDS', artworkIds: [7] })
  })

  it('reuses an active artwork rescan but creates a new job after the prior run is terminal', async () => {
    mocks.enqueue
      .mockResolvedValueOnce({ job: { id: 'active-job' }, reused: true })
      .mockResolvedValueOnce({ job: { id: 'new-job' }, reused: false })

    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).resolves.toMatchObject({
      jobId: 'active-job',
      reused: true
    })
    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).resolves.toMatchObject({
      jobId: 'new-job',
      reused: false
    })
    expect(mocks.enqueue).toHaveBeenCalledTimes(2)
    for (const [request] of mocks.enqueue.mock.calls) expect(request).not.toHaveProperty('idempotencyKey')
  })

  it('does not permanently bind identical migration requests to a terminal job', async () => {
    mocks.enqueue
      .mockResolvedValueOnce({ job: { id: 'migration-active' }, reused: true })
      .mockResolvedValueOnce({ job: { id: 'migration-new' }, reused: false })
    const request = { requestedByUserId: 'admin-1', selectionInput: { targetIds: [7] } }

    await expect(enqueueCentralMigration(request)).resolves.toMatchObject({ jobId: 'migration-active', reused: true })
    await expect(enqueueCentralMigration(request)).resolves.toMatchObject({ jobId: 'migration-new', reused: false })
    for (const [job] of mocks.enqueue.mock.calls) expect(job).not.toHaveProperty('idempotencyKey')
  })

  it('queues webhook scans as SYSTEM priority without a requested user', async () => {
    mocks.systemEnqueue.mockResolvedValue({ job: { id: 'system-scan' }, reused: false })

    await expect(enqueueCentralScan({ type: 'all', force: false, triggerSource: 'SYSTEM' })).resolves.toMatchObject({
      jobId: 'system-scan',
      reused: false
    })
    expect(mocks.systemEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SCAN',
        triggerSource: 'SYSTEM',
        priority: 110,
        payload: { mode: 'INCREMENTAL' }
      }),
      expect.anything()
    )
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('freezes a Pixiv artwork metadata input in the enqueue transaction', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 7,
      source: 'PIXIV_IMPORTED',
      storagePath: null,
      metaSource: 'artist/7-meta.json',
      externalRefs: [{ externalId: '7' }]
    })
    const scanRunCreate = vi.fn().mockResolvedValue({ id: 'run-pixiv' })
    const metadataCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const transaction = {
      scanRun: { findUnique: vi.fn().mockResolvedValue(null), create: scanRunCreate },
      artwork: {
        findUnique: vi.fn().mockResolvedValue({
          source: 'PIXIV_IMPORTED',
          storagePath: null,
          metaSource: 'artist/7-meta.json',
          externalRefs: [{ externalId: '7' }]
        })
      },
      scanRunMetadataInput: { createMany: metadataCreateMany }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'pixiv-job' }, reused: false })
      return { job: { id: 'pixiv-job' }, reused: false }
    })

    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).resolves.toMatchObject({
      jobId: 'pixiv-job',
      scanRunId: 'run-pixiv'
    })
    expect(scanRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'PIXIV',
        mode: 'RESCAN',
        inputCount: 1,
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputFrozenAt: expect.any(Date)
      })
    })
    expect(metadataCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ scanRunId: 'run-pixiv', ordinal: 0, relativePath: 'artist/7-meta.json' })]
    })
  })

  it('rejects a reused job whose ScanRun header differs from the request', async () => {
    const transaction = {
      scanRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-corrupt',
          type: 'PIXIV',
          mode: 'INCREMENTAL',
          inputCount: 1,
          inputDigest: 'b'.repeat(64),
          inputFrozenAt: new Date()
        })
      }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'active-job' }, reused: true })
      return { job: { id: 'active-job' }, reused: true }
    })

    await expect(enqueueCentralScan({ type: 'all', force: false, requestedByUserId: 'admin-1' })).rejects.toMatchObject(
      { code: 'ACTIVE_JOB_CONFLICT' }
    )
  })

  it('rejects a reused job whose frozen input rows differ without writing', async () => {
    const expectedRows = [
      {
        ordinal: 0,
        kind: 'MEDIA_DIRECTORY' as const,
        relativePath: 'local-imports/artist/work',
        fingerprint: 'a'.repeat(64)
      }
    ]
    const createRun = vi.fn()
    const transaction = {
      scanRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-corrupt-row',
          type: 'LOCAL_IMPORT',
          mode: 'LOCAL_RESCAN',
          inputCount: 1,
          inputDigest: localWorkInputDigest(expectedRows),
          inputFrozenAt: new Date()
        }),
        create: createRun
      },
      scanRunMetadataInput: { findMany: vi.fn().mockResolvedValue([]) },
      scanRunLocalWorkInput: {
        findMany: vi.fn().mockResolvedValue([{ ...expectedRows[0], fingerprint: 'b'.repeat(64) }])
      },
      scanRunLocalArtistMappingInput: { findMany: vi.fn().mockResolvedValue([]) }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'active-job' }, reused: true })
      return { job: { id: 'active-job' }, reused: true }
    })

    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).rejects.toMatchObject({
      code: 'ACTIVE_JOB_CONFLICT'
    })
    expect(createRun).not.toHaveBeenCalled()
  })

  it('uses the shared bounded discovery and bounded mapping queries for local import', async () => {
    mocks.discoverBounded.mockResolvedValue([
      {
        kind: 'MEDIA_DIRECTORY',
        artistDirectory: 'artist',
        relativePath: 'local-imports/artist/work',
        title: 'work',
        fingerprint: 'c'.repeat(64),
        mediaCount: 1
      }
    ])
    mocks.mappingFindMany.mockResolvedValue([{ artistDirectory: 'artist', artistId: 9 }])
    mocks.enqueue.mockResolvedValue({ job: { id: 'local-job' }, reused: false })

    await enqueueCentralLocalDirectoryImport('admin-1')

    expect(mocks.discoverBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        localDirectory: 'local-imports',
        limits: expect.objectContaining({ maxDepth: 12, maxEntries: 100_000, maxCandidates: 10_000 })
      })
    )
    expect(mocks.artworkFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10_001 }))
    expect(mocks.mappingFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2_001 }))
  })
})
