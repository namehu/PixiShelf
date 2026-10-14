import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { GalleryFilterSheet } from '../gallery-filter-sheet'
import { artworkQuerySnapshotSchema } from '@/schemas/artwork-quick-filter.dto'
const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setNavigation: vi.fn(),
  refresh: vi.fn(),
  error: ''
}))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: '1' }) }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/use-artwork-quick-filters', () => ({
  useArtworkQuickFilters: () => ({
    ...api,
    userId: '1',
    loading: false,
    busy: false,
    navigation: { revision: 1, ids: [] },
    items: [
      {
        id: '00000000-0000-4000-8000-000000000000',
        revision: 1,
        schemaVersion: 1,
        name: '已保存',
        query: artworkQuerySnapshotSchema.parse({ search: 'stored', readingStatus: 'UNREAD' }),
        createdAt: '2026-10-14T00:00:00.000Z',
        invalidReferences: []
      }
    ]
  })
}))
vi.mock('@/components/shared/s-sheet', () => ({
  SSheet: ({ children, headerExtra, footer }: { children: ReactNode; headerExtra: ReactNode; footer: ReactNode }) => (
    <div>
      {headerExtra}
      {children}
      {footer}
    </div>
  )
}))
vi.mock('@/components/shared/date-range-picker', () => ({ DatePickerRange: () => null }))
vi.mock('@/components/ui/sort-control', () => ({ SortControl: () => null }))
vi.mock('@/app/artworks/_components/search-box', () => ({
  SearchBox: ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => (
    <input aria-label="关键词" value={value} onChange={(e) => onValueChange(e.target.value)} />
  )
}))
const props = {
  open: true,
  currentSearch: 'original',
  currentMediaType: 'all' as const,
  currentSortBy: 'source_date_desc' as const,
  currentReadingStatus: 'all' as const,
  onApply: vi.fn(),
  onOpenChange: vi.fn(),
  onApplySnapshot: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  api.error = ''
  api.create.mockResolvedValue(true)
  api.update.mockResolvedValue(true)
})
afterEach(cleanup)
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
describe('gallery filter drafts', () => {
  it('preserves drafts across tabs and saves without applying', async () => {
    render(<GalleryFilterSheet {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: 'draft' } })
    tab('快捷筛选')
    tab('筛选条件')
    expect((screen.getByRole('textbox', { name: '关键词' }) as HTMLInputElement).value).toBe('draft')
    fireEvent.click(screen.getByRole('button', { name: '保存为快捷筛选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '快捷筛选名称' }), { target: { value: '我的筛选' } })
    fireEvent.click(screen.getByRole('button', { name: '保存快捷筛选' }))
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '我的筛选', pin: true, query: expect.objectContaining({ search: 'draft' }) })
      )
    )
    expect(props.onApply).not.toHaveBeenCalled()
    expect(props.onApplySnapshot).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })
  it('keeps failed saves and their input editable', async () => {
    api.create.mockResolvedValue(false)
    render(<GalleryFilterSheet {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '保存为快捷筛选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '快捷筛选名称' }), { target: { value: '保留草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存快捷筛选' }))
    await waitFor(() => expect(api.create).toHaveBeenCalled())
    expect((screen.getByRole('textbox', { name: '快捷筛选名称' }) as HTMLInputElement).value).toBe('保留草稿')
  })
  it('applies a saved row directly', () => {
    render(<GalleryFilterSheet {...props} initialTab="saved" />)
    fireEvent.click(screen.getByRole('button', { name: /已保存.*stored/ }))
    expect(props.onApplySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'stored', readingStatus: 'UNREAD' })
    )
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
  it('edits in isolation and restores the ordinary draft after saving', async () => {
    render(<GalleryFilterSheet {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: 'ordinary draft' } })
    tab('快捷筛选')
    fireEvent.keyDown(screen.getByRole('button', { name: '管理：已保存' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑条件' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 1, query: expect.objectContaining({ search: 'edited' }) })
      )
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '快捷筛选' }).getAttribute('aria-selected')).toBe('true')
    )
    tab('筛选条件')
    expect((screen.getByRole('textbox', { name: '关键词' }) as HTMLInputElement).value).toBe('ordinary draft')
    expect(props.onApply).not.toHaveBeenCalled()
  })
})
