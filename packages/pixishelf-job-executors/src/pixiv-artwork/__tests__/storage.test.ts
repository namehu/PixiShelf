import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PixivArtworkSyncReport } from '@pixishelf/job-contracts'
import type { PixivArtworkMetadataResponse } from '../client.ts'
import { PixivArtworkSnapshotError, storePixivArtworkSnapshot, storePixivArtworkSyncReport } from '../storage.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv artwork snapshot storage', () => {
  it('stores immutable content-addressed versions and reuses identical content', async () => {
    const root = await temporaryRoot()
    const first = await storePixivArtworkSnapshot({
      pixivDataRoot: root,
      pixivArtworkId: '123',
      fetchedAt: new Date('2026-08-25T00:00:00.000Z'),
      response: metadata('Title A')
    })
    const reused = await storePixivArtworkSnapshot({
      pixivDataRoot: root,
      pixivArtworkId: '123',
      fetchedAt: new Date('2026-08-26T00:00:00.000Z'),
      response: metadata('Title A')
    })
    const changed = await storePixivArtworkSnapshot({
      pixivDataRoot: root,
      pixivArtworkId: '123',
      fetchedAt: new Date('2026-08-26T00:00:00.000Z'),
      response: metadata('Title B')
    })

    expect(first).toMatchObject({ reused: false })
    expect(reused).toEqual({ ...first, reused: true })
    expect(changed.hash).not.toBe(first.hash)
    expect(changed.relativePath).toMatch(/^artworks\/123\/metadata\/[a-f0-9]{64}\.json$/)
    const files = await fs.readdir(path.join(root, 'artworks', '123', 'metadata'))
    expect(files.sort()).toEqual([`${changed.hash}.json`, `${first.hash}.json`].sort())
    const payload = JSON.parse(await fs.readFile(path.join(root, ...first.relativePath.split('/')), 'utf8'))
    expect(payload).toMatchObject({
      fetchedAt: '2026-08-25T00:00:00.000Z',
      raw: { body: { id: '123', title: 'Title A' } },
      normalized: { id: '123', title: 'Title A' }
    })
  })

  it('ignores raw response volatility and live statistics when reusing a snapshot', async () => {
    const root = await temporaryRoot()
    const firstResponse = metadata('Title A', 'https://pixon.ads-pixiv.net/show?num=first', 'request-first')
    firstResponse.normalized.bookmarkCount = 100
    firstResponse.normalized.remoteLikeCount = 80
    firstResponse.normalized.viewCount = 1_000
    const first = await storePixivArtworkSnapshot({
      pixivDataRoot: root,
      pixivArtworkId: '123',
      fetchedAt: new Date('2026-08-25T00:00:00.000Z'),
      response: firstResponse
    })
    const secondResponse = metadata('Title A', 'https://pixon.ads-pixiv.net/show?num=second', 'request-second')
    secondResponse.normalized.bookmarkCount = 101
    secondResponse.normalized.remoteLikeCount = 81
    secondResponse.normalized.viewCount = 1_001
    const reused = await storePixivArtworkSnapshot({
      pixivDataRoot: root,
      pixivArtworkId: '123',
      fetchedAt: new Date('2026-08-26T00:00:00.000Z'),
      response: secondResponse
    })

    expect(reused).toEqual({ ...first, reused: true })
    await expect(fs.readdir(path.join(root, 'artworks', '123', 'metadata'))).resolves.toEqual([`${first.hash}.json`])
    const payload = JSON.parse(await fs.readFile(path.join(root, ...first.relativePath.split('/')), 'utf8'))
    expect(payload.raw.body.zoneConfig.header.url).toBe('https://pixon.ads-pixiv.net/show?num=first')
    expect(payload.raw.body.requestContext).toBe('request-first')
  })

  it('rejects path traversal identities', async () => {
    const root = await temporaryRoot()
    await expect(
      storePixivArtworkSnapshot({
        pixivDataRoot: root,
        pixivArtworkId: '../123',
        fetchedAt: new Date(),
        response: metadata('Title')
      })
    ).rejects.toMatchObject({ code: 'PIXIV_SNAPSHOT_PATH_INVALID' })
  })

  it('rejects a symlink in the destination directory chain when supported', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await fs.mkdir(path.join(root, 'artworks'))
    try {
      await fs.symlink(outside, path.join(root, 'artworks', '123'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    await expect(
      storePixivArtworkSnapshot({
        pixivDataRoot: root,
        pixivArtworkId: '123',
        fetchedAt: new Date(),
        response: metadata('Title')
      })
    ).rejects.toBeInstanceOf(PixivArtworkSnapshotError)
  })

  it('atomically replaces the same job report during a retry', async () => {
    const root = await temporaryRoot()
    const first = report('UNCHANGED')
    const retried = { ...report('UPDATED'), fields: [{ key: 'title' as const, before: { value: 'A' }, after: { value: 'B' } }] }

    await storePixivArtworkSyncReport({ pixivDataRoot: root, pixivArtworkId: '123', jobId: 'job-1', report: first })
    await storePixivArtworkSyncReport({ pixivDataRoot: root, pixivArtworkId: '123', jobId: 'job-1', report: retried })

    const directory = path.join(root, 'artworks', '123', 'sync-reports')
    await expect(fs.readdir(directory)).resolves.toEqual(['job-1.json'])
    await expect(fs.readFile(path.join(directory, 'job-1.json'), 'utf8')).resolves.toContain('"changeKind":"UPDATED"')
  })

  it('rejects an unsafe report job id', async () => {
    const root = await temporaryRoot()
    await expect(
      storePixivArtworkSyncReport({
        pixivDataRoot: root,
        pixivArtworkId: '123',
        jobId: '../job-1',
        report: { ...report('UNCHANGED'), jobId: '../job-1' }
      })
    ).rejects.toMatchObject({ code: 'PIXIV_SYNC_REPORT_PATH_INVALID' })
  })

  it('rejects a symlinked sync report directory when supported', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await fs.mkdir(path.join(root, 'artworks', '123'), { recursive: true })
    try {
      await fs.symlink(outside, path.join(root, 'artworks', '123', 'sync-reports'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    await expect(
      storePixivArtworkSyncReport({ pixivDataRoot: root, pixivArtworkId: '123', jobId: 'job-1', report: report('UNCHANGED') })
    ).rejects.toMatchObject({ code: 'PIXIV_SNAPSHOT_PATH_UNSAFE' })
  })
})

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artwork-'))
  temporaryRoots.push(root)
  return root
}

function metadata(title: string, zoneUrl?: string, requestContext?: string): PixivArtworkMetadataResponse {
  return {
    raw: {
      body: {
        id: '123',
        title,
        ...(zoneUrl ? { zoneConfig: { header: { url: zoneUrl } } } : {}),
        ...(requestContext ? { requestContext } : {})
      }
    },
    normalized: {
      id: '123',
      title,
      description: null,
      userId: '456',
      userName: 'Artist',
      tags: [],
      tagTranslations: {},
      canonicalUrl: 'https://www.pixiv.net/artworks/123',
      originalUrl: null,
      thumbnailUrl: null,
      width: null,
      height: null,
      size: null,
      pageCount: 1,
      bookmarkCount: null,
      remoteLikeCount: null,
      viewCount: null,
      xRestrict: null,
      aiType: null,
      illustType: null,
      sanityLevel: null,
      createDate: null,
      uploadDate: null,
      series: null
    }
  }
}

function report(changeKind: PixivArtworkSyncReport['changeKind']): PixivArtworkSyncReport {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    artworkId: 1,
    externalRefId: 'ref-1',
    pixivArtworkId: '123',
    checkedAt: '2026-08-26T00:00:00.000Z',
    refreshExisting: false,
    status: changeKind === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
    changeKind,
    fields: [],
    tags: { before: [], after: [], added: [], removed: [] },
    protectedFields: [],
    snapshots: {
      before: null,
      after: { hash: 'a'.repeat(64), path: `artworks/123/metadata/${'a'.repeat(64)}.json` },
      changed: true
    }
  }
}
