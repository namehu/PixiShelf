import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, type Mock } from 'vitest'

export function registerDiscoveryIgnoredCases({
  renderSources,
  mocks,
  completeScan
}: {
  renderSources: (options?: { initialSourceId?: string | null; initialIgnored?: boolean }) => { refresh: () => void }
  completeScan: () => void
  mocks: {
    navigateIgnored: Mock
    ignoredQueryOptions: Mock
    restoreIgnoredItems: Mock
    navigateSource: Mock
    invalidateQueries: Mock
  }
}) {
  it('opens the current source ignored view with its own scope, total and global restore', async () => {
    renderSources()
    fireEvent.click(screen.getByRole('button', { name: '查看本来源已忽略' }))
    expect(mocks.navigateIgnored).toHaveBeenCalledWith(true, 'push', 'source-1')
    expect(screen.getByRole('heading', { name: '本来源已忽略' })).toBeTruthy()
    expect(screen.getByText(/共 101 条，已加载 1 条/)).toBeTruthy()
    expect(mocks.ignoredQueryOptions).toHaveBeenLastCalledWith(
      { sourceId: 'source-1', limit: 50 },
      expect.objectContaining({ enabled: true })
    )
    fireEvent.click(screen.getByRole('button', { name: '恢复 Ignored Gallery 301' }))
    await waitFor(() => expect(mocks.restoreIgnoredItems).toHaveBeenCalledWith({ ignoredItemIds: ['ignored-item-1'] }))
    fireEvent.click(screen.getByRole('button', { name: '返回来源详情' }))
    expect(screen.getByRole('button', { name: '查看本来源已忽略' })).toBeTruthy()
  })

  it('refreshes ignored membership after the active scan completes while the scoped view stays open', async () => {
    const rendered = renderSources({ initialSourceId: 'source-1', initialIgnored: true })
    expect(screen.getByRole('heading', { name: '本来源已忽略' })).toBeTruthy()
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['ignored-items-infinite'] })
    completeScan()
    rendered.refresh()
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ignored-items-infinite'] }))
    expect(mocks.ignoredQueryOptions).toHaveBeenLastCalledWith(
      { sourceId: 'source-1', limit: 50 },
      expect.objectContaining({ enabled: true })
    )
    expect(screen.getByRole('heading', { name: '本来源已忽略' })).toBeTruthy()
    mocks.invalidateQueries.mockClear()
    rendered.refresh()
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['ignored-items-infinite'] })
  })

  it('returns a scoped ignored deep link to its source without requiring navigation history', () => {
    renderSources({ initialSourceId: 'source-1', initialIgnored: true })
    fireEvent.click(screen.getByRole('button', { name: '返回来源详情' }))
    expect(mocks.navigateSource).toHaveBeenCalledWith('source-1', 'replace')
  })
}
