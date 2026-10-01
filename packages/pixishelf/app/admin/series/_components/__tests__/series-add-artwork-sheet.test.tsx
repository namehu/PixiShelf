import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SeriesAddArtworkSheet } from '../series-add-artwork-sheet'
const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artwork: {
      list: {
        queryOptions: (input: unknown, options: object) => ({
          ...options,
          queryKey: ['candidates', input],
          queryFn: () => mocks.list(input)
        })
      }
    }
  })
}))
vi.mock('@/components/creators/creator-picker', () => ({
  CreatorPicker: ({ onChange }: { onChange: (value: unknown[]) => void }) => (
    <button onClick={() => onChange([{ id: 17, name: '作者' }])}>选择作者</button>
  )
}))
vi.mock('../series-artwork-list', () => ({ Cover: () => null }))
describe('series candidate selection', () => {
  beforeEach(() => {
    mocks.list.mockImplementation(({ cursor }: { cursor: number }) =>
      Promise.resolve({
        items: Array.from({ length: 25 }, (_, i) => ({
          id: (cursor - 1) * 25 + i + 1,
          title: `作品 ${(cursor - 1) * 25 + i + 1}`,
          images: [],
          artist: null,
          imageCount: 1
        }))
      })
    )
  })
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })
  it('keeps selection across pages and filters and marks existing draft members unavailable', async () => {
    const add = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeriesAddArtworkSheet open onOpenChange={vi.fn()} existingIds={[2]} onAdd={add} />
      </QueryClientProvider>
    )
    await screen.findByText('作品 1')
    expect((screen.getByLabelText('添加 作品 2') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('添加 作品 1'))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品 26')
    fireEvent.click(screen.getByLabelText('添加 作品 26'))
    fireEvent.click(screen.getByText('选择作者'))
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1, artistId: 17 })))
    fireEvent.click(screen.getByRole('button', { name: '加入草稿 · 2 件' }))
    expect(add.mock.calls[0]![0].map((row: { id: number }) => row.id)).toEqual([1, 26])
  })
})
