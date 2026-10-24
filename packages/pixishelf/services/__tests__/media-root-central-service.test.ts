import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkDedupOperationError } from '@pixishelf/db'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-handler'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import { classifyBackgroundTaskTransportError } from '@/services/background-task/transport-error'

const mocks = vi.hoisted(() => ({
  captureSources: vi.fn(),
  assertSources: vi.fn(),
  enqueue: vi.fn(),
  systemEnqueue: vi.fn(),
  getScanPath: vi.fn(),
  getSystemSettings: vi.fn(),
  buildMigrationSelection: vi.fn(),
  artworkFindUnique: vi.fn(),
  artworkFindMany: vi.fn(),
  mappingFindMany: vi.fn(),
  fingerprint: vi.fn(),
  fsRealpath: vi.fn(),
  fsLstat: vi.fn(),
  fsReadFile: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('@pixishelf/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pixishelf/db')>()),
  captureArtworkDedupSourceGroups: mocks.captureSources,
  assertArtworkDedupSourceGroups: mocks.assertSources
}))
vi.mock('@pixishelf/job-executors/media-content', () => ({
  resolveMediaContentRoots: vi
    .fn()
    .mockResolvedValue({ source: { logicalRoot: 'source-media:v1', rootIdentity: 'fixture-root' } })
}))
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
  computeLocalWorkContentFingerprint: mocks.fingerprint
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
    mocks.captureSources.mockImplementation(async (_tx, { groups }) =>
      groups.map((group: unknown[], groupIndex: number) =>
        group.map((identity, index) => ({ identity, sourceId: `source-${groupIndex}-${index}`, generation: 7n }))
      )
    )
    mocks.assertSources.mockResolvedValue(undefined)
    mocks.getScanPath.mockResolvedValue('D:/scan')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 7,
      source: 'LOCAL_IMPORT',
      createdVia: 'LOCAL_DIRECTORY',
      storagePath: 'local-imports/artist/work',
      metaSource: null,
      externalRefs: []
    })
    mocks.fingerprint.mockResolvedValue('a'.repeat(64))
    mocks.artworkFindMany.mockResolvedValue([])
    mocks.mappingFindMany.mockResolvedValue([])
    mocks.getSystemSettings.mockResolvedValue({ local_import_default_tag_ids: [] })
    mocks.fsRealpath.mockImplementation(async (value: string) => value)
    mocks.fsLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 2n,
      mtimeMs: 20n,
      ctimeMs: 21n,
      dev: 22n,
      ino: 23n
    })
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

    await expect(enqueueCentralScan({ type: 'all', triggerSource: 'SYSTEM' })).resolves.toMatchObject({
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

  it('maps webhook list scans to CLIENT_LIST SKIP without changing the transport', async () => {
    const scanRunCreate = vi.fn().mockResolvedValue({ id: 'run-list' })
    const metadataCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const transaction = {
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
      scanRun: { findUnique: vi.fn().mockResolvedValue(null), create: scanRunCreate },
      scanRunMetadataInput: { createMany: metadataCreateMany }
    }
    mocks.systemEnqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'system-list' }, reused: false })
      return { job: { id: 'system-list' }, reused: false }
    })

    await expect(
      enqueueCentralScan({
        type: 'list',
        metadataList: ['artist/100-meta.json'],
        triggerSource: 'SYSTEM'
      })
    ).resolves.toMatchObject({ jobId: 'system-list', status: 'PENDING', reused: false })

    expect(mocks.systemEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SCAN',
        triggerSource: 'SYSTEM',
        payload: expect.objectContaining({
          mode: 'CLIENT_LIST',
          existingPolicy: 'SKIP',
          inputCount: 1,
          inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      }),
      expect.anything()
    )
    expect(metadataCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          scanRunId: 'run-list',
          relativePath: 'artist/100-meta.json',
          sizeBytes: 2n,
          mtimeMs: 20n,
          ctimeMs: 21n,
          deviceId: 22n,
          inode: 23n
        })
      ]
    })
    expect(mocks.captureSources).toHaveBeenCalledWith(transaction, {
      groups: [
        [
          { kind: 'PROVIDER', providerKey: 'pixiv', externalId: '100' },
          {
            kind: 'PATH',
            logicalRoot: 'source-media:v1',
            rootIdentity: 'fixture-root',
            canonicalPath: 'artist/100-meta.json'
          }
        ]
      ]
    })
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
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
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
      data: [
        expect.objectContaining({
          scanRunId: 'run-pixiv',
          ordinal: 0,
          relativePath: 'artist/7-meta.json',
          sizeBytes: 2n,
          mtimeMs: 20n,
          ctimeMs: 21n,
          deviceId: 22n,
          inode: 23n
        })
      ]
    })
  })

  it('rejects a reused job whose ScanRun header differs from the request', async () => {
    const transaction = {
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
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

    await expect(enqueueCentralScan({ type: 'all', requestedByUserId: 'admin-1' })).rejects.toMatchObject({
      code: 'ACTIVE_JOB_CONFLICT'
    })
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
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
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

  it('queues only preview paths that remain new without reading media content', async () => {
    mocks.artworkFindMany.mockResolvedValue([{ storagePath: 'local-imports/artist/existing' }])
    mocks.mappingFindMany.mockResolvedValue([{ artistDirectory: 'artist', artistId: 9 }])
    const scanRunCreate = vi.fn().mockResolvedValue({ id: 'local-run' })
    const localWorkCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const mappingCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const transaction = {
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
      scanRun: { findUnique: vi.fn().mockResolvedValue(null), create: scanRunCreate },
      scanRunLocalWorkInput: { createMany: localWorkCreateMany },
      scanRunLocalArtistMappingInput: { createMany: mappingCreateMany }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'local-job' }, reused: false })
      return { job: { id: 'local-job' }, reused: false }
    })

    await enqueueCentralLocalDirectoryImport({
      requestedByUserId: 'admin-1',
      storagePaths: ['local-imports/artist/work', 'local-imports/artist/existing']
    })

    expect(mocks.artworkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storagePath: { in: ['local-imports/artist/work', 'local-imports/artist/existing'] }
        },
        take: 10_001
      })
    )
    expect(mocks.mappingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artistDirectory: { in: ['artist'] } },
        take: 2_001
      })
    )
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ mappingCount: 1 }) }),
      expect.anything()
    )
    expect(localWorkCreateMany).toHaveBeenCalledWith({
      data: [
        {
          scanRunId: 'local-run',
          ordinal: 0,
          kind: 'MEDIA_DIRECTORY',
          relativePath: 'local-imports/artist/work',
          fingerprint: null,
          dedupSourceSnapshot: {
            version: 1,
            sources: [
              {
                identity: {
                  kind: 'DIRECTORY',
                  logicalRoot: 'source-media:v1',
                  rootIdentity: 'fixture-root',
                  canonicalPath: 'local-imports/artist/work'
                },
                sourceId: 'source-0-0',
                generation: '7'
              }
            ]
          }
        }
      ]
    })
    expect(mocks.fingerprint).not.toHaveBeenCalled()
  })

  it('rejects legacy local source labels without confirmed directory identity', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 7,
      source: 'LOCAL_IMPORT',
      createdVia: 'UNKNOWN',
      storagePath: 'local-imports/artist/work',
      metaSource: null,
      externalRefs: []
    })
    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED'
    })
    expect(mocks.captureSources).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('rejects an otherwise matching historical frozen input without recapturing', async () => {
    const rows = [
      { ordinal: 0, kind: 'MEDIA_DIRECTORY', relativePath: 'local-imports/artist/work', fingerprint: 'a'.repeat(64) }
    ]
    const create = vi.fn()
    const transaction = {
      scanRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'old-run',
          type: 'LOCAL_IMPORT',
          mode: 'LOCAL_RESCAN',
          inputCount: 1,
          inputDigest: localWorkInputDigest(rows),
          inputFrozenAt: new Date()
        }),
        create
      },
      scanRunMetadataInput: { findMany: vi.fn().mockResolvedValue([]) },
      scanRunLocalWorkInput: { findMany: vi.fn().mockResolvedValue([{ ...rows[0], dedupSourceSnapshot: null }]) },
      scanRunLocalArtistMappingInput: { findMany: vi.fn().mockResolvedValue([]) }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'old-job' }, reused: true })
      return { job: { id: 'old-job' }, reused: true }
    })
    await expect(enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })).rejects.toMatchObject({
      code: 'INPUT_SNAPSHOT_INVALID'
    })
    expect(mocks.captureSources).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['metadata', 'local'] as const)('maps %s capture HOLD to HTTP 409 and tRPC CONFLICT', async (kind) => {
    mocks.captureSources.mockRejectedValueOnce(new ArtworkDedupOperationError('SOURCE_HELD'))
    mocks.mappingFindMany.mockResolvedValue([{ artistDirectory: 'artist', artistId: 9 }])
    const createInput = vi.fn()
    const transaction = {
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
      scanRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'held-run' }) },
      scanRunMetadataInput: { createMany: createInput },
      scanRunLocalWorkInput: { createMany: createInput }
    }
    mocks.enqueue.mockImplementationOnce(async (_request, options) => {
      await options.afterEnqueue({ transaction, job: { id: 'held-job' }, reused: false })
      return { job: { id: 'held-job' }, reused: false }
    })
    const operation =
      kind === 'metadata'
        ? () =>
            enqueueCentralScan({ type: 'list', metadataList: ['artist/100-meta.json'], requestedByUserId: 'admin-1' })
        : () =>
            enqueueCentralLocalDirectoryImport({
              storagePaths: ['local-imports/artist/work'],
              requestedByUserId: 'admin-1'
            })
    const response = await responseForService(operation)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 409, message: '来源正在维护，请保留当前输入并稍后重试。' })
    expect(createInput).not.toHaveBeenCalled()
  })

  it.each(['SOURCE_HELD', 'SOURCE_GENERATION_CHANGED', 'SOURCE_IDENTITY_CHANGED'] as const)(
    'maps reused input %s to an actionable conflict without recapturing',
    async (code) => {
      const rows = [
        { ordinal: 0, kind: 'MEDIA_DIRECTORY', relativePath: 'local-imports/artist/work', fingerprint: 'a'.repeat(64) }
      ]
      const transaction = {
        scanRun: {
          findUnique: vi
            .fn()
            .mockResolvedValue({
              id: 'old-run',
              type: 'LOCAL_IMPORT',
              mode: 'LOCAL_RESCAN',
              inputCount: 1,
              inputDigest: localWorkInputDigest(rows),
              inputFrozenAt: new Date()
            })
        },
        scanRunMetadataInput: { findMany: vi.fn().mockResolvedValue([]) },
        scanRunLocalWorkInput: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              {
                ...rows[0],
                dedupSourceSnapshot: {
                  version: 1,
                  sources: [
                    {
                      identity: {
                        kind: 'DIRECTORY',
                        logicalRoot: 'source-media:v1',
                        rootIdentity: 'fixture-root',
                        canonicalPath: rows[0]!.relativePath
                      },
                      sourceId: 'old-source',
                      generation: '0'
                    }
                  ]
                }
              }
            ])
        },
        scanRunLocalArtistMappingInput: { findMany: vi.fn().mockResolvedValue([]) }
      }
      mocks.assertSources.mockRejectedValueOnce(new ArtworkDedupOperationError(code))
      mocks.enqueue.mockImplementationOnce(async (_request, options) => {
        await options.afterEnqueue({ transaction, job: { id: 'old-job' }, reused: true })
        return { job: { id: 'old-job' }, reused: true }
      })
      const response = await responseForService(() =>
        enqueueCentralArtworkRescan({ artworkId: 7, requestedByUserId: 'admin-1' })
      )
      expect(response.status).toBe(409)
      expect((await response.json()).message).toMatch(/维护|复核来源后重新提交/)
      expect(mocks.captureSources).not.toHaveBeenCalled()
    }
  )

  it.each([new Error('database unavailable'), new ArtworkDedupOperationError('STALE')])(
    'keeps unknown source-helper errors as HTTP 500: %s',
    async (error) => {
      mocks.captureSources.mockRejectedValueOnce(error)
      const transaction = {
        pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue(null) },
        scanRun: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'unknown-run' })
        },
        scanRunMetadataInput: { createMany: vi.fn() }
      }
      mocks.enqueue.mockImplementationOnce(async (_request, options) => {
        await options.afterEnqueue({ transaction, job: { id: 'unknown-job' }, reused: false })
        return { job: { id: 'unknown-job' }, reused: false }
      })
      const operation = () =>
        enqueueCentralScan({ type: 'list', metadataList: ['artist/100-meta.json'], requestedByUserId: 'admin-1' })
      const response = await responseForService(operation, error)
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ code: 500, message: 'Internal Server Error' })
    }
  )
})

async function responseForService(operation: () => Promise<unknown>, unclassified?: Error) {
  const handler = apiHandler(z.object({}), () =>
    runBackgroundTaskApi(async () => {
      try {
        return await operation()
      } catch (error) {
        if (unclassified) {
          expect(error).toBe(unclassified)
          expect(classifyBackgroundTaskTransportError(error)).toBeNull()
        } else {
          expect(classifyBackgroundTaskTransportError(error)).toMatchObject({ status: 409, trpcCode: 'CONFLICT' })
        }
        throw error
      }
    })
  )
  return handler(new NextRequest('http://localhost/scan', { method: 'POST' }), { params: Promise.resolve({}) })
}
