import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ArchiveDiscoveryResultList } from '../archive-discovery-result-list'

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  width: 700,
  resize: () => {},
  rangeChanged: (_range: { startIndex: number; endIndex: number }) => {
    void _range
  },
  scrollTop: 0
}))
vi.mock('react-virtuoso', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    Virtuoso: forwardRef(function TestList(
      {
        data,
        itemContent,
        endReached,
        useWindowScroll,
        rangeChanged
      }: {
        data: Array<{ id: string; items: Array<{ id: string }> }>
        itemContent: (index: number, row: { id: string; items: Array<{ id: string }> }) => ReactNode
        endReached: () => void
        useWindowScroll: boolean
        rangeChanged: (range: { startIndex: number; endIndex: number }) => void
      },
      ref
    ) {
      mocks.rangeChanged = rangeChanged
      useImperativeHandle(ref, () => ({ scrollToIndex: mocks.scrollToIndex, scrollTo: vi.fn() }))
      return (
        <div data-testid="rows" data-window-scroll={String(useWindowScroll)}>
          {data.map((row, index) => (
            <div key={row.id} data-testid="row" data-item-index={index}>
              {itemContent(index, row)}
            </div>
          ))}
          <button onClick={endReached}>加载下一页</button>
        </div>
      )
    })
  }
})

const items = Array.from({ length: 7 }, (_, index) => ({ id: `item-${index}` }))
const props = {
  items,
  view: 'cards' as const,
  isDesktop: true,
  layoutReady: true,
  isLoading: false,
  isError: false,
  errorTitle: '错误',
  errorDescription: '重试',
  emptyState: '空',
  header: '作品',
  renderItem: (item: { id: string }) => <span>{item.id}</span>,
  hasNextPage: true,
  isFetchingNextPage: false,
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
  positionKey: 'source-1',
  onPositionChange: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  mocks.width = 700
  mocks.scrollTop = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.dataset.itemIndex
    const top = index === undefined ? 0 : Number(index) * 300 - mocks.scrollTop
    const height = index === undefined ? 600 : 300
    return {
      width: mocks.width,
      height,
      top,
      bottom: top + height,
      left: 0,
      right: mocks.width,
      x: 0,
      y: top,
      toJSON: () => ({})
    }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        mocks.resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('discovery card rows', () => {
  it('uses the container width for two and three columns, with one column on mobile', () => {
    const result = render(<ArchiveDiscoveryResultList {...props} />)
    expect(screen.getAllByTestId('row')).toHaveLength(4)
    expect(screen.getAllByTestId('row')[0]?.textContent).toBe('item-0item-1')
    act(() => {
      mocks.width = 1000
      mocks.resize()
    })
    expect(screen.getAllByTestId('row')).toHaveLength(3)
    expect(screen.getAllByTestId('row')[0]?.textContent).toBe('item-0item-1item-2')
    act(() => {
      mocks.width = 500
      mocks.resize()
    })
    expect(screen.getAllByTestId('row')).toHaveLength(7)
    result.rerender(<ArchiveDiscoveryResultList {...props} isDesktop={false} />)
    expect(screen.getAllByTestId('row')).toHaveLength(7)
    expect(screen.getByTestId('rows').getAttribute('data-window-scroll')).toBe('true')
  })

  it('restores a saved artwork to its row when the column count changes', async () => {
    render(
      <ArchiveDiscoveryResultList
        {...props}
        position={{ anchorId: 'item-4', anchorOffset: -20, scrollTop: 800, windowScrollY: 0 }}
      />
    )
    await waitFor(() => expect(mocks.scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'start', offset: 20 }))
    act(() => {
      mocks.width = 1000
      mocks.resize()
    })
    await waitFor(() => expect(mocks.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', offset: 20 }))
  })

  it('preserves the captured artwork even if resize has already reset the row geometry', async () => {
    render(<ArchiveDiscoveryResultList {...props} />)
    mocks.scrollTop = 600
    await waitFor(() => {
      // Layout restoration can outlast a fixed delay when the full suite is busy.
      act(() => mocks.rangeChanged({ startIndex: 0, endIndex: 3 }))
      expect(props.onPositionChange).toHaveBeenCalledWith(expect.objectContaining({ anchorId: 'item-4' }))
    })
    mocks.scrollToIndex.mockClear()
    act(() => {
      mocks.scrollTop = 0
      mocks.width = 1000
      mocks.resize()
    })
    await waitFor(() => expect(mocks.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', offset: -0 }))
  })

  it('requests the next page once until new items arrive, including after a layout switch', () => {
    const result = render(<ArchiveDiscoveryResultList {...props} />)
    fireEvent.click(screen.getByText('加载下一页'))
    fireEvent.click(screen.getByText('加载下一页'))
    result.rerender(<ArchiveDiscoveryResultList {...props} view="preview" />)
    fireEvent.click(screen.getByText('加载下一页'))
    expect(props.onLoadMore).toHaveBeenCalledTimes(1)
    result.rerender(<ArchiveDiscoveryResultList {...props} items={[...items, { id: 'item-7' }]} />)
    fireEvent.click(screen.getByText('加载下一页'))
    expect(props.onLoadMore).toHaveBeenCalledTimes(2)
  })
})
