import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ArchiveInboxWorkspace } from '../archive-inbox-workspace'
import { SOURCE_SORT_VALUES, type SourceListSort } from '../archive-discovery-filter-state'

vi.mock('../archive-delete-failed-dialog', () => ({
  ArchiveDeleteFailedResultProvider: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('../archive-inbox', () => ({ ArchiveInbox: () => <div>收件内容</div> }))
vi.mock('../archive-uploader-sources', () => ({
  ArchiveUploaderSources: ({
    active,
    sourceSort,
    onSourceSortChange,
    onNavigateSource,
    onNavigateSourceList
  }: {
    active: boolean
    sourceSort: SourceListSort
    onSourceSortChange: (sort: SourceListSort) => void
    onNavigateSource: (id: string, history: 'push') => void
    onNavigateSourceList: (history: 'push') => void
  }) =>
    active ? (
      <div>
        来源内容
        <select
          aria-label="来源排序"
          value={sourceSort}
          onChange={(event) => onSourceSortChange(event.target.value as SourceListSort)}
        >
          {SOURCE_SORT_VALUES.map((sort) => (
            <option key={sort} value={sort}>
              {sort}
            </option>
          ))}
        </select>
        <button onClick={() => onNavigateSource('source-1', 'push')}>查看来源</button>
        <button onClick={() => onNavigateSourceList('push')}>返回来源列表</button>
      </div>
    ) : null
}))
afterEach(cleanup)

describe('archive workspace tab navigation', () => {
  it('restores sorting from the URL and keeps it through detail navigation', async () => {
    const onUrlUpdate = vi.fn()
    render(
      <NuqsTestingAdapter hasMemory searchParams="?sourceSort=name-desc" onUrlUpdate={onUrlUpdate}>
        <ArchiveInboxWorkspace />
      </NuqsTestingAdapter>
    )
    expect((screen.getByRole('combobox', { name: '来源排序' }) as HTMLSelectElement).value).toBe('name-desc')
    fireEvent.change(screen.getByRole('combobox', { name: '来源排序' }), { target: { value: 'actionable-desc' } })
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sourceSort')).toBe('actionable-desc')
    )
    fireEvent.click(screen.getByRole('button', { name: '查看来源' }))
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sourceId')).toBe('source-1'))
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sourceSort')).toBe('actionable-desc')
    fireEvent.click(screen.getByRole('button', { name: '返回来源列表' }))
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('sourceId')).toBe(false))
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sourceSort')).toBe('actionable-desc')
    fireEvent.change(screen.getByRole('combobox', { name: '来源排序' }), { target: { value: 'created-desc' } })
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('sourceSort')).toBe(false))
  })

  it('falls back to newest creation for an invalid sort in the URL', () => {
    render(
      <NuqsTestingAdapter searchParams="?sourceSort=invalid">
        <ArchiveInboxWorkspace />
      </NuqsTestingAdapter>
    )
    expect((screen.getByRole('combobox', { name: '来源排序' }) as HTMLSelectElement).value).toBe('created-desc')
  })

  it('defaults to discovery first and keeps an explicit queue URL when switching', async () => {
    const onUrlUpdate = vi.fn()
    render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={onUrlUpdate}>
        <ArchiveInboxWorkspace />
      </NuqsTestingAdapter>
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['发现来源', '收件队列'])
    expect(screen.getByRole('tab', { name: '发现来源' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '收件队列' }), { button: 0, ctrlKey: false })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '收件队列' }).getAttribute('aria-selected')).toBe('true')
    )
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tab')).toBe('inbox'))
    fireEvent.mouseDown(screen.getByRole('tab', { name: '发现来源' }), { button: 0, ctrlKey: false })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '发现来源' }).getAttribute('aria-selected')).toBe('true')
    )
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('tab')).toBe(false))
  })
  it.each(['?tab=inbox', '?itemId=item-1', '?tab=uploaders&itemId=item-1'])(
    'preserves queue deep links: %s',
    (searchParams) => {
      render(
        <NuqsTestingAdapter searchParams={searchParams}>
          <ArchiveInboxWorkspace />
        </NuqsTestingAdapter>
      )
      expect(screen.getByRole('tab', { name: '收件队列' }).getAttribute('aria-selected')).toBe('true')
      expect(screen.getByText('收件内容')).toBeTruthy()
    }
  )
})
