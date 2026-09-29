import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPixivSeriesExecutorRegistrations } from '../executors.ts'
import { PixivProxyConfigurationError } from '../../shared/pixiv-proxy-error.ts'

const temporaryRoots: string[] = []
const snapshotHash = 'a'.repeat(64)
const snapshotPath = `artworks/1001/metadata/${snapshotHash}.json`

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('single artwork series executor fetch routing', () => {
  it('uses a valid local snapshot without invoking either injected or global fetch', async () => {
    const fixture = await setup()
    const destination = path.join(fixture.root, snapshotPath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(
      destination,
      JSON.stringify({
        fetchedAt: '2026-09-19T00:00:00.000Z',
        raw: {},
        normalized: { id: '1001', series: { state: 'NONE' } }
      })
    )

    await expect(fixture.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(fixture.fetchImpl).not.toHaveBeenCalled()
    expect(fixture.directFetch).not.toHaveBeenCalled()
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ status: 'NO_DATA', snapshotReused: true })
      })
    )
  })

  it.each([true, false])(
    'fetches and stores artwork metadata when usable snapshot is absent (reference present: %s)',
    async (hasSnapshotReference) => {
      const fixture = await setup(hasSnapshotReference)

      await expect(fixture.execute()).resolves.toEqual({ kind: 'transactionally-finalized' })
      expect(fixture.fetchImpl).toHaveBeenCalledOnce()
      expect(fixture.fetchImpl).toHaveBeenCalledWith(
        new URL('https://www.pixiv.net/ajax/illust/1001?lang=zh'),
        expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) })
      )
      expect(fixture.directFetch).not.toHaveBeenCalled()
      const publication = fixture.update.mock.calls.find(([input]) => 'onlineSnapshotPath' in input.data)?.[0]
      expect(publication).toMatchObject({
        where: { id: 'ref-1' },
        data: { onlineSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/), onlineSnapshotPath: expect.any(String) }
      })
      const snapshot = JSON.parse(
        await fs.readFile(path.join(fixture.root, publication!.data.onlineSnapshotPath), 'utf8')
      )
      expect(snapshot).toMatchObject({ normalized: { id: '1001', series: { state: 'NONE' } } })
      expect(fixture.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({ status: 'NO_DATA', snapshotReused: false })
        })
      )
    }
  )

  it('fails a proxy configuration error on the first attempt without direct fallback or retry', async () => {
    const fixture = await setup(false)
    const error = new PixivProxyConfigurationError()
    fixture.fetchImpl.mockRejectedValue(error)

    await expect(fixture.execute()).resolves.toMatchObject({ kind: 'failed', error: error.message })
    expect(fixture.fetchImpl).toHaveBeenCalledOnce()
    expect(fixture.directFetch).not.toHaveBeenCalled()
    expect(fixture.complete).not.toHaveBeenCalled()
    expect(fixture.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seriesSyncStatus: 'FAILED',
          seriesLastErrorCode: 'PIXIV_PROXY_CONFIG_INVALID',
          seriesLastError: error.message
        })
      })
    )
  })
})

async function setup(hasSnapshotReference = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-series-fetch-'))
  temporaryRoots.push(root)
  const directFetch = vi.fn().mockRejectedValue(new Error('Unexpected direct network request'))
  vi.stubGlobal('fetch', directFetch)
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: false,
          body: { id: '1001', tags: { tags: [] }, seriesNavData: null }
        })
      )
  )
  const update = vi.fn().mockResolvedValue(undefined)
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const complete = vi.fn().mockResolvedValue(undefined)
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'ref-1' }]),
    artworkExternalRef: { update, updateMany },
    seriesArtwork: { findUnique: vi.fn().mockResolvedValue(null) }
  }
  const [registration] = createPixivSeriesExecutorRegistrations({
    database: {
      artworkExternalRef: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ref-1',
          onlineSnapshotHash: hasSnapshotReference ? snapshotHash : null,
          onlineSnapshotPath: hasSnapshotReference ? snapshotPath : null,
          artwork: { externalRefs: [{ id: 'ref-1' }] }
        })
      }
    } as never,
    pixivDataRoot: root,
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => undefined
  })
  const context = {
    job: { id: 'job-1', attempt: 1, maxAttempts: 3 },
    payload: {
      mode: 'ARTWORK',
      artworkId: 1,
      expectedExternalRefId: 'ref-1',
      expectedPixivArtworkId: '1001',
      refreshExisting: false
    },
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    mutateInTransaction: async (operation: (transaction: unknown) => Promise<void>) => operation(transaction),
    finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
      await operation({ transaction, executionStatus: 'RUNNING', complete })
      return { kind: 'transactionally-finalized' }
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return {
    root,
    fetchImpl,
    directFetch,
    update,
    updateMany,
    complete,
    execute: () => registration!.execute(context as never)
  }
}
