import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateArchiveTitleRules } from '@pixishelf/job-contracts'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { ArchiveTitleFilteredResults } from '../archive-title-filtered-results'

const mocks = vi.hoisted(() => ({ listItems: vi.fn(), review: vi.fn(), pending: false }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveSearch: {
      listItems: {
        infiniteQueryOptions: (input: object, options: object) => ({
          queryKey: ['filtered-items', input],
          queryFn: ({ pageParam }: { pageParam: unknown }) => mocks.listItems({ ...input, cursor: pageParam }),
          ...options
        })
      }
    }
  })
}))
vi.mock('../use-title-review', () => ({ useTitleReview: () => ({ review: mocks.review, pending: mocks.pending }) }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }))
vi.mock('react-virtuoso', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    Virtuoso: forwardRef(function TestList(
      {
        data,
        itemContent,
        endReached
      }: {
        data: Array<{ id: string }>
        itemContent: (index: number, row: { id: string }) => ReactNode
        endReached: () => void
      },
      ref
    ) {
      useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn(), scrollTo: vi.fn() }))
      return (
        <div>
          {data.map((row, index) => (
            <div key={row.id}>{itemContent(index, row)}</div>
          ))}
          <button onClick={endReached}>加载下一页</button>
        </div>
      )
    })
  }
})

const rawTitle = 'Chloe &amp; Amber - Ragnarok'
const title = 'Chloe & Amber - Ragnarok'
const item = {
  id: 'filtered-1',
  externalId: '4270606',
  title: rawTitle,
  uploaderName: 'Fixture uploader',
  thumbnailUrl: 'https://ehgt.org/synthetic-cover.jpg',
  reviewDecision: 'AUTO',
  matchEvaluation: evaluateArchiveTitleRules(
    { version: 1, any: [{ operator: 'CONTAINS', text: '[RAG]' }], all: [], none: [] },
    { origin: 'REMOTE', titles: [rawTitle] }
  )
}
let client: QueryClient
function setup(
  counts: { filtered: number; unreviewed: number; excluded: number } | undefined = {
    filtered: 1500,
    unreviewed: 1080,
    excluded: 420
  }
) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ArchiveTitleFilteredResults sourceId="source" rulesVersion={2} counts={counts} />
    </QueryClientProvider>
  )
}
async function changeView(action: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: /显示模式：/ }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: action }))
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending = false
  mocks.listItems.mockResolvedValue({ items: [item], nextCursor: null })
  useAdminPreferencesStore.setState({ archiveUploaderResultView: 'list' })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  client?.clear()
  vi.restoreAllMocks()
})

describe('filtered title candidates display modes', () => {
  it('shares all three modes with accepted results, retaining selection and decoded private titles', async () => {
    setup()
    const link = await screen.findByRole('link', { name: title })
    expect(screen.getByText('第 1 条')).toBeTruthy()
    expect(link.closest('[data-privacy-sensitive]')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    const selected = screen.getByRole('checkbox', { name: `复核 ${title}` })
    fireEvent.click(selected)
    expect(screen.getByRole('checkbox', { name: '选择已加载过滤项，最多一百条' }).getAttribute('aria-checked')).toBe(
      'true'
    )

    await changeView('显示首图预览')
    expect(useAdminPreferencesStore.getState().archiveUploaderResultView).toBe('preview')
    expect(screen.getByText('第 1 条')).toBeTruthy()
    const cover = screen.getByRole('link', { name: `在新标签页打开原站 ${title}` })
    expect(cover.getAttribute('href')).toBe('/api/archive/catalog/filtered-1/source')
    expect(cover.getAttribute('target')).toBe('_blank')
    expect(cover.querySelector('img')?.getAttribute('src')).toBe(item.thumbnailUrl)
    expect(cover.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    fireEvent.load(cover.querySelector('img')!)
    expect(cover.querySelector('img')?.classList.contains('opacity-0')).toBe(false)
    expect(mocks.review).not.toHaveBeenCalled()

    await changeView('使用卡片模式')
    expect(useAdminPreferencesStore.getState().archiveUploaderResultView).toBe('cards')
    expect(screen.getByText('第 1 条')).toBeTruthy()
    expect(screen.getByRole('link', { name: `在新标签页打开原站 ${title}` }).classList.contains('h-72')).toBe(true)
    expect(screen.getByRole('checkbox', { name: `复核 ${title}` }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '接纳所选' }))
    expect(mocks.review).toHaveBeenCalledWith(['filtered-1'], 'INCLUDE')

    await changeView('使用纯列表')
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('checkbox', { name: `复核 ${title}` }).getAttribute('aria-checked')).toBe('true')
  })

  it('opens in the shared preferred mode and retains review evidence and image failure fallback', async () => {
    useAdminPreferencesStore.setState({ archiveUploaderResultView: 'preview' })
    setup()
    const link = await screen.findByRole('link', { name: `在新标签页打开原站 ${title}` })
    const row = link.closest('[data-discovery-item]')!
    expect(within(row as HTMLElement).getByText('未满足接纳条件')).toBeTruthy()
    fireEvent.error(link.querySelector('img')!)
    expect(link.querySelector('img')).toBeNull()
    expect(screen.getByLabelText(`${title} 没有可用首图`)).toBeTruthy()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '确认排除' }))
    expect(mocks.review).toHaveBeenCalledWith(['filtered-1'], 'EXCLUDE')
    act(() => useAdminPreferencesStore.setState({ archiveUploaderResultView: 'cards' }))
    expect(screen.getByRole('button', { name: '显示模式：卡片' })).toBeTruthy()
  })

  it('keeps missing-cover candidates actionable and uploader restrictions enforced', async () => {
    mocks.listItems.mockResolvedValue({
      items: [
        {
          ...item,
          thumbnailUrl: null,
          reviewDecision: 'EXCLUDE',
          matchEvaluation: { ...item.matchEvaluation, uploaderMatches: false }
        }
      ],
      nextCursor: null
    })
    useAdminPreferencesStore.setState({ archiveUploaderResultView: 'cards' })
    setup()
    expect(await screen.findByLabelText(`${title} 没有可用首图`)).toBeTruthy()
    expect((screen.getByRole('button', { name: '接纳' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '确认排除' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '恢复遵循规则' }))
    expect(mocks.review).toHaveBeenCalledWith(['filtered-1'], 'AUTO')
  })

  it('does not change database query criteria or review selection when switching display mode', async () => {
    mocks.listItems.mockResolvedValue({
      items: [item, { ...item, id: 'filtered-2', title: 'Other gallery' }],
      nextCursor: null
    })
    setup()
    fireEvent.click(await screen.findByRole('checkbox', { name: `复核 ${title}` }))
    expect(screen.getByRole('checkbox', { name: '选择已加载过滤项，最多一百条' }).getAttribute('aria-checked')).toBe(
      'mixed'
    )
    await changeView('显示首图预览')
    expect(mocks.listItems).toHaveBeenCalledOnce()
    expect(mocks.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'source', matchView: 'FILTERED', reviewFilter: 'UNREVIEWED', limit: 50 })
    )
    fireEvent.click(screen.getByRole('radio', { name: '已确认排除 420' }))
    await waitFor(() =>
      expect(mocks.listItems).toHaveBeenCalledWith(expect.objectContaining({ reviewFilter: 'EXCLUDED' }))
    )
    expect(screen.queryByLabelText('批量复核')).toBeNull()
  })

  it('shows source totals and continues ordinals across pages, resetting after changing the review scope', async () => {
    mocks.listItems.mockImplementation(({ cursor, reviewFilter }) =>
      Promise.resolve({
        items: reviewFilter === 'EXCLUDED' || cursor ? [{ ...item, id: 'filtered-2', title: 'Other gallery' }] : [item],
        nextCursor: reviewFilter === 'UNREVIEWED' && !cursor ? 'next' : null
      })
    )
    setup()
    await screen.findByText('第 1 条')
    expect(screen.getByRole('radio', { name: '未复核 1080' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '已确认排除 420' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '全部过滤项 1500' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载下一页' }))
    const second = (await screen.findByRole('link', { name: 'Other gallery' })).closest('[data-discovery-item]')!
    expect(within(second as HTMLElement).getByText('第 2 条')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '已确认排除 420' }))
    await waitFor(() => expect(screen.queryByText('第 2 条')).toBeNull())
    const remaining = (await screen.findByRole('link', { name: 'Other gallery' })).closest('[data-discovery-item]')!
    expect(within(remaining as HTMLElement).getByText('第 1 条')).toBeTruthy()
  })

  it('shows zero totals for empty review scopes', async () => {
    mocks.listItems.mockResolvedValue({ items: [], nextCursor: null })
    setup({ filtered: 0, unreviewed: 0, excluded: 0 })
    await screen.findByText('没有符合条件的过滤项')
    expect(screen.getByRole('radio', { name: '未复核 0' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '已确认排除 0' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '全部过滤项 0' })).toBeTruthy()
  })
})
