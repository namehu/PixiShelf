import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

afterEach(cleanup)

describe('FilterSheet artwork sources', () => {
  it('keeps animation selection as a draft until applied and discards it on reopen', () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()
    const props = {
      currentMediaType: 'all' as const,
      currentSortBy: 'source_date_desc' as const,
      onApply,
      onOpenChange
    }
    const view = render(<FilterSheet {...props} open />)

    fireEvent.click(screen.getByRole('radio', { name: '动图' }))
    expect(onApply).not.toHaveBeenCalled()
    view.rerender(<FilterSheet {...props} open={false} />)
    view.rerender(<FilterSheet {...props} open />)
    expect(screen.getByRole('radio', { name: '全部' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: '动图' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ mediaType: 'animation' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('reveals active advanced filters on open and counts them', () => {
    render(
      <FilterSheet
        open
        currentMediaType="animation"
        currentSortBy="source_date_desc"
        currentHasAudio="yes"
        currentSources={[ESource.LOCAL_IMPORT]}
        currentReadingStatus="UNREAD"
        startDate="2026-09-01"
        onApply={vi.fn()}
        onOpenChange={vi.fn()}
      />
    )
    const trigger = screen.getByRole('button', { name: '更多筛选 · 2 项' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByRole('button', { name: '更多筛选' })).toBeTruthy()
  })

  it('submits multiple selected artwork sources', () => {
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

    expect(screen.getByRole('button', { name: '更多筛选' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Pixiv 导入' }))
    fireEvent.click(screen.getByRole('button', { name: '本地导入' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))

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

    expect(screen.getByRole('button', { name: '更多筛选' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('radio', { name: '有音频' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))

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
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'miku', maxMediaCount: 42, mediaType: 'video' })
    )

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, maxMediaCount: 8, sortBy: 'random', mediaType: 'all' })
    )
  })
})
