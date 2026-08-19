import type { LocalDirectoryImportPayload, ScanPayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
import { describe, expect, it, vi } from 'vitest'
import { artistMappingInputDigest, localWorkInputDigest, metadataInputDigest } from '../digests.js'
import {
  scanMode,
  startOrResumeScanRun,
  verifyFrozenLocalSnapshot,
  verifyFrozenMetadataSnapshot
} from '../run-store.js'
import type { ScanDatabase, ScanTransaction } from '../types.js'

const frozenAt = new Date('2026-08-15T00:00:00.000Z')

describe('ScanRun frozen input adapter', () => {
  it('maps all wire scan modes onto the established database modes', () => {
    expect(scanMode({ mode: 'INCREMENTAL' })).toBe('INCREMENTAL')
    expect(scanMode({ mode: 'FULL_RECONCILE' })).toBe('FULL')
    expect(scanMode({ mode: 'CLIENT_LIST', existingPolicy: 'SKIP', inputCount: 1, inputDigest: 'a'.repeat(64) })).toBe(
      'CLIENT_LIST'
    )
    expect(scanMode({ mode: 'ARTWORK_RESCAN', artworkId: 1 })).toBe('RESCAN')
  })

  it('rejects CLIENT_LIST when enqueue did not atomically create its ScanRun snapshot', async () => {
    const database = { scanRun: { findUnique: vi.fn(async () => null) } } as unknown as ScanDatabase
    const context = contextFixture({
      mode: 'CLIENT_LIST',
      existingPolicy: 'SKIP',
      inputCount: 1,
      inputDigest: 'a'.repeat(64)
    })
    await expect(
      startOrResumeScanRun({
        context,
        database,
        kind: 'SCAN',
        mode: 'CLIENT_LIST',
        now: frozenAt,
        requireFrozen: true
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
    expect(context.mutateInTransaction).not.toHaveBeenCalled()
  })

  it('accepts only the exact frozen CLIENT_LIST count and digest', async () => {
    const rows = [
      {
        id: 'i1',
        scanRunId: 'run-1',
        ordinal: 0,
        relativePath: 'a/1-meta.json',
        contentHash: 'a'.repeat(64),
        createdAt: frozenAt
      }
    ]
    const digest = metadataInputDigest(rows)
    const database = {
      scanRunMetadataInput: { findMany: paged(rows) }
    } as unknown as ScanDatabase
    const run = { id: 'run-1', inputFrozenAt: frozenAt, inputCount: 1, inputDigest: digest } as never

    await expect(
      verifyFrozenMetadataSnapshot({
        database,
        run,
        payload: { mode: 'CLIENT_LIST', existingPolicy: 'REFRESH', inputCount: 1, inputDigest: digest },
        pageSize: 100,
        maxEntries: 100
      })
    ).resolves.toMatchObject({ count: 1, inputFrozenAt: frozenAt })
    await expect(
      verifyFrozenMetadataSnapshot({
        database,
        run,
        payload: {
          mode: 'CLIENT_LIST',
          existingPolicy: 'REFRESH',
          inputCount: 1,
          inputDigest: 'b'.repeat(64)
        },
        pageSize: 100,
        maxEntries: 100
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
  })

  it('never substitutes live mappings when the LOCAL snapshot digest differs', async () => {
    const mappings = [
      { id: 'm1', scanRunId: 'run-1', ordinal: 0, artistDirectory: 'Artist', artistId: 7, createdAt: frozenAt }
    ]
    const database = {
      scanRunLocalWorkInput: { findMany: paged([]) },
      scanRunLocalArtistMappingInput: { findMany: paged(mappings) }
    } as unknown as ScanDatabase
    const run = {
      id: 'run-1',
      inputFrozenAt: frozenAt,
      inputCount: 0,
      inputDigest: localWorkInputDigest([])
    } as never

    await expect(
      verifyFrozenLocalSnapshot({
        database,
        run,
        payload: { defaultTagIds: [], mappingCount: 1, mappingDigest: 'f'.repeat(64) },
        pageSize: 100,
        maxEntries: 100
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
    expect(database.scanRunLocalArtistMappingInput.findMany).toHaveBeenCalledTimes(2)
  })

  it('accepts path-only local import snapshots without a content fingerprint', async () => {
    const works = [
      {
        id: 'w1',
        scanRunId: 'run-1',
        ordinal: 0,
        kind: 'MEDIA_DIRECTORY' as const,
        relativePath: 'local-imports/Artist/Work',
        fingerprint: null,
        createdAt: frozenAt
      }
    ]
    const mappings = [
      { id: 'm1', scanRunId: 'run-1', ordinal: 0, artistDirectory: 'Artist', artistId: 7, createdAt: frozenAt }
    ]
    const mappingDigest = artistMappingInputDigest(mappings)
    const database = {
      scanRunLocalWorkInput: { findMany: paged(works) },
      scanRunLocalArtistMappingInput: { findMany: paged(mappings) }
    } as unknown as ScanDatabase

    await expect(
      verifyFrozenLocalSnapshot({
        database,
        run: {
          id: 'run-1',
          inputFrozenAt: frozenAt,
          inputCount: 1,
          inputDigest: localWorkInputDigest(works)
        } as never,
        payload: { defaultTagIds: [], mappingCount: 1, mappingDigest },
        pageSize: 100,
        maxEntries: 100
      })
    ).resolves.toMatchObject({ workCount: 1, mappings })
  })

  it('rejects historical archive-manifest work in a new local import execution', async () => {
    const rows = [
      {
        id: 'w1',
        scanRunId: 'run-1',
        ordinal: 0,
        kind: 'ARCHIVE_MANIFEST' as const,
        relativePath: 'local-imports/Recovered/Gallery',
        fingerprint: 'a'.repeat(64),
        createdAt: frozenAt
      }
    ]
    const database = {
      scanRunLocalWorkInput: { findMany: paged(rows) },
      scanRunLocalArtistMappingInput: { findMany: paged([]) }
    } as unknown as ScanDatabase

    await expect(
      verifyFrozenLocalSnapshot({
        database,
        run: {
          id: 'run-1',
          inputFrozenAt: frozenAt,
          inputCount: 1,
          inputDigest: localWorkInputDigest(rows)
        } as never,
        payload: { defaultTagIds: [], mappingCount: 0, mappingDigest: 'f'.repeat(64) },
        pageSize: 100,
        maxEntries: 100
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
  })

  it('rejects non-dense ordinals, noncanonical paths, and empty FULL snapshots', async () => {
    const invalidRows = [
      {
        id: 'i1',
        scanRunId: 'run-1',
        ordinal: 1,
        relativePath: 'a\\1-meta.json',
        contentHash: 'a'.repeat(64),
        createdAt: frozenAt
      }
    ]
    const database = { scanRunMetadataInput: { findMany: paged(invalidRows) } } as unknown as ScanDatabase
    await expect(
      verifyFrozenMetadataSnapshot({
        database,
        run: {
          id: 'run-1',
          inputFrozenAt: frozenAt,
          inputCount: 1,
          inputDigest: metadataInputDigest(invalidRows)
        } as never,
        payload: { mode: 'INCREMENTAL' },
        pageSize: 100,
        maxEntries: 100
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })

    const emptyDatabase = { scanRunMetadataInput: { findMany: paged([]) } } as unknown as ScanDatabase
    await expect(
      verifyFrozenMetadataSnapshot({
        database: emptyDatabase,
        run: {
          id: 'run-2',
          inputFrozenAt: frozenAt,
          inputCount: 0,
          inputDigest: metadataInputDigest([])
        } as never,
        payload: { mode: 'FULL_RECONCILE' },
        pageSize: 100,
        maxEntries: 100
      })
    ).rejects.toMatchObject({ code: 'EMPTY_FULL_RECONCILE' })
  })
})

function contextFixture(payload: ScanPayload | LocalDirectoryImportPayload) {
  return {
    job: { id: 'job-1' },
    payload,
    mutateInTransaction: vi.fn(async (operation: (transaction: ScanTransaction) => Promise<unknown>) =>
      operation({} as ScanTransaction)
    )
  } as unknown as ExecutionContext<ScanPayload, EnqueuedChildJob>
}

function paged<T extends { ordinal: number }>(rows: T[]) {
  return vi.fn(async (input: { where: { ordinal: { gt: number } }; take: number }) =>
    rows.filter((row) => row.ordinal > input.where.ordinal.gt).slice(0, input.take)
  )
}
