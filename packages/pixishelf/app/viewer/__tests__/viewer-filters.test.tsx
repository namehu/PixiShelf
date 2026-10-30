import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ViewerPage from '../page'
import { useViewerStore } from '@/store/viewer-store'
import type { FilterSheetProps } from '@/components/artwork/filter-sheet'

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  owner: 'viewer-user',
  feed: vi.fn(),
  sheet: null as FilterSheetProps | null
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }))
vi.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => vi.fn() }))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: mocks.owner }) }))
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
  mocks.owner = 'viewer-user'
})
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients = []
})
function mount(search = '', options: { client?: QueryClient; returning?: boolean } = {}) {
  if (!options.returning) window.history.pushState({ __NA: true }, '', `/viewer?${search}`)
  mocks.params = new URLSearchParams(search)
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (!options.client) clients.push(client)
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
  it.each([
    ['ordered', '/artworks/2'],
    ['random', '/artists/12']
  ])('restores the %s feed and both swiper positions after returning from %s', async (mode, destination) => {
    const search = `mode=${mode}&mediaType=video&likedOnly=true`
    mocks.feed
      .mockResolvedValueOnce({
        items: [{ id: 1, key: 'one', images: [] }],
        nextReadingCursor: 'ordered-next',
        nextRandomCursor: 'random-next'
      })
      .mockResolvedValue({ items: [{ id: 2, key: 'two', images: [] }], nextPage: null })
    const view = mount(search)
    const client = clients[0]!
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(useViewerStore.getState().images).toHaveLength(2))
    act(() => {
      useViewerStore.getState().setVerticalIndex(1)
      useViewerStore.getState().setHorizontalIndex('two', 2)
    })
    const originalSeed = mocks.sheet?.randomSeed
    expect(window.history.state.__NA).toBe(true)
    expect(window.history.state.__pixishelf_viewer_navigation__.verticalIndex).toBe(1)
    window.history.pushState({}, '', destination)
    view.unmount()
    // A status update can make the feed stale while the detail page is open.
    await client.invalidateQueries({ refetchType: 'none' })
    useViewerStore.getState().resetViewerState()
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      window.history.back()
    })
    expect(window.history.state.__pixishelf_viewer_navigation__.verticalIndex).toBe(1)
    mount(search, { client, returning: true })
    await screen.findByRole('button', { name: '加载更多' })
    expect(useViewerStore.getState()).toMatchObject({ verticalIndex: 1, horizontalIndexes: { two: 2 } })
    expect(useViewerStore.getState().images.map((item) => item.id)).toEqual([1, 2])
    expect(mocks.sheet?.randomSeed).toBe(originalSeed)
    expect(mocks.feed).toHaveBeenCalledTimes(2)
  })

  it('starts at the first item on a fresh navigation, even with the same filters and query client', async () => {
    mocks.feed.mockResolvedValue({
      items: [
        { id: 1, key: 'one', images: [] },
        { id: 2, key: 'two', images: [] }
      ],
      nextPage: null
    })
    const view = mount('mode=ordered')
    const client = clients[0]!
    await screen.findByRole('button', { name: '加载更多' })
    act(() => {
      useViewerStore.getState().setVerticalIndex(1)
      useViewerStore.getState().setHorizontalIndex('two', 2)
    })
    view.unmount()
    mount('mode=ordered', { client })
    await screen.findByRole('button', { name: '加载更多' })
    expect(useViewerStore.getState()).toMatchObject({ verticalIndex: 0, horizontalIndexes: {} })
    expect(mocks.feed).toHaveBeenCalledTimes(2)
  })

  it.each(['filters', 'account'])('resets both swiper positions when %s change', async (change) => {
    mocks.feed.mockResolvedValue({
      items: [
        { id: 1, key: 'one', images: [] },
        { id: 2, key: 'two', images: [] }
      ],
      nextPage: null
    })
    const view = mount('mode=ordered')
    await screen.findByRole('button', { name: '加载更多' })
    act(() => {
      useViewerStore.getState().setVerticalIndex(1)
      useViewerStore.getState().setHorizontalIndex('two', 2)
    })
    if (change === 'filters') {
      await applyFilters()
    } else {
      view.unmount()
      mocks.owner = 'another-user'
      mount('mode=ordered', { client: clients[0], returning: true })
    }
    await waitFor(() => expect(useViewerStore.getState()).toMatchObject({ verticalIndex: 0, horizontalIndexes: {} }))
    await screen.findByRole('button', { name: '加载更多' })
    expect(mocks.feed.mock.calls.at(-1)?.[0].expectedUserId).toBe(mocks.owner)
  })

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
      ratingLevels: [2, 3, 4],
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
      ratingLevels: [2, 3, 4],
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
        ratingLevels: []
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
      currentRatingLevels: [],
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
        ratingLevels: [2, 3, 4]
      })
    } finally {
      random.mockRestore()
    }
  })

  it('requeries when the same ordered filters are explicitly reapplied', async () => {
    mount('mode=ordered')
    await applyFilters()
    await waitFor(() => expect(mocks.params.get('listRevision')).toBe('1'))
    const calls = mocks.feed.mock.calls.length
    await applyFilters()
    await waitFor(() => expect(mocks.params.get('listRevision')).toBe('2'))
    await waitFor(() => expect(mocks.feed.mock.calls.length).toBeGreaterThan(calls))
  })

  it('locks artist-detail scope through apply and clear without overwriting global preferences', async () => {
    const initial = mount()
    await applyFilters()
    initial.unmount()
    const preferences = localStorage.getItem('pixishelf-viewer-settings')
    mount('source=artist&sourceId=99&scopeArtistId=99&artistLabel=Fixed&excludeArtistIds=99&ratingLevels=4')
    await screen.findByText('当前艺术家已被排除，因此没有符合条件的作品。可调整排除艺术家条件。')
    expect(mocks.sheet?.fixedArtist).toEqual({ value: '99', label: 'Fixed' })
    await applyFilters({ ...applied, ratingLevels: [2, 4], excludedArtists: [{ value: '7', label: 'Other' }] })
    await waitFor(() => expect(mocks.params.get('excludeArtistIds')).toBe('7'))
    expect(mocks.params.get('artistId')).toBe('99')
    expect(mocks.params.get('scopeArtistId')).toBe('99')
    expect(mocks.feed.mock.calls.at(-1)?.[0]).toMatchObject({
      artistId: 99,
      ratingLevels: [2, 4],
      excludeArtistIds: [7]
    })
    expect(localStorage.getItem('pixishelf-viewer-settings')).toBe(preferences)
    fireEvent.click(await screen.findByRole('button', { name: '清空筛选' }))
    await waitFor(() => expect(mocks.params.get('excludeArtistIds')).toBeNull())
    expect(mocks.params.get('artistId')).toBe('99')
    expect(mocks.sheet?.fixedArtist?.value).toBe('99')
    expect(localStorage.getItem('pixishelf-viewer-settings')).toBe(preferences)
  })

  it('allows a global artist-filtered entry to switch artist and clear its scope', async () => {
    mount('source=artist&sourceId=99')
    expect(mocks.sheet?.fixedArtist).toBeUndefined()
    await applyFilters()
    expect(mocks.params.get('artistId')).toBe('12')
    fireEvent.click(await screen.findByRole('button', { name: '清空筛选' }))
    await waitFor(() => expect(mocks.params.get('artistId')).toBeNull())
    expect(mocks.params.get('scopeArtistId')).toBeNull()
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
