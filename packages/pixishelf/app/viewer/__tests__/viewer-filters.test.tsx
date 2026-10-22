import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ViewerPage from '../page'
import { useViewerStore } from '@/store/viewer-store'
import type { FilterSheetProps } from '@/components/artwork/filter-sheet'

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  feed: vi.fn(),
  sheet: null as FilterSheetProps | null
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }))
vi.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => vi.fn() }))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: 'viewer-user' }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({ artwork: { viewerFeed: { query: mocks.feed } } })
}))
vi.mock('../_components/immersive-image-viewer', () => ({
  default: ({
    playbackRate,
    onPlaybackRateChange,
    onLoadMore
  }: {
    playbackRate: number
    onPlaybackRateChange: (rate: number) => void
    onLoadMore: () => Promise<void>
  }) => (
    <>
      <button onClick={() => onPlaybackRateChange(1.5)}>当前倍速 {playbackRate}</button>
      <button onClick={() => void onLoadMore()}>加载更多</button>
    </>
  )
}))
vi.mock('@/components/artwork/filter-sheet', () => ({
  FilterSheet: (props: FilterSheetProps) => {
    mocks.sheet = props
    return null
  }
}))

const applied: Parameters<FilterSheetProps['onApply']>[0] = {
  search: 'saved search',
  mediaType: 'animation',
  sortBy: 'created_at_asc',
  artist: [{ value: '12', label: 'Artist' }],
  tags: [{ value: '34', label: 'Tag, with comma' }],
  sources: ['LOCAL_IMPORT'],
  hasAudio: 'no',
  readingStatus: 'UNREAD',
  likedOnly: true,
  maxMediaCount: 24,
  startTime: '2026-01-01',
  endTime: '2026-02-01',
  createdStartTime: '2026-03-01',
  createdEndTime: '2026-04-01'
}
let clients: QueryClient[] = []
beforeEach(() => {
  localStorage.clear()
  useViewerStore.setState({ ...useViewerStore.getInitialState(), hasHydrated: true })
  mocks.feed.mockReset().mockResolvedValue({ items: [], nextPage: null })
  mocks.sheet = null
})
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients = []
})
function mount(search = '') {
  mocks.params = new URLSearchParams(search)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(
    <NuqsTestingAdapter
      hasMemory
      searchParams={search}
      onUrlUpdate={({ searchParams }) => {
        mocks.params = searchParams
      }}
    >
      <QueryClientProvider client={client}>
        <ViewerPage />
      </QueryClientProvider>
    </NuqsTestingAdapter>
  )
}
async function applyFilters(filters = applied) {
  act(() => mocks.sheet!.onApply(filters))
  await waitFor(() => expect(mocks.params.get('mode')).toBe(filters.sortBy === 'random' ? 'random' : 'ordered'))
}
async function reloadStore() {
  const saved = localStorage.getItem('pixishelf-viewer-settings')!
  useViewerStore.setState(useViewerStore.getInitialState())
  localStorage.setItem('pixishelf-viewer-settings', saved)
  await useViewerStore.persist.rehydrate()
}

describe('immersive viewer filter persistence', () => {
  it.each(['ordered', 'random'])('keeps favorites and account context on %s continuation', async (mode) => {
    mocks.feed
      .mockResolvedValueOnce({
        items: [{ id: 1, key: 'one', images: [] }],
        nextReadingCursor: 'ordered-next',
        nextRandomCursor: 'random-next'
      })
      .mockResolvedValue({ items: [{ id: 2, key: 'two', images: [] }], nextPage: null })
    mount(`likedOnly=true&mode=${mode}&randomSeed=0`)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(2))
    expect(mocks.feed.mock.calls[1]?.[0]).toMatchObject({
      likedOnly: true,
      expectedUserId: 'viewer-user',
      cursor: undefined,
      readingCursor: mode === 'ordered' ? 'ordered-next' : undefined,
      randomCursor: mode === 'random' ? 'random-next' : undefined
    })
  })
  it('retains speed across filter remounts but resets on a new page visit without persisting it', async () => {
    mocks.feed.mockResolvedValue({ items: [{ id: 1, key: 'video', images: [] }], nextPage: null })
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: '当前倍速 1' }))
    expect(screen.getByRole('button', { name: '当前倍速 1.5' })).toBeTruthy()
    await applyFilters()
    expect(await screen.findByRole('button', { name: '当前倍速 1.5' })).toBeTruthy()
    expect(localStorage.getItem('pixishelf-viewer-settings')).not.toContain('playbackRate')
    view.unmount()
    mount()
    expect(await screen.findByRole('button', { name: '当前倍速 1' })).toBeTruthy()
  })

  it('restores all applied filters after a fresh store and navigation entry', async () => {
    const view = mount()
    await applyFilters()
    view.unmount()
    await reloadStore()
    mocks.feed.mockClear()
    mount('entry=direct')
    await waitFor(() => expect(mocks.feed).toHaveBeenCalled())
    expect(mocks.feed.mock.calls[0]?.[0]).toMatchObject({
      search: applied.search,
      mediaType: 'animation',
      mode: 'ordered',
      sortBy: 'created_at_asc',
      artistId: 12,
      tagIds: [34],
      sources: ['LOCAL_IMPORT'],
      hasAudio: 'no',
      readingStatus: 'UNREAD',
      likedOnly: true,
      mediaCountMax: 24,
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      createdStartDate: '2026-03-01',
      createdEndDate: '2026-04-01'
    })
    expect(mocks.sheet).toMatchObject({ currentArtist: applied.artist, currentTags: applied.tags })
  })

  it.each(['source=artist&sourceId=99', 'mediaType=all', 'readingStatus=all', 'likedOnly=false'])(
    'gives explicit URL %s priority without overwriting preferences',
    async (search) => {
      const view = mount()
      await applyFilters()
      view.unmount()
      mocks.feed.mockClear()
      const linked = mount(search)
      await waitFor(() => expect(mocks.feed).toHaveBeenCalled())
      expect(mocks.feed.mock.calls[0]?.[0]).toMatchObject({
        search: undefined,
        tagIds: [],
        sources: [],
        readingStatus: undefined,
        likedOnly: false
      })
      if (search.startsWith('source=')) {
        expect(mocks.feed.mock.calls[0]?.[0]).toMatchObject({ source: 'artist', artistId: 99 })
      }
      if (search.startsWith('mediaType=')) expect(mocks.feed.mock.calls[0]?.[0]).toMatchObject({ mediaType: 'all' })
      linked.unmount()
      mount()
      expect(mocks.sheet?.currentSearch).toBe(applied.search)
    }
  )

  it('persists clearing filters instead of reviving the previous selection', async () => {
    const view = mount()
    await applyFilters()
    await waitFor(() => expect(screen.getByRole('button', { name: '清空筛选' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }))
    await waitFor(() => expect(mocks.params.get('search')).toBeNull())
    view.unmount()
    await reloadStore()
    mount()
    expect(mocks.sheet).toMatchObject({
      currentSearch: '',
      currentMediaType: 'all',
      currentSortBy: 'random',
      currentReadingStatus: 'all',
      currentLikedOnly: false,
      currentArtist: [],
      currentTags: [],
      currentSources: [],
      currentHasAudio: 'all',
      currentMaxMediaCount: 8
    })
  })

  it('retains random sorting but starts a fresh random session on re-entry', async () => {
    const view = mount()
    await applyFilters({ ...applied, sortBy: 'random', randomSeed: 123 })
    view.unmount()
    await reloadStore()
    mocks.feed.mockClear()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.456)
    try {
      mount()
      await waitFor(() => expect(mocks.feed).toHaveBeenCalled())
      expect(mocks.feed.mock.calls[0]?.[0]).toMatchObject({
        mode: 'random',
        randomSeed: 456000,
        readingStatus: 'UNREAD',
        likedOnly: true
      })
    } finally {
      random.mockRestore()
    }
  })

  it.each([undefined, { readingStatus: 'invalid' }])(
    'keeps legacy preferences when saved filters are absent or invalid',
    async (filters) => {
      localStorage.setItem(
        'pixishelf-viewer-settings',
        JSON.stringify({ state: { mediaType: 'video', maxImageCount: 16, filters }, version: 0 })
      )
      await useViewerStore.persist.rehydrate()
      mount()
      expect(mocks.sheet).toMatchObject({
        currentMediaType: 'video',
        currentMaxMediaCount: 16,
        currentReadingStatus: 'all',
        currentSortBy: 'random'
      })
    }
  )
})
