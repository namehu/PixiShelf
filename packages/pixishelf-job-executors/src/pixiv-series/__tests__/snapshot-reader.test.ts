import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PixivSeriesSnapshotReadError,
  readPixivSeriesObservationFromSnapshot
} from '../snapshot-reader.ts'

const temporaryRoots: string[] = []
const hash = 'a'.repeat(64)

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv series snapshot reader', () => {
  it('reads the stable normalized series observation', async () => {
    const root = await writeSnapshot({
      fetchedAt: '2026-08-27T00:00:00.000Z',
      raw: { body: { id: '1001', seriesNavData: null } },
      normalized: {
        id: '1001',
        series: { state: 'PRESENT', id: '77', title: 'Series title', order: 3 }
      }
    })

    await expect(
      readPixivSeriesObservationFromSnapshot({
        pixivDataRoot: root,
        pixivArtworkId: '1001',
        snapshotHash: hash,
        snapshotPath: `artworks/1001/metadata/${hash}.json`
      })
    ).resolves.toEqual({
      fetchedAt: new Date('2026-08-27T00:00:00.000Z'),
      series: { state: 'PRESENT', id: '77', title: 'Series title', order: 3 }
    })
  })

  it('uses explicit legacy raw null as NONE but treats a missing field as UNKNOWN', async () => {
    const noneRoot = await writeSnapshot({
      fetchedAt: '2026-08-27T00:00:00.000Z',
      raw: { body: { id: '1001', seriesNavData: null } },
      normalized: { id: '1001' }
    })
    await expect(read(noneRoot)).resolves.toMatchObject({ series: { state: 'NONE' } })

    const unknownRoot = await writeSnapshot({
      fetchedAt: '2026-08-27T00:00:00.000Z',
      raw: { body: { id: '1001' } },
      normalized: { id: '1001' }
    })
    await expect(read(unknownRoot)).resolves.toMatchObject({ series: { state: 'UNKNOWN' } })
  })

  it('rejects a caller-controlled path that is not the exact artwork snapshot path', async () => {
    const root = await writeSnapshot({
      fetchedAt: '2026-08-27T00:00:00.000Z',
      raw: { body: { id: '1001', seriesNavData: null } },
      normalized: { id: '1001' }
    })
    await expect(
      readPixivSeriesObservationFromSnapshot({
        pixivDataRoot: root,
        pixivArtworkId: '1001',
        snapshotHash: hash,
        snapshotPath: '../outside.json'
      })
    ).rejects.toMatchObject({ code: 'PIXIV_SERIES_SNAPSHOT_PATH_INVALID' } satisfies Partial<PixivSeriesSnapshotReadError>)
  })
})

function read(root: string) {
  return readPixivSeriesObservationFromSnapshot({
    pixivDataRoot: root,
    pixivArtworkId: '1001',
    snapshotHash: hash,
    snapshotPath: `artworks/1001/metadata/${hash}.json`
  })
}

async function writeSnapshot(snapshot: unknown) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-series-snapshot-'))
  temporaryRoots.push(root)
  const directory = path.join(root, 'artworks', '1001', 'metadata')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${hash}.json`), JSON.stringify(snapshot), 'utf8')
  return root
}
