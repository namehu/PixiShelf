import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingContextDto } from '@pixishelf/db/reading-contract'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { useArtworkReading } from '@/lib/reading/reading-provider'
import { useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'
import type { useArtworkSummary } from '../artwork-summary-context'
import { useLikedMediaIds } from '@/hooks/use-media-mark'

const mocks = vi.hoisted(() => ({
  observedReading: null as ArtworkReadingHandle | null,
  observe: vi.fn(),
  stackSession: null as ReturnType<typeof useArtworkSummary>,
  localMounts: 0,
  readingContext: null as ReadingContextDto | null,
  markRead: vi.fn(),
  marking: false,
  markError: null as string | null,
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
  ownerUserId: 'alice',
  invalidated: false,
  isLoading: false,
  error: null as unknown,
  retry: vi.fn(),
  completeContinue: undefined as (() => void) | undefined,
  pathname: '/artworks/7',
  ratingOpen: false,
  readingSummary: null as null | { status: string; viewCount: number; seenCount: number; totalCount: number },
  localUnmounts: 0
}))

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/hooks/use-media-mark', () => ({ useLikedMediaIds: vi.fn() }))
vi.mock('../artwork-summary-context', () => ({ useArtworkSummary: () => mocks.stackSession }))
vi.mock('../artwork-detail-controls', () => ({ useArtworkDetailControls: () => ({ ratingOpen: mocks.ratingOpen }) }))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({ useArtworkReader: vi.fn(() => null) }))

vi.mock('sonner', () => ({ toast: { custom: mocks.toastCustom, dismiss: mocks.toastDismiss, error: vi.fn() } }))

vi.mock('@/lib/reading/reading-provider', () => ({
  useArtworkReading: () => ({
    ownerUserId: mocks.ownerUserId,
    markRead: mocks.markRead,
    marking: mocks.marking,
    markError: mocks.markError,
    context: mocks.readingContext,
    summary: mocks.readingSummary,
    resume: mocks.readingContext?.resume ?? null,
    isLoading: mocks.isLoading,
    error: mocks.error,
    retry: mocks.retry,
    invalidated: mocks.invalidated,
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
    default: ({ images, reading, continueRequest, onContinueHandled }: { images: ArtworkImageResponseDto[]; reading: ArtworkReadingHandle; continueRequest?: { index: number }; onContinueHandled?: () => void }) => {
      mocks.observedReading = reading
      mocks.completeContinue = onContinueHandled
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
    <button onClick={() => view.requestReadingAction('liked-filter')} aria-pressed={view.readingMenu.likedOnly}>只看喜欢的图片</button>
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
    vi.mocked(useLikedMediaIds).mockReturnValue({ data: { mediaIds: [12] }, isPending: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useLikedMediaIds>)
    mocks.observedReading = null
    mocks.stackSession = null
    mocks.readingContext = null
    mocks.ownerUserId = 'alice'
    mocks.invalidated = false
    mocks.isLoading = false
    mocks.error = null
    mocks.retry.mockReset()
    vi.mocked(useArtworkReader).mockReturnValue(null)
    mocks.completeContinue = undefined
    mocks.pathname = '/artworks/7'
    mocks.ratingOpen = false
    window.history.replaceState({}, '', '/artworks/7')
    mocks.markRead.mockReset()
    mocks.marking = false
    mocks.markError = null
    mocks.toastCustom.mockReset()
    mocks.toastDismiss.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.localMounts = 0
    mocks.readingSummary = null
    mocks.localUnmounts = 0
  })

  afterEach(cleanup)

  function resumedContext(): ReadingContextDto {
    return {
      artworkId: 7, mediaRevision: 1, seenMediaIds: [11],
      media: [{ mediaId: 11, memberMediaIds: [11], index: 0 }, { mediaId: 12, memberMediaIds: [12], index: 1 }],
      resume: { mediaId: 12, index: 1 },
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 2,
        status: 'IN_PROGRESS', lastViewedAt: null, lastActiveAt: null, lastMediaId: 12, lastMediaIndex: 1 }
    }
  }

  it('consumes an explicit entry once, restores its position without a toast and gates observations until settled', () => {
    window.history.replaceState({ keep: true }, '', '/artworks/7?resume=1&entry=direct#media')
    const content = () => <StrictMode><ArtworkMediaViewProvider>
      <ArtworkMediaSection images={[{ id: 11 }, { id: 12 }] as ArtworkImageResponseDto[]} artworkId={7} resumeOnEntry />
    </ArtworkMediaViewProvider></StrictMode>
    const view = render(content())
    expect(window.location.search).toBe('?entry=direct')
    expect(window.location.hash).toBe('#media')
    expect(window.history.state).toEqual({ keep: true })
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBeNull()
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 11, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(false)
    mocks.readingContext = resumedContext()
    view.rerender(content())
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    act(() => mocks.completeContinue?.())
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 12, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 11, index: 0 } }
    view.rerender(content())
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    expect(mocks.toastCustom).not.toHaveBeenCalled()
  })

  it('does not repeat explicit navigation or show a prompt during Strict Mode effect replay', () => {
    window.history.replaceState({}, '', '/artworks/7?resume=1')
    mocks.readingContext = resumedContext()
    render(<StrictMode><ArtworkMediaViewProvider>
      <ArtworkMediaSection images={[{ id: 11 }, { id: 12 }] as ArtworkImageResponseDto[]} artworkId={7} resumeOnEntry />
    </ArtworkMediaViewProvider></StrictMode>)
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    expect(mocks.toastCustom).not.toHaveBeenCalled()
  })

  function mockReaderQuery({ isFetching = false, error = null }: { isFetching?: boolean; error?: unknown } = {}) {
    vi.mocked(useArtworkReader).mockReturnValue({
      images: [{ id: 11 }, { id: 12 }],
      reading: useArtworkReading(7),
      invalidated: false,
      isFetching,
      error
    } as unknown as NonNullable<ReturnType<typeof useArtworkReader>>)
  }

  it.each(['loading', 'error'] as const)('waits for the reader query while %s rather than consuming a cached resume target', (state) => {
    window.history.replaceState({}, '', '/artworks/7?resume=1')
    mocks.readingContext = resumedContext()
    mocks.readingSummary = mocks.readingContext.summary
    const error = state === 'error' ? new Error('offline') : null
    mockReaderQuery({ isFetching: state === 'loading', error })
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} resumeOnEntry /></ArtworkMediaViewProvider>
    const view = render(content())
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBeNull()
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    if (error) {
      expect(screen.getByRole('status').textContent).toBe('继续阅读加载失败')
      fireEvent.click(screen.getByRole('button', { name: '重试' }))
      expect(mocks.retry).toHaveBeenCalledOnce()
      mockReaderQuery({ isFetching: true, error })
      view.rerender(content())
      expect(screen.getByRole('button', { name: '正在重试…' }).hasAttribute('disabled')).toBe(true)
    }
    mocks.readingContext = { ...mocks.readingContext, resume: { mediaId: 11, index: 0 } }
    mockReaderQuery()
    view.rerender(content())
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('0')
    expect(mocks.toastCustom).not.toHaveBeenCalled()
  })

  it('does not let a prior report error block restoration from a successful reader query', () => {
    window.history.replaceState({}, '', '/artworks/7?resume=1')
    mocks.readingContext = resumedContext()
    mocks.readingSummary = mocks.readingContext.summary
    mocks.error = new Error('a previous report failed')
    mockReaderQuery()
    render(<ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} resumeOnEntry /></ArtworkMediaViewProvider>)

    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBe('1')
    expect(screen.getByRole('alert').textContent).toBe('阅读进度尚未保存，请检查连接。')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    act(() => mocks.completeContinue?.())
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 12, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
    expect(mocks.toastCustom).not.toHaveBeenCalled()
  })

  it.each(['account', 'invalidated'] as const)('cancels pending explicit restoration after %s changes', (change) => {
    window.history.replaceState({}, '', '/artworks/7?resume=1')
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} resumeOnEntry /></ArtworkMediaViewProvider>
    const view = render(content())
    if (change === 'account') mocks.ownerUserId = 'bob'
    else mocks.invalidated = true
    mocks.readingContext = resumedContext()
    view.rerender(content())
    expect(screen.queryByTestId('local-images')?.getAttribute('data-continue-index') ?? null).toBeNull()
    if (change === 'account') {
      mocks.observedReading!.observe('adaptive-preview', { mediaId: 12, ready: true, visible: true, active: true, automatic: false })
      expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
    }
  })

  it('releases the entry gate when the current context has no resumable media', () => {
    window.history.replaceState({}, '', '/artworks/7?resume=1')
    mocks.readingContext = { ...resumedContext(), resume: null }
    render(<ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} resumeOnEntry /></ArtworkMediaViewProvider>)
    expect(screen.getByTestId('local-images').getAttribute('data-continue-index')).toBeNull()
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 12, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
  })

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

  it.each(['complete', 'stack'] as const)('shows the same records at both ends in %s mode and marks the whole artwork', (mode) => {
    const images = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) as ArtworkImageResponseDto[]
    mocks.readingContext = {
      ...resumedContext(), resume: null, seenMediaIds: images.slice(0, 90).map((image) => image.id),
      media: images.map((image, index) => ({ mediaId: image.id, memberMediaIds: [image.id], index })),
      summary: { ...resumedContext().summary, seenCount: 90, totalCount: 100, status: 'COMPLETED' }
    }
    mocks.readingSummary = mocks.readingContext.summary
    mocks.stackSession = {
      ready: false, mode, availableMediaIds: { current: null }, groups: [{ id: 'stack', mediaIds: images.map((image) => image.id) }],
      byMediaId: new Map(), activeByGroup: new Map(), navigationRef: { current: { active: false, nonce: 0 } }, navigating: false
    } as unknown as NonNullable<ReturnType<typeof useArtworkSummary>>
    const content = () => <ArtworkMediaViewProvider><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(content())
    const footer = screen.getByRole('region', { name: '阅读记录与操作' })
    const progress = screen.getAllByText('已读完 · 已记录 90 / 100 张')
    expect(progress).toHaveLength(2)
    expect(screen.getAllByText('阅读 1 次')).toHaveLength(2)
    expect(progress[0]!.compareDocumentPosition(screen.getByTestId('local-images')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('local-images').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const action = within(footer).getByRole('button', { name: '标记全部已读' })
    expect(action.hasAttribute('disabled')).toBe(false)
    fireEvent.click(action)
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith({ kind: 'ALL' })

    mocks.marking = true
    mocks.readingSummary = { ...mocks.readingSummary, seenCount: 100 }
    view.rerender(content())
    expect(screen.getAllByText('已读完 · 100 张')).toHaveLength(2)
    expect(action.getAttribute('aria-busy')).toBe('true')
    expect(action.hasAttribute('disabled')).toBe(true)

    mocks.marking = false
    mocks.markError = '标记未保存，请重试。'
    mocks.readingSummary = { ...mocks.readingSummary, seenCount: 90 }
    view.rerender(content())
    expect(screen.getAllByRole('alert').map((element) => element.textContent)).toEqual(['标记未保存，请重试。', '标记未保存，请重试。'])
    expect(screen.getAllByText('已读完 · 已记录 90 / 100 张')).toHaveLength(2)
    expect(action.hasAttribute('disabled')).toBe(false)
    fireEvent.click(action)
    expect(mocks.markRead).toHaveBeenCalledTimes(2)
  })

  it('keeps one reopen prompt and removes the footer when the reading revision is invalidated', () => {
    mocks.readingContext = resumedContext()
    mocks.readingSummary = mocks.readingContext.summary
    mocks.invalidated = true
    renderSection()
    expect(screen.queryByRole('region', { name: '阅读记录与操作' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '重新打开' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '标记全部已读' })).toBeNull()
  })

  it('hides the footer for an invalid media entry until normal browsing is chosen', () => {
    window.history.replaceState({}, '', '/artworks/7?mediaId=bad')
    mocks.readingContext = resumedContext()
    mocks.readingSummary = mocks.readingContext.summary
    render(<ArtworkMediaViewProvider><ArtworkMediaSection images={[]} artworkId={7} mediaIdOnEntry={null} /></ArtworkMediaViewProvider>)
    expect(screen.getByText('图片链接无效。')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '阅读记录与操作' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看全部图片' }))
    expect(screen.getByRole('region', { name: '阅读记录与操作' })).toBeTruthy()
  })

  it('finds remaining unread items in a threshold-complete work, preserves the round and refreshes to empty', () => {
    const images = Array.from({ length: 600 }, (_, index) => ({ id: index + 1 })) as ArtworkImageResponseDto[]
    const seenMediaIds = images.map((image) => image.id).filter((id) => id !== 237 && id !== 599)
    mocks.readingContext = {
      artworkId: 7, mediaRevision: 1, seenMediaIds,
      media: images.map((image, index) => ({ mediaId: image.id, memberMediaIds: [image.id], index })), resume: null,
      summary: { artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 598, totalCount: 600,
        status: 'COMPLETED', lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null }
    }
    mocks.readingSummary = mocks.readingContext.summary
    const renderContent = () => <ArtworkMediaViewProvider><ReadingMenuHarness /><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(renderContent())
    expect(mocks.toastCustom).not.toHaveBeenCalled()
    expect(screen.getAllByText('已读完 · 已记录 598 / 600 张')).toHaveLength(2)
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
    expect(screen.getAllByText('已读完 · 600 张')).toHaveLength(2)
    expect(screen.getAllByText('阅读 1 次')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: '阅读记录与操作' })).getByRole('button', { name: '标记全部已读' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByRole('button', { name: '查看全部' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '查看全部' })[0]!)
    expect(screen.getByText('第 1 张')).toBeTruthy()
  })

  it('filters by liked identity, preserves original positions and switches back to all or unread', () => {
    mocks.readingContext = { ...resumedContext(), resume: null }
    mocks.readingSummary = mocks.readingContext.summary
    const images = [{ id: 11 }, { id: 12 }] as ArtworkImageResponseDto[]
    const content = () => <ArtworkMediaViewProvider><ReadingMenuHarness /><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    render(content())
    const pause = vi.spyOn(useArtworkAutoBrowseStore.getState(), 'pause')
    fireEvent.click(screen.getByRole('button', { name: '只看喜欢的图片' }))
    expect(pause).toHaveBeenCalledWith('manual')
    expect(screen.queryByText('第 1 张')).toBeNull()
    expect(screen.getByText('第 2 张')).toBeTruthy()
    expect(screen.getByRole('button', { name: '只看喜欢的图片' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '只看喜欢的图片' }))
    expect(screen.getByText('第 1 张')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '只看喜欢的图片' }))
    fireEvent.click(screen.getByRole('button', { name: '只看未读' }))
    expect(screen.getByRole('button', { name: '只看喜欢的图片' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('第 1 张')).toBeNull()
    expect(screen.getByText('第 2 张')).toBeTruthy()
  })

  it('keeps loading, errors and an empty liked selection separate and can restore the full list', () => {
    mocks.readingContext = { ...resumedContext(), resume: null }
    const retry = vi.fn()
    const result = { data: undefined, isPending: true, error: null, refetch: retry } as unknown as ReturnType<typeof useLikedMediaIds>
    vi.mocked(useLikedMediaIds).mockReturnValue(result)
    const images = [{ id: 11 }, { id: 12 }] as ArtworkImageResponseDto[]
    const content = () => <ArtworkMediaViewProvider><ReadingMenuHarness /><ArtworkMediaSection images={images} artworkId={7} /></ArtworkMediaViewProvider>
    const view = render(content())
    fireEvent.click(screen.getByRole('button', { name: '只看喜欢的图片' }))
    expect(screen.getByText('正在加载喜欢的图片…')).toBeTruthy()
    expect(screen.queryByText('还没有喜欢的图片')).toBeNull()
    expect(screen.queryByTestId('local-images')).toBeNull()
    vi.mocked(useLikedMediaIds).mockReturnValue({ ...result, isPending: false, error: new Error('offline') } as ReturnType<typeof useLikedMediaIds>)
    view.rerender(content())
    expect(screen.getByText('喜欢的图片加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
    vi.mocked(useLikedMediaIds).mockReturnValue({ ...result, data: { mediaIds: [] }, isPending: false } as ReturnType<typeof useLikedMediaIds>)
    view.rerender(content())
    expect(screen.getByText('还没有喜欢的图片')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看全部图片' }))
    expect(screen.getByText('第 1 张')).toBeTruthy()
    expect(screen.getByText('第 2 张')).toBeTruthy()
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
