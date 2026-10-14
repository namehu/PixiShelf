import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

export function registerDiscoveryRowCases<
  T extends { id: string; title: string; artworkId: number | null; workflowStage: string }
>({
  renderSources,
  getItem,
  setItems
}: {
  renderSources: () => unknown
  getItem: () => T
  setItems: (items: T[]) => void
}) {
  it('toggles the row selection without hijacking title links, preview actions or the checkbox', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '原站预览 Gallery 302' }))
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
}
