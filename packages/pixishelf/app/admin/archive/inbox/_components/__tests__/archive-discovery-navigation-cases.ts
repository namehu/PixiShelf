import { fireEvent, screen } from '@testing-library/react'
import { it, expect } from 'vitest'
import { source, completedRun } from './archive-uploader-sources-fixtures'

export function registerDiscoveryNavigationCases({
  renderSources,
  setSources,
  navigateSource,
  infiniteQueryOptions
}: {
  renderSources: (options?: { initialSourceId?: string | null }) => unknown
  setSources: (sources: unknown[]) => void
  navigateSource: unknown
  infiniteQueryOptions: unknown
}) {
  it('shows only the full-width list on desktop until a source is explicitly opened', () => {
    renderSources({ initialSourceId: null })
    expect(screen.getByRole('searchbox', { name: '搜索来源' })).toBeTruthy()
    expect(screen.queryByText('Gallery 302')).toBeNull()
    expect(screen.queryByRole('button', { name: '返回来源列表' })).toBeNull()
    expect(navigateSource).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByText('UID 123')[0]!.closest('button')!)
    expect(screen.getByText('Gallery 302')).toBeTruthy()
    expect(screen.queryByRole('searchbox', { name: '搜索来源' })).toBeNull()
  })

  it('preserves source filtering, page and scroll position across detail navigation', () => {
    setSources(
      Array.from({ length: 65 }, (_, index) => ({
        ...source,
        id: `source-${index + 1}`,
        displayName: `Saved ${index + 1}`,
        latestRun: completedRun
      }))
    )
    renderSources({ initialSourceId: null })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索来源' }), { target: { value: 'Saved' } })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('第 2 / 2 页 · 每页 50 条')).toBeTruthy()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 320 })
    fireEvent.scroll(window)
    fireEvent.click(screen.getByText('Saved 51').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '返回来源列表' }))
    expect((screen.getByRole('searchbox', { name: '搜索来源' }) as HTMLInputElement).value).toBe('Saved')
    expect(screen.getByText('第 2 / 2 页 · 每页 50 条')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 320 })
    expect(document.activeElement?.getAttribute('data-source-id')).toBe('source-51')
  })

  it('clears selection when result status or title criteria change', () => {
    renderSources()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.click(screen.getByLabelText('查看全部'))
    expect(screen.getByRole('checkbox', { name: '选择 Gallery 302' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索内容标题' }), { target: { value: 'Gallery' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索内容' }))
    expect(screen.getByRole('checkbox', { name: '选择 Gallery 302' }).getAttribute('aria-checked')).toBe('false')
    expect(infiniteQueryOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ search: 'Gallery' }) }),
      expect.anything()
    )
  })
}
