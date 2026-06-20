import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilterSheet } from '../filter-sheet'
import { ESource, OSource } from '@/enums/ESource'
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

vi.mock('@/components/ui/SortControl', () => ({
  SortControl: () => <div />
}))

vi.mock('@/components/ui/MediaTypeFilter', () => ({
  MediaTypeFilter: () => <div />
}))

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
})
