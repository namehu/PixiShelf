import { fireEvent, screen, within } from '@testing-library/react'
import { expect, it, type Mock } from 'vitest'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'

export function registerDiscoveryRowCases<
  T extends { id: string; title: string; artworkId: number | null; workflowStage: string }
>({
  navigateInboxItem,
  createSubmissionAttempt,
  deferItems,
  addToInbox,
  renderSources,
  getItem,
  setItems
}: {
  navigateInboxItem: Mock
  createSubmissionAttempt: Mock
  deferItems: Mock
  addToInbox: Mock
  renderSources: () => unknown
  getItem: () => T
  setItems: (items: T[]) => void
}) {
  it.each(['list', 'preview', 'cards'] as const)('selects all non-link row content exactly once in %s mode', (view) => {
    useAdminPreferencesStore.setState({ archiveUploaderResultView: view })
    renderSources()
    const checkbox = screen.getByRole('checkbox', { name: '选择 Gallery 302' })
    const row = checkbox.closest('[data-discovery-item]') as HTMLElement
    const content = [
      within(row).getByText('Gallery 302'),
      within(row).getByText('第 1 条'),
      within(row).getByText('新归档'),
      row,
      ...(view === 'list' ? [] : [row.querySelector('[data-discovery-thumbnail]')!])
    ]
    for (const target of content) {
      fireEvent.click(target)
      expect(checkbox.getAttribute('aria-checked')).toBe('true')
      fireEvent.click(target)
      expect(checkbox.getAttribute('aria-checked')).toBe('false')
    }
    fireEvent.keyDown(row, { key: ' ' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    const source = within(row).getByRole('link', { name: '打开原站 Gallery 302' })
    expect(source.textContent).toContain('原站')
    expect(source.getAttribute('target')).toBe('_blank')
    expect(source.getAttribute('href')).toBe('/api/archive/catalog/catalog-item-1/source')
    expect(within(row).getAllByRole('link')).toHaveLength(1)
    fireEvent.click(source)
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }))
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the local artwork link available alongside an actionable update', () => {
    const item = getItem()
    setItems([{ ...item, artworkId: 77, workflowStage: 'UPDATE_AVAILABLE' }])
    renderSources()
    const local = screen.getByRole('link', { name: '查看本地作品 Gallery 302' })
    expect(local.getAttribute('href')).toBe('/artworks/77')
    expect(local.textContent).toContain('本地作品')
    expect(local.getAttribute('target')).toBeNull()
    expect(screen.queryByRole('button', { name: '忽略 Gallery 302' })).toBeNull()
    fireEvent.click(local)
    expect(screen.getByRole('checkbox', { name: '选择 Gallery 302' }).getAttribute('aria-checked')).toBe('false')
  })

  it('applies the selection limit to the full row and still allows deselection', () => {
    const item = getItem()
    setItems(Array.from({ length: 101 }, (_, i) => ({ ...item, id: `item-${i}`, title: `Gallery ${i}` })))
    renderSources()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前已加载的结果，最多一百条' }))
    const extra = screen.getByRole('checkbox', { name: '选择 Gallery 100' })
    expect(within(extra.closest('[data-discovery-item]') as HTMLElement).getByText('第 101 条')).toBeTruthy()
    const extraSurface = extra.closest('[data-discovery-item]')!
    expect(extraSurface.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(extraSurface)
    expect(extra.getAttribute('aria-checked')).toBe('false')
    const first = screen.getByRole('checkbox', { name: '选择 Gallery 0' })
    fireEvent.click(first.closest('[data-discovery-item]')!)
    expect(extraSurface.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(extraSurface)
    expect(extra.getAttribute('aria-checked')).toBe('true')
  })
  it('defers only actionable selected galleries and reuses an unanswered request identity', () => {
    const item = getItem()
    setItems([item, { ...item, id: 'archived', title: 'Archived', actionable: false, workflowStage: 'ARCHIVED' }])
    renderSources()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Archived' }))
    fireEvent.click(screen.getByRole('button', { name: '稍后决定' }))
    expect(deferItems).toHaveBeenCalledWith({
      sourceId: 'source-1',
      itemIds: ['catalog-item-1'],
      requestId: expect.any(String)
    })
    fireEvent.click(screen.getByRole('button', { name: '稍后决定' }))
    expect(deferItems.mock.calls[1]).toEqual(deferItems.mock.calls[0])
    expect(addToInbox).not.toHaveBeenCalled()
  })
  it('moves attention navigation to the selected bar and offers it only for one item', () => {
    const item = {
      ...getItem(),
      actionable: false,
      workflowBucket: 'ATTENTION',
      intakeItemId: 'intake-1'
    }
    setItems([item, { ...item, id: 'other', title: 'Other', intakeItemId: 'intake-2' }])
    renderSources()
    expect(screen.queryByRole('button', { name: '去收件箱处理' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.click(screen.getByRole('button', { name: '去收件箱处理' }))
    expect(navigateInboxItem).toHaveBeenCalledWith('intake-1')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Other' }))
    expect(screen.queryByRole('button', { name: '去收件箱处理' })).toBeNull()
    expect(createSubmissionAttempt).not.toHaveBeenCalled()
  })

  it('preserves explicit single-item rearchive without adding deleted items to ordinary bulk intake', () => {
    const item = {
      ...getItem(),
      actionable: false,
      recoverable: false,
      canRearchive: true,
      workflowStage: 'DELETED'
    }
    setItems([item, { ...item, id: 'other', title: 'Other' }])
    renderSources()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    expect((screen.getByRole('button', { name: '加入收件箱' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Other' }))
    expect(screen.queryByRole('button', { name: '重新归档' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Other' }))
    fireEvent.click(screen.getByRole('button', { name: '重新归档' }))
    expect(createSubmissionAttempt).toHaveBeenCalledWith(expect.objectContaining({ itemIds: [item.id] }))
  })
  it('opens the original source independently from the stored cover popup', () => {
    renderSources()

    fireEvent.click(screen.getByRole('link', { name: '打开原站 Gallery 302' }))
    const sourceLink = screen.getByRole('link', { name: '打开原站 Gallery 302' })
    expect(sourceLink.getAttribute('href')).toBe('/api/archive/catalog/catalog-item-1/source')
    expect(sourceLink.getAttribute('target')).toBe('_blank')
    expect(sourceLink.getAttribute('rel')).toBe('noopener noreferrer')
    expect(sourceLink.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
}
