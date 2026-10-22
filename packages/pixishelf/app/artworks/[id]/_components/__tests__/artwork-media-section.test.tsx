import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto } from '@pixishelf/db/reading-contract'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'
import type { useArtworkSummary } from '../artwork-summary-context'

const mocks = vi.hoisted(() => ({
  observedReading: null as ArtworkReadingHandle | null,
  observe: vi.fn(),
  stackSession: null as ReturnType<typeof useArtworkSummary>,
  localMounts: 0,
  readingContext: null as ReadingContextDto | null,
  markRead: vi.fn(),
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
  ownerUserId: 'alice',
  pathname: '/artworks/7',
  ratingOpen: false,
  readingSummary: null as null | { status: string; viewCount: number; seenCount: number; totalCount: number },
  localUnmounts: 0
}))

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('../artwork-summary-context', () => ({ useArtworkSummary: () => mocks.stackSession }))
vi.mock('../artwork-detail-controls', () => ({ useArtworkDetailControls: () => ({ ratingOpen: mocks.ratingOpen }) }))

vi.mock('sonner', () => ({ toast: { custom: mocks.toastCustom, dismiss: mocks.toastDismiss, error: vi.fn() } }))

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
    observe: mocks.observe,
    clearSurface: () => {},
    flush: () => Promise.resolve(),
    reopen: () => Promise.resolve()
  })
}))

vi.mock('../artwork-images', async () => {
  const React = await import('react')
  const { ReadingMediaStatus } = await import('../reading-media-status')
  return {
    default: ({ images, reading, continueRequest }: { images: ArtworkImageResponseDto[]; reading: ArtworkReadingHandle; continueRequest?: { index: number } }) => {
      mocks.observedReading = reading
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

describe('ArtworkMediaSection', () => {
  beforeEach(() => {
    mocks.observe.mockReset()
    mocks.observedReading = null
    mocks.stackSession = null
    mocks.readingContext = null
    mocks.ownerUserId = 'alice'
    mocks.pathname = '/artworks/7'
    mocks.ratingOpen = false
    mocks.markRead.mockReset()
    mocks.toastCustom.mockReset()
    mocks.toastDismiss.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.localMounts = 0
    mocks.readingSummary = null
    mocks.localUnmounts = 0
  })

  afterEach(cleanup)

  it.each(['complete', 'stack'] as const)('keeps only valid active preview observations as the source-conflict recovery anchor in %s mode', (mode) => {
    const rememberPreviewMedia = vi.fn()
    mocks.stackSession = {
      ready: false, mode, availableMediaIds: { current: null }, groups: [], byMediaId: new Map(), activeByGroup: new Map(),
      navigationRef: { current: { active: false, nonce: 0 } }, navigating: false, rememberPreviewMedia
    } as unknown as NonNullable<ReturnType<typeof useArtworkSummary>>
    renderSection()
    const observation = { mediaId: 13, ready: true, visible: true, active: true, automatic: false }
    mocks.observedReading!.observe('adaptive-preview', observation)
    expect(rememberPreviewMedia).toHaveBeenLastCalledWith(13)
    mocks.observedReading!.observe('adaptive-preview', { ...observation, mediaId: 14, ready: false })
    mocks.observedReading!.observe('adaptive-preview', { ...observation, mediaId: 15, visible: false })
    mocks.observedReading!.observe('adaptive-preview', { ...observation, mediaId: 16, active: false })
    mocks.observedReading!.observe('detail-11', { ...observation, mediaId: 11 })
    expect(rememberPreviewMedia).toHaveBeenCalledTimes(1)
  })

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

  it('restores the original entry resume position after rating and respects a user dismissal', () => {
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
    const id = mocks.toastCustom.mock.calls[0]![1].id
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 11, index: 0 } }
    mocks.ratingOpen = true
    view.rerender(content())
    expect(mocks.toastDismiss).toHaveBeenCalledWith(id)
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1)
    mocks.ratingOpen = false
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2)
    expect(mocks.toastCustom.mock.calls[1]![1].id).toBe(id)
    const prompt = render(mocks.toastCustom.mock.calls[1]![0]())
    fireEvent.click(screen.getByRole('button', { name: '跳转' }))
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    prompt.unmount()
    mocks.ratingOpen = true
    view.rerender(content())
    mocks.ratingOpen = false
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(2)
  })

  it('captures the entry resume while rating is already open and does not resurrect a swiped-away prompt', () => {
    mocks.ratingOpen = true
    mocks.readingContext = {
      artworkId: 7, mediaRevision: 1, seenMediaIds: [],
      media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }, { mediaId: 12, memberMediaIds: [12], index: 1 }],
      resume: { mediaId: 12, index: 1 },
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 2,
        status: 'IN_PROGRESS', lastViewedAt: null, lastActiveAt: null, lastMediaId: 12, lastMediaIndex: 1 }
    }
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(content())
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 11, index: 0 } }
    mocks.ratingOpen = false
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1)
    expect(mocks.toastCustom.mock.calls[0]![0]().props.index).toBe(1)
    mocks.toastCustom.mock.calls[0]![1].onDismiss()
    mocks.ratingOpen = true
    view.rerender(content())
    mocks.ratingOpen = false
    view.rerender(content())
    expect(mocks.toastCustom).toHaveBeenCalledTimes(1)
  })

  it('always renders local reading without a source selector', () => {
    renderSection()
    expect(screen.getByTestId('local-images')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(mocks.localMounts).toBe(1)
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

  it('rejects stale detail visibility after collapse without suppressing the active preview', () => {
    renderSection()
    const anchor = document.createElement('div')
    anchor.dataset.summaryAnchor = '11'
    anchor.getBoundingClientRect = () => ({ top: 3000, bottom: 3500 }) as DOMRect
    document.body.append(anchor)
    const observation = { mediaId: 11, visible: true, ready: true, active: true, automatic: false, priority: 0 }
    mocks.observedReading!.observe('detail-11', observation)
    expect(mocks.observe.mock.lastCall?.[1].visible).toBe(false)
    mocks.observedReading!.observe('adaptive-preview', { ...observation, priority: 10 })
    expect(mocks.observe.mock.lastCall?.[1].visible).toBe(true)
    anchor.getBoundingClientRect = () => ({ top: 100, bottom: 500 }) as DOMRect
    mocks.observedReading!.observe('detail-11', observation)
    expect(mocks.observe.mock.lastCall?.[1].visible).toBe(true)
    anchor.remove()
  })

})
