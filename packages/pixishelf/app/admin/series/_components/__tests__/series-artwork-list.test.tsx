import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SeriesArtworkList } from '../series-artwork-list'
import type { SeriesArtworkRow } from '@/schemas/series-management'
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }))
const rows: SeriesArtworkRow[] = Array.from({ length: 2000 }, (_, i) => ({
  id: i + 1,
  title: `作品 ${i + 1}`,
  thumbnailUrl: null,
  author: '作者',
  mediaCount: 2,
  sortOrder: i + 1,
  provenance: 'MANUAL',
  orderOverridden: false
}))
describe('virtual series artwork list', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640)
    HTMLElement.prototype.scrollTo = vi.fn()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('mounts fewer than 30 rows for 2,000 items and renders the end after a deep scroll', async () => {
    render(
      <SeriesArtworkList
        rows={rows}
        fullIds={rows.map((r) => r.id)}
        selected={new Set()}
        disabled={false}
        sortingDisabled={false}
        onSelect={vi.fn()}
        onOrder={vi.fn()}
        onRemove={vi.fn()}
        onPosition={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    const scroll = screen.getByLabelText('系列作品列表')
    scroll.scrollTop = 159360
    fireEvent.scroll(scroll)
    await waitFor(() => expect(screen.getByText('作品 2000')).toBeTruthy())
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    expect(screen.getByText('作品 2000').closest('[role=listitem]')?.getAttribute('aria-posinset')).toBe('2000')
  })
  it('disables drag handles while filtered and keeps selection available', async () => {
    const select = vi.fn()
    render(
      <SeriesArtworkList
        rows={rows.slice(0, 2)}
        fullIds={rows.map((r) => r.id)}
        selected={new Set()}
        disabled={false}
        sortingDisabled
        onSelect={select}
        onOrder={vi.fn()}
        onRemove={vi.fn()}
        onPosition={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '拖动 作品 1 调整顺序' })).toBeTruthy())
    expect((screen.getByRole('button', { name: '拖动 作品 1 调整顺序' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 作品 1' }))
    expect(select).toHaveBeenCalledWith(1, true)
  })
})
