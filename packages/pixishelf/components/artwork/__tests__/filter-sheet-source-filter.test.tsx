import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterSheet } from '../filter-sheet'
import { ESource, OSource } from '@/enums/e-source'
import type { ReactNode } from 'react'

vi.mock('@/components/shared/s-sheet', () => ({
  SSheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  )
}))

vi.mock('@/components/shared/multiple-selector', () => ({
  default: ({ placeholder, onChange }: { placeholder?: string; onChange?: (options: typeof OSource) => void }) => (
    <button
      type="button"
      data-testid={placeholder === '选择创建类型...' ? 'source-selector' : undefined}
      onClick={() => onChange?.([OSource[0]!, OSource[1]!])}
    >
      {placeholder}
    </button>
  )
}))

vi.mock('@/components/shared/date-range-picker', () => ({
  DatePickerRange: () => <div />
}))

vi.mock('@/app/artworks/_components/search-box', () => ({
  SearchBox: ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => (
    <input aria-label="viewer-search" value={value} onChange={(event) => onValueChange(event.target.value)} />
  )
}))

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ onValueChange }: { onValueChange: (value: number[]) => void }) => (
    <button type="button" data-testid="max-media-slider" onClick={() => onValueChange([42])}>
      设置 42
    </button>
  )
}))

vi.mock('@/components/ui/sort-control', () => ({
  SortControl: () => <div />
}))

vi.mock('@/components/ui/media-type-filter', () => ({
  MediaTypeFilter: () => <div />
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange: (value: string) => void }) => (
    <div>
      <button type="button" data-testid="audio-filter" onClick={() => onValueChange('yes')}>
        选择有音频
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div />,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

afterEach(cleanup)

describe('FilterSheet artwork sources', () => {
  it('submits multiple selected artwork sources', async () => {
    const onApply = vi.fn()

    render(
      <FilterSheet
        open
        onOpenChange={vi.fn()}
        currentMediaType="all"
        currentSortBy="source_date_desc"
        currentSources={[]}
        onApply={onApply}
      />
    )

    await waitFor(() => expect(screen.getByTestId('source-selector')).toBeTruthy())
    fireEvent.click(screen.getByTestId('source-selector'))
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [ESource.PIXIV_IMPORTED, ESource.LOCAL_IMPORT]
      })
    )
  })

  it('submits the selected audio filter', () => {
    const onApply = vi.fn()

    render(
      <FilterSheet
        open
        onOpenChange={vi.fn()}
        currentMediaType="all"
        currentSortBy="source_date_desc"
        currentHasAudio="all"
        onApply={onApply}
      />
    )

    fireEvent.click(screen.getByTestId('audio-filter'))
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ hasAudio: 'yes' }))
  })

  it('submits viewer search and maximum media count, then resets to viewer defaults', () => {
    const onApply = vi.fn()

    render(
      <FilterSheet
        open
        onOpenChange={vi.fn()}
        currentSearch="old"
        currentMediaType="video"
        currentSortBy="source_date_desc"
        currentMaxMediaCount={8}
        resetSortBy="random"
        onApply={onApply}
      />
    )

    fireEvent.change(screen.getByLabelText('viewer-search'), { target: { value: 'miku' } })
    fireEvent.click(screen.getByTestId('max-media-slider'))
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'miku', maxMediaCount: 42, mediaType: 'video' })
    )

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, maxMediaCount: 8, sortBy: 'random', mediaType: 'all' })
    )
  })
})
