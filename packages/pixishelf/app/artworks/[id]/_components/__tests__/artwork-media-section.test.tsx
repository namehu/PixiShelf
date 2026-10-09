import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto } from '@pixishelf/db/reading-contract'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'

const mocks = vi.hoisted(() => ({
  requests: [] as Array<{
    variables: { source: { externalRefId: string } }
    options: {
      onSuccess: (result: unknown) => void
      onError: () => void
      onSettled: () => void
    }
  }>,
  sources: [] as Array<{ externalRefId: string; providerKey: string; label: string }>,
  localMounts: 0,
  readingContext: null as ReadingContextDto | null,
  markRead: vi.fn(),
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
  ownerUserId: 'alice',
  pathname: '/artworks/7',
  readingSummary: null as null | { status: string; viewCount: number; seenCount: number; totalCount: number },
  localUnmounts: 0
}))

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))

vi.mock('sonner', () => ({ toast: { custom: mocks.toastCustom, dismiss: mocks.toastDismiss, error: vi.fn() } }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.sources }),
  useMutation: () => ({
    mutate: (variables: never, options: never) => mocks.requests.push({ variables, options })
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archivePreview: {
      sources: { queryOptions: () => ({}) },
      open: { mutationOptions: () => ({}) }
    }
  })
}))

vi.mock('@/lib/reading/reading-provider', () => ({
  useArtworkReading: () => ({
    ownerUserId: mocks.ownerUserId,
    markRead: mocks.markRead,
    marking: false,
    markError: null,
    context: mocks.readingContext,
    summary: mocks.readingSummary,
    resume: mocks.readingContext?.resume ?? null,
    isLoading: false,
    error: null,
    invalidated: false,
    observationEpoch: 0,
    observe: () => {},
    clearSurface: () => {},
    flush: () => Promise.resolve(),
    reopen: () => Promise.resolve()
  })
}))

vi.mock('@/components/source-preview/source-preview-reader', () => ({
  SourcePreviewReader: ({ previewId }: { previewId: string }) => <div data-testid="source-reader">{previewId}</div>
}))

vi.mock('../artwork-images', async () => {
  const React = await import('react')
  const { ReadingMediaStatus } = await import('../reading-media-status')
  return {
    default: ({ images, reading, continueRequest }: { images: ArtworkImageResponseDto[]; reading: ArtworkReadingHandle; continueRequest?: { index: number } }) => {
      React.useEffect(() => {
        mocks.localMounts += 1
        return () => {
          mocks.localUnmounts += 1
        }
      }, [])
      return <div data-testid="local-images" data-continue-index={continueRequest?.index}>本地图片列表{images.map((image) => <ReadingMediaStatus key={image.id} reading={reading} mediaId={image.id} loadFailed={image.id === 237} />)}</div>
    }
  }
})

function ReadingMenuHarness() {
  const view = useArtworkMediaView()!
  if (!view.readingMenu) return null
  return <nav aria-label="阅读操作测试入口">
    <button onClick={() => view.requestReadingAction('filter')}>{view.readingMenu.unreadOnly ? '查看全部' : '只看未读'}</button>
    {view.readingMenu.unreadOnly && <button onClick={() => view.requestReadingAction('refresh')}>刷新未读</button>}
    {view.readingMenu.remaining > 0 && <button onClick={() => view.requestReadingAction('mark-all')}>标记全部已读</button>}
  </nav>
}

function renderSection() {
  return render(
    <ArtworkMediaViewProvider>
      <ArtworkMediaSection images={[]} artworkId={7} />
    </ArtworkMediaViewProvider>
  )
}

function opened(previewId: string) {
  return {
    previewId,
    title: previewId,
    total: 1,
    page: 0,
    items: [{ ordinal: 0, url: 'https://ehgt.org/thumb.jpg', width: 100, height: 100 }],
    nextPage: null
  }
}

function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

describe('ArtworkMediaSection', () => {
  beforeEach(() => {
    mocks.requests.length = 0
    mocks.sources = []
    mocks.readingContext = null
    mocks.ownerUserId = 'alice'
    mocks.pathname = '/artworks/7'
    mocks.markRead.mockReset()
    mocks.toastCustom.mockReset()
    mocks.toastDismiss.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.localMounts = 0
    mocks.readingSummary = null
    mocks.localUnmounts = 0
  })

  afterEach(cleanup)

  it('removes continue reading when progress becomes complete even if a resume position remains', () => {
    mocks.readingSummary = { status: 'IN_PROGRESS', viewCount: 1, seenCount: 1, totalCount: 2 }
    const view = renderSection()
    expect(screen.queryByRole('button', { name: '继续阅读' })).toBeNull()
    mocks.readingSummary = { ...mocks.readingSummary, status: 'COMPLETED', seenCount: 2 }
    view.rerender(
      <ArtworkMediaViewProvider>
        <ArtworkMediaSection images={[]} artworkId={7} />
      </ArtworkMediaViewProvider>
    )
    expect(screen.getAllByText(/已读完/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '继续阅读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '标记全部已读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '只看未读' })).toBeNull()
    expect(screen.getAllByText('阅读 1 次')).toHaveLength(1)
  })

  it('offers the entry resume position once, retains it after automatic updates and cleans up on leave', () => {
    mocks.readingContext = {
      artworkId: 7, mediaRevision: 1, seenMediaIds: [],
      media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }, { mediaId: 12, memberMediaIds: [12], index: 1 }],
      resume: { mediaId: 12, index: 1 },
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 2,
        status: 'IN_PROGRESS', lastViewedAt: null, lastActiveAt: null, lastMediaId: 12, lastMediaIndex: 1 }
    }
    const images = [{ id: 11 }, { id: 12 }] as ArtworkImageResponseDto[]
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1)
    const prompt = render(mocks.toastCustom.mock.calls[0]![0]())
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 11, index: 0 } }
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '跳转' }))
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '从头开始' }))
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('0')
    const firstId = mocks.toastCustom.mock.calls[0]![1].id
    prompt.unmount()
    mocks.pathname = '/artworks'
    view.rerender(content())
    expect(mocks.toastDismiss).toHaveBeenCalledWith(firstId)
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 12, index: 1 } }
    mocks.pathname = '/artworks/7'
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2)
    const secondId = mocks.toastCustom.mock.calls[1]![1].id
    expect(secondId).not.toBe(firstId)
    view.unmount()
    expect(mocks.toastDismiss).toHaveBeenCalledWith(secondId)
  })

  it('does not prompt for the first image or later automatic progress during the same visit', () => {
    mocks.readingContext = {
      artworkId: 7, mediaRevision: 1, seenMediaIds: [11],
      media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }, { mediaId: 12, memberMediaIds: [12], index: 1 }],
      resume: { mediaId: 11, index: 0 },
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 2,
        status: 'IN_PROGRESS', lastViewedAt: null, lastActiveAt: null, lastMediaId: 11, lastMediaIndex: 0 }
    }
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(content())
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 12, index: 1 } }
    view.rerender(content())
    expect(mocks.toastCustom).not.toHaveBeenCalled()
  })

  it('keeps the local viewer mounted when the source query arrives', () => {
    const view = renderSection()
    expect(mocks.localMounts).toBe(1)

    mocks.sources = [{ externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' }]
    view.rerender(
      <ArtworkMediaViewProvider>
        <ArtworkMediaSection images={[]} artworkId={7} />
      </ArtworkMediaViewProvider>
    )

    expect(screen.getByRole('tab', { name: '原站预览' })).toBeTruthy()
    expect(mocks.localMounts).toBe(1)
    expect(mocks.localUnmounts).toBe(0)
  })

  it('ignores an older source response after a newer source was chosen', () => {
    mocks.sources = [
      { externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' },
      { externalRefId: 'source-b', providerKey: 'e-hentai', label: '#102' }
    ]
    renderSection()
    selectTab('原站预览')
    fireEvent.click(screen.getByRole('button', { name: '#101' }))
    fireEvent.click(screen.getByRole('button', { name: '#102' }))

    act(() => {
      mocks.requests[1]!.options.onSuccess(opened('preview-b'))
      mocks.requests[1]!.options.onSettled()
    })
    expect(screen.getByTestId('source-reader').textContent).toBe('preview-b')

    act(() => {
      mocks.requests[0]!.options.onSuccess(opened('preview-a'))
      mocks.requests[0]!.options.onSettled()
    })
    expect(screen.getByTestId('source-reader').textContent).toBe('preview-b')
  })

  it('ignores a pending source response after returning to local images', () => {
    mocks.sources = [{ externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' }]
    renderSection()
    selectTab('原站预览')
    selectTab('本地图片')

    act(() => {
      mocks.requests[0]!.options.onSuccess(opened('preview-a'))
      mocks.requests[0]!.options.onSettled()
    })
    expect(screen.queryByTestId('source-reader')).toBeNull()
    expect(screen.getByTestId('local-images')).toBeTruthy()
  })
  it('finds the two unread items in 600, preserves the round and refreshes to empty', () => {
    const images = Array.from({ length: 600 }, (_, index) => ({ id: index + 1 })) as ArtworkImageResponseDto[]
    const seenMediaIds = images.map((image) => image.id).filter((id) => id !== 237 && id !== 599)
    mocks.readingContext = {
      artworkId: 7, mediaRevision: 1, seenMediaIds,
      media: images.map((image, index) => ({ mediaId: image.id, memberMediaIds: [image.id], index })), resume: null,
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 598, totalCount: 600,
        status: 'IN_PROGRESS', lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null }
    }
    mocks.readingSummary = mocks.readingContext.summary
    const renderContent = () => <ArtworkMediaViewProvider><ReadingMenuHarness /><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(renderContent())
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    const pause = vi.spyOn(useArtworkAutoBrowseStore.getState(), 'pause')
    fireEvent.click(screen.getAllByRole('button', { name: '只看未读' })[0]!)
    expect(pause).toHaveBeenCalledWith('manual')
    expect(screen.getByText('第 237 张')).toBeTruthy()
    expect(screen.getByText('第 599 张')).toBeTruthy()
    expect(screen.queryByText('第 1 张')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '标记第 237 张已读' }))
    expect(mocks.markRead).toHaveBeenCalledWith({ kind: 'MEDIA', mediaId: 237 })
    fireEvent.click(screen.getAllByRole('button', { name: '标记全部已读' })[0]!)
    expect(mocks.markRead).toHaveBeenLastCalledWith({ kind: 'ALL' })
    mocks.readingContext = { ...mocks.readingContext, seenMediaIds: images.map((image) => image.id),
      summary: { ...mocks.readingContext.summary, seenCount: 600, stateVersion: 2, status: 'COMPLETED' } }
    mocks.readingSummary = mocks.readingContext.summary
    view.rerender(renderContent())
    expect(screen.getByText('第 237 张')).toBeTruthy()
    expect(screen.getByText('第 599 张')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '刷新未读' })[0]!)
    expect(screen.getByText('没有未读内容')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '查看全部' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '查看全部' })[0]!)
    expect(screen.getByText('第 1 张')).toBeTruthy()
  })

})
