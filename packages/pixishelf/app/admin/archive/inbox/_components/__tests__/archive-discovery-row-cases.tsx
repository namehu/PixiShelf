import { fireEvent, screen, within } from '@testing-library/react'
import { expect, it, type Mock } from 'vitest'

export function registerDiscoveryRowCases<
  T extends { id: string; title: string; artworkId: number | null; workflowStage: string }
>({
  deferItems,
  addToInbox,
  renderSources,
  getItem,
  setItems
}: {
  deferItems: Mock
  addToInbox: Mock
  renderSources: () => unknown
  getItem: () => T
  setItems: (items: T[]) => void
}) {
  it('toggles the row selection without hijacking title links, source actions or the checkbox', () => {
    renderSources()
    const checkbox = screen.getByRole('checkbox', { name: '选择 Gallery 302' })
    const row = checkbox.closest('[data-discovery-item]')!
    const surface = row.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!
    fireEvent.click(surface)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(surface)
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    const title = screen.getByRole('link', { name: 'Gallery 302' })
    expect(title.getAttribute('target')).toBe('_blank')
    expect(title.getAttribute('href')).toBe('/api/archive/catalog/catalog-item-1/source')
    fireEvent.click(title)
    fireEvent.click(screen.getByRole('link', { name: '打开原站 Gallery 302' }))
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
    expect(screen.getByRole('button', { name: '忽略 Gallery 302' })).toBeTruthy()
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
    const extraSurface = extra
      .closest('[data-discovery-item]')!
      .querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!
    expect(extraSurface.disabled).toBe(true)
    const first = screen.getByRole('checkbox', { name: '选择 Gallery 0' })
    fireEvent.click(first.closest('[data-discovery-item]')!.querySelector('button[aria-hidden="true"]')!)
    expect(extraSurface.disabled).toBe(false)
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
}
