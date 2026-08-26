import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PixivArtworkSyncReport } from '@pixishelf/job-contracts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv artwork sync report read service', () => {
  it('paginates valid reports newest-first and filters orphan jobs', async () => {
    const root = await temporaryRoot()
    await writeReport(root, report('job-old', '2026-08-25T00:00:00.000Z'))
    await writeReport(root, report('job-new', '2026-08-26T00:00:00.000Z'))
    await writeReport(root, report('job-orphan', '2026-08-27T00:00:00.000Z'))
    const database = databaseMock(['job-old', 'job-new'])
    const service = await loadService(root)

    const first = await service.listPixivArtworkSyncReports({ artworkId: 1, limit: 1 }, database as never)
    const second = await service.listPixivArtworkSyncReports(
      { artworkId: 1, limit: 1, cursor: first.nextCursor ?? undefined },
      database as never
    )

    expect(first).toMatchObject({ total: 2, items: [{ id: 'job-new' }], nextCursor: 'job-new' })
    expect(second).toMatchObject({ items: [{ id: 'job-old' }], nextCursor: null })
  })

  it('reads the report and lazily resolves its before and after snapshots', async () => {
    const root = await temporaryRoot()
    const current = report('job-1', '2026-08-26T00:00:00.000Z', true)
    await writeReport(root, current)
    await writeSnapshot(root, 'a', { raw: { title: 'Before' }, normalized: { title: 'Before' } })
    await writeSnapshot(root, 'b', { raw: { title: 'After' }, normalized: { title: 'After' } })
    const database = databaseMock(['job-1'])
    const service = await loadService(root)

    await expect(service.getPixivArtworkSyncReport({ artworkId: 1, reportId: 'job-1' }, database as never)).resolves.toMatchObject({
      changeKind: 'UPDATED'
    })
    await expect(
      service.getPixivArtworkSyncSnapshot({ artworkId: 1, reportId: 'job-1', side: 'before' }, database as never)
    ).resolves.toMatchObject({ available: true, hash: 'a'.repeat(64), content: { raw: { title: 'Before' } } })
  })

  it('rejects a snapshot path that does not belong to the selected Pixiv artwork', async () => {
    const root = await temporaryRoot()
    const invalid = report('job-1', '2026-08-26T00:00:00.000Z')
    invalid.snapshots.after.path = `artworks/999/metadata/${'b'.repeat(64)}.json`
    await writeReport(root, invalid)
    const service = await loadService(root)

    await expect(
      service.getPixivArtworkSyncSnapshot({ artworkId: 1, reportId: 'job-1', side: 'after' }, databaseMock(['job-1']) as never)
    ).rejects.toMatchObject({ code: 'INVALID' })
  })

  it('returns an empty compatible history for pre-report sync jobs', async () => {
    const root = await temporaryRoot()
    const service = await loadService(root)
    await expect(
      service.listPixivArtworkSyncReports({ artworkId: 1 }, databaseMock([]) as never)
    ).resolves.toMatchObject({ total: 0, items: [], nextCursor: null })
  })
})

async function loadService(root: string) {
  vi.stubEnv('PIXIV_DATA_STORAGE_PATH', root)
  vi.resetModules()
  return import('../pixiv-artwork-sync-report-service')
}

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-report-read-'))
  roots.push(root)
  return root
}

async function writeReport(root: string, value: PixivArtworkSyncReport) {
  const directory = path.join(root, 'artworks', '123', 'sync-reports')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${value.jobId}.json`), JSON.stringify(value))
}

async function writeSnapshot(root: string, hashCharacter: string, value: unknown) {
  const directory = path.join(root, 'artworks', '123', 'metadata')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${hashCharacter.repeat(64)}.json`), JSON.stringify(value))
}

function databaseMock(validJobIds: string[]) {
  const payload = {
    mode: 'ARTWORK',
    artworkId: 1,
    expectedExternalRefId: 'ref-1',
    expectedPixivArtworkId: '123',
    adoptSourceText: false
  }
  return {
    artwork: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        title: 'Artwork',
        deletedAt: null,
        externalRefs: [{ id: 'ref-1', externalId: '123' }]
      })
    },
    systemJob: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        validJobIds.filter((id) => where.id.in.includes(id)).map((id) => ({ id, payload }))
      ),
      findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(validJobIds.includes(where.id) ? { payload } : null)
      )
    }
  }
}

function report(jobId: string, checkedAt: string, withBefore = false): PixivArtworkSyncReport {
  return {
    schemaVersion: 1,
    jobId,
    artworkId: 1,
    externalRefId: 'ref-1',
    pixivArtworkId: '123',
    checkedAt,
    refreshExisting: false,
    status: 'SUCCESS',
    changeKind: 'UPDATED',
    fields: [{ key: 'title', before: { value: 'Before' }, after: { value: 'After' } }],
    tags: { before: ['old'], after: ['new'], added: ['new'], removed: ['old'] },
    protectedFields: [],
    snapshots: {
      before: withBefore
        ? { hash: 'a'.repeat(64), path: `artworks/123/metadata/${'a'.repeat(64)}.json` }
        : null,
      after: { hash: 'b'.repeat(64), path: `artworks/123/metadata/${'b'.repeat(64)}.json` },
      changed: true
    }
  }
}
