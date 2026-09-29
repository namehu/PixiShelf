import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveError } from '@/services/archive/errors'
import {
  ArchivePreviewStore,
  getArchivePreviewPage,
  listArchivePreviewSources,
  openArchivePreview,
  reloadArchivePreview,
  type ArchivePreviewServiceDependencies
} from '../archive-preview-service'

const gallery = (gid: string, token = `token${gid}`) => `https://e-hentai.org/g/${gid}/${token}/`

function pageResult(gid: string, page = 0, overrides: Record<string, unknown> = {}) {
  const start = page * 2
  return {
    providerKey: 'e-hentai',
    externalId: gid,
    canonicalUrl: gallery(gid),
    title: `Gallery ${gid}`,
    total: 4,
    page,
    items: [0, 1].map((offset) => ({
      ordinal: start + offset,
      url: `https://ehgt.org/thumb/${gid}-${start + offset}.jpg`,
      width: 120,
      height: 160
    })),
    nextPage: page === 0 ? 1 : null,
    ...overrides
  }
}

function providerDependencies(
  previewPage: (input: { url: string; page: number }, context?: { signal?: AbortSignal }) => Promise<unknown>,
  overrides: Partial<ArchivePreviewServiceDependencies> = {}
) {
  const provider = { key: 'e-hentai', previewPage }
  const providers = {
    getForUrl: vi.fn(() => provider),
    get: vi.fn(() => provider),
    getUploaderScanner: vi.fn(() => provider)
  }
  return { dependencies: { providers, ...overrides } as unknown as ArchivePreviewServiceDependencies, providers }
}

function gidFromUrl(url: string) {
  return new URL(url).pathname.match(/^\/g\/([1-9]\d*)\//)?.[1] ?? '1'
}

describe('archive preview service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists only active artwork references with a preview-safe identity label and no locator', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'ref-1', providerKey: 'e-hentai', externalId: '123', canonicalUrl: gallery('123') },
      { id: 'ref-bad', providerKey: 'e-hentai', externalId: '999', canonicalUrl: gallery('998') }
    ])
    const { dependencies } = providerDependencies(async () => pageResult('123'), {
      database: { artworkExternalRef: { findMany } } as never
    })

    await expect(listArchivePreviewSources({ artworkId: 7 }, dependencies)).resolves.toEqual([
      { externalRefId: 'ref-1', providerKey: 'e-hentai', label: '#123' }
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artworkId: 7, artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } }
      })
    )
  })

  it('opens every stored source kind with read-only lookups and keeps frozen identities', async () => {
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => pageResult(gidFromUrl(url), page))
    const database = {
      artworkExternalRef: {
        findFirst: vi.fn().mockResolvedValue({ providerKey: 'e-hentai', externalId: '10', canonicalUrl: gallery('10') })
      },
      archiveImport: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ providerKey: 'e-hentai', externalId: '11', canonicalUrl: gallery('11') })
      },
      archiveIntakeItem: {
        findUnique: vi.fn().mockResolvedValue({
          submittedUrl: gallery('12'),
          providerKey: null,
          externalId: null,
          canonicalUrl: null
        })
      },
      archiveUploaderCatalogItem: {
        findFirst: vi.fn().mockResolvedValue({ providerKey: 'e-hentai', externalId: '13', canonicalUrl: gallery('13') })
      },
      systemJob: { create: vi.fn(), update: vi.fn() },
      archiveIntakeSubmission: { create: vi.fn() }
    }
    const { dependencies } = providerDependencies(remote, {
      database: database as never,
      store: new ArchivePreviewStore(),
      createId: vi
        .fn()
        .mockReturnValueOnce('preview-artwork')
        .mockReturnValueOnce('preview-task')
        .mockReturnValueOnce('preview-intake')
        .mockReturnValueOnce('preview-catalog')
    })

    await openArchivePreview({ source: { kind: 'artwork', externalRefId: 'ref-10' } }, 'user-1', dependencies)
    await openArchivePreview({ source: { kind: 'task', taskId: 'task-11' } }, 'user-1', dependencies)
    await openArchivePreview({ source: { kind: 'intake', itemId: 'intake-12' } }, 'user-1', dependencies)
    await openArchivePreview({ source: { kind: 'catalog', itemId: 'catalog-13' } }, 'user-1', dependencies)

    expect(database.artworkExternalRef.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'ref-10', artwork: expect.any(Object) }) })
    )
    expect(database.archiveUploaderCatalogItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'catalog-13', matchesQuery: true } })
    )
    expect(database.systemJob.create).not.toHaveBeenCalled()
    expect(database.systemJob.update).not.toHaveBeenCalled()
    expect(database.archiveIntakeSubmission.create).not.toHaveBeenCalled()
  })

  it('accepts an unresolved intake image-page URL without queueing a resolve job', async () => {
    const imagePage = 'https://e-hentai.org/s/pagehash/321-4?p=2#preview'
    const remote = vi.fn(async () => pageResult('321'))
    const database = {
      archiveIntakeItem: {
        findUnique: vi.fn().mockResolvedValue({
          submittedUrl: imagePage,
          providerKey: null,
          externalId: null,
          canonicalUrl: null
        })
      }
    }
    const { dependencies } = providerDependencies(remote, {
      database: database as never,
      store: new ArchivePreviewStore(),
      createId: () => 'preview-intake-image'
    })

    const opened = await openArchivePreview({ source: { kind: 'intake', itemId: 'intake-1' } }, 'user-1', dependencies)
    expect(opened).toMatchObject({ previewId: 'preview-intake-image', page: 0, title: 'Gallery 321' })
    expect(remote).toHaveBeenCalledWith({ url: 'https://e-hentai.org/s/pagehash/321-4', page: 0 }, expect.any(Object))
  })

  it('checks ownership before page provider work and uses the same missing-or-expired error', async () => {
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => pageResult(gidFromUrl(url), page))
    const { dependencies } = providerDependencies(remote, {
      store: new ArchivePreviewStore(),
      createId: () => 'preview-owner-bound'
    })
    await openArchivePreview({ source: { kind: 'url', url: gallery('40') } }, 'owner', dependencies)
    remote.mockClear()

    await expect(
      getArchivePreviewPage({ previewId: 'preview-owner-bound', page: 1 }, 'another-user', dependencies)
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '预览会话不存在或已过期，请重新打开' })
    expect(remote).not.toHaveBeenCalled()
  })

  it('rejects canonical identity drift and unsafe thumbnail locators without exposing tokens', async () => {
    const token = 'private123secret'
    const wrongIdentity = providerDependencies(async () => pageResult('42'))
    await expect(
      openArchivePreview({ source: { kind: 'url', url: gallery('41', token) } }, 'user-1', {
        ...wrongIdentity.dependencies,
        store: new ArchivePreviewStore()
      })
    ).rejects.toSatisfy(
      (error: ArchiveError) => error.code === 'REMOTE_RESPONSE_INVALID' && !error.message.includes(token)
    )

    const unsafeThumbnail = providerDependencies(async () =>
      pageResult('41', 0, {
        items: [{ ordinal: 0, url: gallery('41', token), width: 120, height: 160 }],
        total: 1,
        nextPage: null
      })
    )
    await expect(
      openArchivePreview({ source: { kind: 'url', url: gallery('41', token) } }, 'user-1', {
        ...unsafeThumbnail.dependencies,
        store: new ArchivePreviewStore()
      })
    ).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID', message: '原站缩略图响应无效' })

    const fullImageNavigation = providerDependencies(async () =>
      pageResult('41', 0, {
        items: [{ ordinal: 0, url: 'https://e-hentai.org/fullimg.php', width: 120, height: 160 }],
        total: 1,
        nextPage: null
      })
    )
    await expect(
      openArchivePreview({ source: { kind: 'url', url: gallery('41', token) } }, 'user-1', {
        ...fullImageNavigation.dependencies,
        store: new ArchivePreviewStore()
      })
    ).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
  })

  it('requires continuous ordinals and a page tail consistent with total and next page', async () => {
    const invalidPages = [
      pageResult('45', 0, {
        items: [
          { ordinal: 0, url: 'https://ehgt.org/thumb/45-0.jpg', width: 120, height: 160 },
          { ordinal: 2, url: 'https://ehgt.org/thumb/45-2.jpg', width: 120, height: 160 }
        ],
        total: 3,
        nextPage: null
      }),
      pageResult('45', 0, { total: 4, nextPage: null }),
      pageResult('45', 0, { total: 2, nextPage: 1 }),
      pageResult('45', 0, { total: null, items: [], nextPage: 1 })
    ]

    for (const invalidPage of invalidPages) {
      const { dependencies } = providerDependencies(async () => invalidPage, {
        store: new ArchivePreviewStore()
      })
      await expect(
        openArchivePreview({ source: { kind: 'url', url: gallery('45') } }, 'user-1', dependencies)
      ).rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' })
    }

    const unknownFinal = providerDependencies(async () => pageResult('45', 0, { total: null, nextPage: null }), {
      store: new ArchivePreviewStore(),
      createId: () => 'preview-unknown-total'
    })
    await expect(
      openArchivePreview({ source: { kind: 'url', url: gallery('45') } }, 'user-1', unknownFinal.dependencies)
    ).resolves.toMatchObject({ previewId: 'preview-unknown-total', total: null, nextPage: null })
  })

  it('coalesces identical concurrent page reads and requires sequential access', async () => {
    let resolvePageOne!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      resolvePageOne = resolve
    })
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) =>
      page === 0 ? pageResult(gidFromUrl(url), 0) : pending
    )
    const { dependencies } = providerDependencies(remote, {
      store: new ArchivePreviewStore(),
      createId: () => 'preview-coalesce'
    })
    await openArchivePreview({ source: { kind: 'url', url: gallery('50') } }, 'user-1', dependencies)

    await expect(
      getArchivePreviewPage({ previewId: 'preview-coalesce', page: 2 }, 'user-1', dependencies)
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    const first = getArchivePreviewPage({ previewId: 'preview-coalesce', page: 1 }, 'user-1', dependencies)
    const second = getArchivePreviewPage({ previewId: 'preview-coalesce', page: 1 }, 'user-1', dependencies)
    resolvePageOne(pageResult('50', 1))
    await expect(Promise.all([first, second])).resolves.toEqual([
      pageResult('50', 1, {
        providerKey: undefined,
        externalId: undefined,
        canonicalUrl: undefined
      }),
      pageResult('50', 1, {
        providerKey: undefined,
        externalId: undefined,
        canonicalUrl: undefined
      })
    ])
    expect(remote).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures or inconsistent continuation pages and keeps loaded pages retryable', async () => {
    let pageOneAttempts = 0
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => {
      if (page === 0) return pageResult(gidFromUrl(url), 0)
      pageOneAttempts += 1
      if (pageOneAttempts === 1) throw new Error(`failed ${gallery('60', 'do-not-leak')}`)
      if (pageOneAttempts === 2) return pageResult('60', 1, { total: 5 })
      return pageResult('60', 1)
    })
    const { dependencies } = providerDependencies(remote, {
      store: new ArchivePreviewStore(),
      createId: () => 'preview-retry'
    })
    await openArchivePreview({ source: { kind: 'url', url: gallery('60') } }, 'user-1', dependencies)

    await expect(
      getArchivePreviewPage({ previewId: 'preview-retry', page: 1 }, 'user-1', dependencies)
    ).rejects.toSatisfy((error: ArchiveError) => !error.message.includes('do-not-leak'))
    await expect(
      getArchivePreviewPage({ previewId: 'preview-retry', page: 1 }, 'user-1', dependencies)
    ).rejects.toMatchObject({
      code: 'REMOTE_RESPONSE_INVALID'
    })
    await expect(
      getArchivePreviewPage({ previewId: 'preview-retry', page: 1 }, 'user-1', dependencies)
    ).resolves.toMatchObject({
      page: 1,
      total: 4
    })
    expect(pageOneAttempts).toBe(3)
  })

  it('expires page cache after five minutes and sessions after thirty idle minutes', async () => {
    let now = 0
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => pageResult(gidFromUrl(url), page))
    const store = new ArchivePreviewStore({ now: () => now })
    const ids = ['preview-time-1', 'preview-time-2', 'preview-time-3']
    const { dependencies } = providerDependencies(remote, { store, createId: () => ids.shift()! })

    await openArchivePreview({ source: { kind: 'url', url: gallery('70') } }, 'user-1', dependencies)
    now = 5 * 60_000 - 1
    await openArchivePreview({ source: { kind: 'url', url: gallery('70') } }, 'user-1', dependencies)
    expect(remote).toHaveBeenCalledTimes(1)
    now = 5 * 60_000
    await openArchivePreview({ source: { kind: 'url', url: gallery('70') } }, 'user-1', dependencies)
    expect(remote).toHaveBeenCalledTimes(2)

    now = 35 * 60_000
    remote.mockClear()
    await expect(
      getArchivePreviewPage({ previewId: 'preview-time-1', page: 1 }, 'user-1', dependencies)
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    expect(remote).not.toHaveBeenCalled()
  })

  it('evicts least-recent sessions when the global retained page budget is reached', async () => {
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => pageResult(gidFromUrl(url), page))
    const store = new ArchivePreviewStore({ maxSessions: 10, maxSessionPagesTotal: 1, maxSessionThumbnailsTotal: 10 })
    const ids = ['preview-budget-a', 'preview-budget-b']
    const { dependencies } = providerDependencies(remote, { store, createId: () => ids.shift()! })
    await openArchivePreview({ source: { kind: 'url', url: gallery('80') } }, 'user-1', dependencies)
    await openArchivePreview({ source: { kind: 'url', url: gallery('81') } }, 'user-1', dependencies)
    remote.mockClear()

    await expect(
      getArchivePreviewPage({ previewId: 'preview-budget-a', page: 1 }, 'user-1', dependencies)
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    expect(remote).not.toHaveBeenCalled()
  })

  it('invalidates stale in-flight pages during reload without breaking another session sharing the request', async () => {
    let settleShared!: (value: unknown) => void
    const shared = new Promise((resolve) => {
      settleShared = resolve
    })
    let pageOneCalls = 0
    let pageZeroCalls = 0
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => {
      const gid = gidFromUrl(url)
      if (page === 0) {
        pageZeroCalls += 1
        return pageResult(gid, 0, { title: pageZeroCalls === 1 ? `Gallery ${gid}` : `Gallery ${gid}` })
      }
      pageOneCalls += 1
      return pageOneCalls === 1 ? shared : pageResult(gid, 1)
    })
    const ids = ['preview-reload-a', 'preview-reload-b']
    const store = new ArchivePreviewStore()
    const { dependencies } = providerDependencies(remote, { store, createId: () => ids.shift()! })
    await openArchivePreview({ source: { kind: 'url', url: gallery('90') } }, 'user-1', dependencies)
    await openArchivePreview({ source: { kind: 'url', url: gallery('90') } }, 'user-2', dependencies)

    const staleA = getArchivePreviewPage({ previewId: 'preview-reload-a', page: 1 }, 'user-1', dependencies)
    const sharedB = getArchivePreviewPage({ previewId: 'preview-reload-b', page: 1 }, 'user-2', dependencies)
    const reloadedA = reloadArchivePreview({ previewId: 'preview-reload-a' }, 'user-1', dependencies)
    settleShared(pageResult('90', 1))

    await expect(staleA).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(sharedB).resolves.toMatchObject({ page: 1 })
    await expect(reloadedA).resolves.toMatchObject({ page: 0 })
    await expect(
      getArchivePreviewPage({ previewId: 'preview-reload-a', page: 1 }, 'user-1', dependencies)
    ).resolves.toMatchObject({
      page: 1
    })
    expect(pageOneCalls).toBe(2)
  })

  it('keeps reload retryable after a refresh failure and safely bounds retry hints', async () => {
    let pageZeroCalls = 0
    const remote = vi.fn(async ({ url, page }: { url: string; page: number }) => {
      pageZeroCalls += 1
      if (pageZeroCalls === 2) {
        const error = new Error(`limited ${gallery('100', 'never-show')}`) as Error & {
          code: string
          retryAfterMs: number
        }
        error.code = 'REMOTE_RATE_LIMITED'
        error.retryAfterMs = 10 * 24 * 60 * 60_000
        throw error
      }
      return pageResult(gidFromUrl(url), page)
    })
    const { dependencies } = providerDependencies(remote, {
      store: new ArchivePreviewStore(),
      createId: () => 'preview-reload-retry'
    })
    await openArchivePreview({ source: { kind: 'url', url: gallery('100') } }, 'user-1', dependencies)
    await expect(
      reloadArchivePreview({ previewId: 'preview-reload-retry' }, 'user-1', dependencies)
    ).rejects.toMatchObject({
      code: 'REMOTE_RATE_LIMITED',
      retryAfterMs: 24 * 60 * 60_000,
      message: '原站暂时限制了预览请求，请稍后重试'
    })
    await expect(
      reloadArchivePreview({ previewId: 'preview-reload-retry' }, 'user-1', dependencies)
    ).resolves.toMatchObject({
      page: 0
    })
  })
})
