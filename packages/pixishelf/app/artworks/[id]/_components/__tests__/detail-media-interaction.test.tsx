import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailMediaInteraction } from '../detail-media-interaction'
import { useArtworkAutoBrowseStore as auto } from '@/store/use-artwork-auto-browse-store'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

const mocks = vi.hoisted(() => ({
  owner: 'detail-alice',
  get: vi.fn(),
  set: vi.fn(),
  menu: vi.fn(),
  reduced: false,
  toast: vi.fn()
}))
vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: mocks.owner }),
  useAuthStore: { getState: () => ({ user: { id: mocks.owner } }), subscribe: () => () => {} }
}))
vi.mock('@/lib/trpc', () => {
  const client = {
    mediaMark: { getMany: { query: mocks.get }, set: { mutate: mocks.set }, remove: { mutate: vi.fn() } }
  }
  return { useTRPCClient: () => client }
})
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }))
vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => mocks.reduced
}))
const state = (id = 42, liked = false): MediaMarkStateDto => ({
  markId: liked ? 'mark' : null,
  artworkId: 7,
  mediaId: id,
  bookmarkedAt: null,
  likedAt: liked ? '2026-10-30T00:00:00Z' : null,
  available: true
})
let client: QueryClient
function content(id = 42) {
  return (
    <QueryClientProvider client={client}>
      <DetailMediaInteraction artworkId={7} mediaId={id} label={`图片 ${id}`} onMenu={mocks.menu}>
        <img alt="合成媒体" />
      </DetailMediaInteraction>
    </QueryClientProvider>
  )
}
function tap() {
  const target = screen.getByRole('img')
  fireEvent.mouseDown(target, { clientX: 100, clientY: 120 })
  fireEvent.mouseUp(target, { clientX: 100, clientY: 120 })
}
function doubleTap() {
  tap()
  tap()
}
const hearts = () => document.querySelectorAll('[data-floating-like-heart]')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner = 'detail-alice'
  mocks.reduced = false
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.get.mockImplementation(async ({ mediaIds }: { mediaIds: number[] }) => ({
    items: mediaIds.map((id) => state(id))
  }))
  mocks.set.mockImplementation(async ({ mediaId, value }: { mediaId: number; value: boolean }) => state(mediaId, value))
  auto.getState().initialize(7)
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
  auto.getState().stop()
})
async function ready() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '喜欢这张图片' }) as HTMLButtonElement).disabled).toBe(false)
  )
}

describe('detail likes use the shared media mark session', () => {
  it('clears a pending surface tap when the sibling heart cancels a like', async () => {
    mocks.get.mockResolvedValueOnce({ items: [state(42, true)] })
    render(content())
    await waitFor(() => expect(screen.getByRole('button', { name: '取消图片喜欢' })).toBeTruthy())
    tap()
    fireEvent.click(screen.getByRole('button', { name: '取消图片喜欢' }))
    tap()
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1))
    expect(mocks.set.mock.calls[0]![0].value).toBe(false)
    expect(hearts()).toHaveLength(0)
    expect(screen.getByRole('button', { name: '喜欢这张图片' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adds once, layers feedback for an already liked media, and pauses automatic browsing', async () => {
    render(content())
    await ready()
    auto.getState().start('scroll')
    doubleTap()
    expect(auto.getState().status).toBe('paused')
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1))
    expect(mocks.set).toHaveBeenCalledWith({
      artworkId: 7,
      mediaId: 42,
      kind: 'like',
      value: true,
      expectedUserId: 'detail-alice'
    })
    doubleTap()
    expect(hearts()).toHaveLength(2)
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '取消图片喜欢' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('uses the existing button toggle without floating hearts, including keyboard activation', async () => {
    render(content())
    await ready()
    auto.getState().start('slideshow')
    fireEvent.click(screen.getByRole('button', { name: '喜欢这张图片' }), { detail: 0 })
    expect(auto.getState().status).toBe('paused')
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '取消图片喜欢' }), { detail: 0 })
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(2))
    expect(hearts()).toHaveLength(0)
  })
  it('does not show success before mark readiness or when unavailable', async () => {
    let finish!: (data: { items: MediaMarkStateDto[] }) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(content())
    doubleTap()
    expect(hearts()).toHaveLength(0)
    await waitFor(() => expect(finish).toBeDefined())
    await act(async () => finish({ items: [{ ...state(), available: false }] }))
    doubleTap()
    expect(hearts()).toHaveLength(0)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('rolls a failed save back and retains the existing retry toast', async () => {
    mocks.set.mockRejectedValueOnce(new Error('fixture failure'))
    render(content())
    await ready()
    doubleTap()
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '喜欢这张图片' }).getAttribute('aria-pressed')).toBe('false')
  })
  it('cleans feedback after 800ms and on identity change, and reduces spatial motion', async () => {
    mocks.reduced = true
    const view = render(content())
    await ready()
    vi.useFakeTimers()
    doubleTap()
    expect(hearts()).toHaveLength(1)
    expect(hearts()[0]!.getAttribute('data-reduced-motion')).toBe('true')
    expect((hearts()[0] as HTMLElement).style.transform).not.toMatch(/scale|translate|rotate/)
    act(() => vi.advanceTimersByTime(800))
    expect(hearts()).toHaveLength(0)
    doubleTap()
    view.rerender(content(43))
    expect(hearts()).toHaveLength(0)
    view.unmount()
    act(() => vi.advanceTimersByTime(1000))
  })
  it('retains a like across a virtual unmount and isolates a new account', async () => {
    const view = render(content())
    await ready()
    doubleTap()
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1))
    view.unmount()
    const reopened = render(content())
    expect(screen.getByRole('button', { name: '取消图片喜欢' })).toBeTruthy()
    mocks.owner = 'detail-bob'
    reopened.rerender(content())
    await ready()
    expect(screen.getByRole('button', { name: '喜欢这张图片' }).getAttribute('aria-pressed')).toBe('false')
  })
})
