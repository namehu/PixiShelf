import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingHistoryItem } from '@/services/reading-service'
import ContinueReadingSection from '../continue-reading-section'

const state = vi.hoisted(() => ({
  owner: 'alice' as string | null,
  displayMode: 'card' as 'card' | 'minimal',
  query: vi.fn()
}))

vi.mock('@/components/auth', () => ({ useAuthUser: () => state.owner ? { id: state.owner } : null }))
vi.mock('@/components/user-setting', () => ({
  useArtworkDisplayMode: () => state.displayMode,
  usePreferredTags: () => []
}))
vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({ reading: { continueReading: { query: state.query } } })
}))
vi.mock('@/components/media/media-thumbnail', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />
}))

function item(id: number, title = `作品 ${id}`): ReadingHistoryItem {
  return {
    artwork: { id, title, imageCount: 3, images: [], artist: { name: '艺术家' }, tags: [] },
    reading: {
      artworkId: id, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 3,
      status: 'IN_PROGRESS', lastViewedAt: '2026-10-22T00:00:00.000Z', lastActiveAt: null,
      lastMediaId: id * 10, lastMediaIndex: 1
    }
  }
}

const clients: QueryClient[] = []

function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  clients.push(client)
  const ui = <QueryClientProvider client={client}><ContinueReadingSection /></QueryClientProvider>
  return { ...render(ui), client, ui }
}

beforeEach(() => {
  state.owner = 'alice'
  state.displayMode = 'card'
  state.query.mockReset()
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

describe('dashboard continue reading', () => {
  it('renders recent artworks with explicit resume links and existing private card metadata', async () => {
    state.query.mockResolvedValue({ items: [item(7), item(5)] })
    setup()

    await screen.findByRole('list', { name: '继续阅读作品' })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/artworks/7?resume=1', '/artworks/5?resume=1'
    ])
    expect(screen.getByRole('heading', { name: '作品 7' }).hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getAllByRole('link')[0]?.querySelector('[data-slot="reading-marker"]')).toBeTruthy()
    expect(screen.queryByText('1/3')).toBeNull()
    expect(state.query).toHaveBeenCalledWith({ expectedUserId: 'alice' }, { signal: expect.any(AbortSignal) })
  })

  it('keeps the shelf hidden when no candidate exists', async () => {
    state.query.mockResolvedValue({ items: [] })
    const view = setup()

    await waitFor(() => expect(state.query).toHaveBeenCalledOnce())
    await waitFor(() => expect(view.container.textContent).toBe(''))
  })

  it('does not request or show account data without a signed-in account', () => {
    state.owner = null
    const view = setup()

    expect(view.container.textContent).toBe('')
    expect(state.query).not.toHaveBeenCalled()
  })

  it('shows a loading status until the account query completes', async () => {
    let resolve!: (result: { items: ReadingHistoryItem[] }) => void
    state.query.mockReturnValue(new Promise((done) => { resolve = done }))
    const view = setup()

    expect(screen.getByRole('status', { name: '正在加载继续阅读' })).toBeTruthy()
    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(18)
    await act(async () => { resolve({ items: [item(7)] }) })
    await screen.findByRole('link', { name: '查看作品：作品 7' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('recovers from a failed request using the local retry action', async () => {
    state.query.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [item(7)] })
    setup()

    await screen.findByRole('heading', { name: '继续阅读加载失败' })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('link', { name: '查看作品：作品 7' })
    expect(state.query).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('heading', { name: '继续阅读加载失败' })).toBeNull()
  })

  it('cancels the old account request and never displays its late result after switching accounts', async () => {
    let resolveAlice!: (result: { items: ReadingHistoryItem[] }) => void
    let resolveBob!: (result: { items: ReadingHistoryItem[] }) => void
    state.query.mockImplementation(({ expectedUserId }: { expectedUserId: string }) => new Promise((resolve) => {
      if (expectedUserId === 'alice') resolveAlice = resolve
      else resolveBob = resolve
    }))
    const view = setup()
    const aliceSignal = state.query.mock.calls[0]![1].signal as AbortSignal

    state.owner = 'bob'
    view.rerender(<QueryClientProvider client={view.client}><ContinueReadingSection /></QueryClientProvider>)
    expect(aliceSignal.aborted).toBe(true)
    await act(async () => { resolveAlice({ items: [item(7, 'Alice 的作品')] }) })
    expect(screen.queryByRole('link', { name: '查看作品：Alice 的作品' })).toBeNull()
    await act(async () => { resolveBob({ items: [item(8, 'Bob 的作品')] }) })
    await screen.findByRole('link', { name: '查看作品：Bob 的作品' })
    expect(screen.queryByRole('link', { name: '查看作品：Alice 的作品' })).toBeNull()
    expect(state.query).toHaveBeenLastCalledWith({ expectedUserId: 'bob' }, { signal: expect.any(AbortSignal) })
  })

  it('refreshes on returning to the dashboard even when the client normally keeps fresh cached data', async () => {
    state.query.mockResolvedValueOnce({ items: [item(7)] }).mockResolvedValueOnce({ items: [] })
    const first = setup()
    await screen.findByRole('link', { name: '查看作品：作品 7' })
    first.unmount()
    const second = setup(first.client)

    await waitFor(() => expect(state.query).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(second.container.textContent).toBe(''))
  })

  it('preserves image-only cards when the account prefers minimal display', async () => {
    state.displayMode = 'minimal'
    state.query.mockResolvedValue({ items: [item(7)] })
    setup()

    await screen.findByRole('link', { name: '查看作品：作品 7' })
    expect(screen.queryByRole('heading', { name: '作品 7' })).toBeNull()
    expect(screen.queryByText('艺术家')).toBeNull()
  })
})
