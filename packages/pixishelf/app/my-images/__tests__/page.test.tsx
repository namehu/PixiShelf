import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyImagesPage from '../page'
import type { MediaMarkListItemDto } from '@/schemas/media-mark.dto'

const mocks = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), sharedRemove: vi.fn() }))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: 'alice' }), useAuthStore: { getState: () => ({ user: { id: 'alice' } }) } }))
vi.mock('@/lib/trpc', () => ({ useTRPCClient: () => ({ mediaMark: { list: { query: mocks.list }, remove: { mutate: mocks.remove } } }) }))
vi.mock('@/hooks/use-media-mark', () => ({ useMediaMark: () => ({ isSaving: false, remove: mocks.sharedRemove }) }))
vi.mock('@/components/layout/page-toolbar', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@/components/layout/page-container', () => ({ PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/media/media-thumbnail', () => ({ default: ({ media }: { media: { path: string } }) => <div data-testid="thumbnail" data-path={media.path} /> }))

const valid = {
  id: 'mark-1', artworkId: 7, mediaId: 42, artworkTitle: '测试作品', mediaPosition: 3,
  mediaType: 'image', media: { id: 42, path: '/selected-image.jpg' }, bookmarkedAt: '2026-10-22T12:00:00.000Z', likedAt: null, unavailableReason: null
} as MediaMarkListItemDto
let client: QueryClient
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MyImagesPage /></QueryClientProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.remove.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); client?.clear() })

describe('my images', () => {
  it('links the selected media, preserves private text marking and removes through shared state', async () => {
    mocks.list.mockResolvedValue({ items: [valid], total: 1, page: 1, pageSize: 24 })
    mount()
    const link = await screen.findByRole('link', { name: '查看测试作品的第 3 张图片' })
    expect(link.getAttribute('href')).toBe('/artworks/7?mediaId=42')
    expect(screen.getByTestId('thumbnail').getAttribute('data-path')).toBe('/selected-image.jpg')
    expect(screen.getByRole('heading', { name: '测试作品' }).hasAttribute('data-privacy-sensitive')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '移除书签：测试作品，第 3 张' }))
    expect(mocks.sharedRemove).toHaveBeenCalledWith('bookmark', 'mark-1')
    expect(mocks.list.mock.calls[0]?.[0]).toMatchObject({ kind: 'bookmark', page: 1, expectedUserId: 'alice' })
  })

  it('retains unavailable placeholders without stale media requests and supports removing them', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...valid, mediaId: null, media: null, unavailableReason: 'deleted' }], total: 1, page: 1, pageSize: 24 })
    mount()
    expect(await screen.findByText('原媒体已失效')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByTestId('thumbnail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '移除书签：测试作品，第 3 张' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ markId: 'mark-1', kind: 'bookmark', expectedUserId: 'alice' }))
  })

  it('provides empty and retry states', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 24 })
    mount()
    expect(await screen.findByText('图片标记加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('还没有图片书签')).toBeTruthy()
  })
})
