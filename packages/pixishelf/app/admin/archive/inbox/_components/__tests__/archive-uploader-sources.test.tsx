import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addToInbox: vi.fn(),
  cancelScan: vi.fn(),
  ignoreItems: vi.fn(),
  restoreIgnoredItems: vi.fn(),
  infiniteQueryOptions: vi.fn(() => ({ kind: 'items' })),
  invalidateQueries: vi.fn(),
  setQueriesData: vi.fn()
}))

const source = {
  id: 'source-1',
  providerKey: 'e-hentai',
  identityKind: 'UID',
  identityValue: '123',
  displayName: 'UID 123',
  status: 'ACTIVE',
  latestSeenExternalId: '302',
  hasPendingLatest: false,
  canContinueHistory: true,
  lastScanAt: new Date('2026-09-02T11:11:00.000Z'),
  lastSuccessAt: new Date('2026-09-02T11:09:00.000Z'),
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date('2026-09-02T10:00:00.000Z'),
  updatedAt: new Date('2026-09-02T11:11:00.000Z')
}

const activeRun = {
  id: 'run-active',
  systemJobId: 'job-active',
  mode: 'LATEST',
  status: 'RUNNING',
  itemCount: 0,
  newCount: 0,
  activeCount: 0,
  archivedCount: 0,
  possibleUpdateCount: 0,
  replacementCount: 0,
  startedAt: new Date('2026-09-02T11:11:00.000Z'),
  finishedAt: null,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date('2026-09-02T11:11:00.000Z'),
  updatedAt: new Date('2026-09-02T11:11:00.000Z')
}

const completedRun = {
  ...activeRun,
  id: 'run-completed',
  systemJobId: 'job-completed',
  status: 'COMPLETED',
  itemCount: 1,
  newCount: 1,
  startedAt: new Date('2026-09-02T11:09:00.000Z'),
  finishedAt: new Date('2026-09-02T11:10:00.000Z'),
  createdAt: new Date('2026-09-02T11:09:00.000Z'),
  updatedAt: new Date('2026-09-02T11:10:00.000Z')
}

const sourcesData = [{ ...source, latestRun: activeRun }]
const detailData = { source, runs: [activeRun, completedRun] }
const itemsData = {
  pages: [
    {
      items: [
        {
          id: 'scan-item-1',
          externalId: '302',
          displayUrl: 'https://e-hentai.org/g/302/[redacted]/',
          title: 'Gallery 302',
          thumbnailUrl: 'https://ehgt.org/thumb-302.jpg',
          uploaderName: 'Uploader',
          postedAt: new Date('2026-09-02T10:30:00.000Z'),
          classification: 'NEW',
          intakeItemId: null,
          createdAt: new Date('2026-09-02T11:10:00.000Z')
        }
      ],
      nextCursor: null
    }
  ]
}
const ignoredItemsData = {
  pages: [
    {
      items: [
        {
          id: 'ignored-item-1',
          providerKey: 'e-hentai',
          externalId: '301',
          sourceDisplayName: 'UID 123',
          title: 'Ignored Gallery 301',
          thumbnailUrl: 'https://ehgt.org/thumb-301.jpg',
          uploaderName: 'Uploader',
          postedAt: new Date('2026-09-01T10:30:00.000Z'),
          ignoredAt: new Date('2026-09-02T11:20:00.000Z')
        }
      ],
      nextCursor: null
    }
  ]
}

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries, setQueriesData: mocks.setQueriesData }),
  useQuery: (options: { kind?: string }) =>
    options.kind === 'sources'
      ? { data: sourcesData, isPending: false, isError: false }
      : { data: detailData, isPending: false, isError: false },
  useInfiniteQuery: (options: { kind?: string }) => ({
    data: options.kind === 'ignored' ? ignoredItemsData : itemsData,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn()
  }),
  useMutation: (options: {
    kind?: string
    onSuccess?: (result: Record<string, unknown>, variables: Record<string, unknown>) => unknown
  }) => ({
    isPending: false,
    mutate:
      options.kind === 'cancel'
        ? mocks.cancelScan
        : options.kind === 'add'
          ? mocks.addToInbox
          : options.kind === 'ignore'
            ? (variables: { sourceId: string; itemIds: string[] }) => {
                mocks.ignoreItems(variables)
                void options.onSuccess?.(
                  {
                    ignoredItemIds: ['ignored-item-new'],
                    ignoredCount: variables.itemIds.length,
                    createdCount: variables.itemIds.length,
                    reusedCount: 0
                  },
                  variables
                )
              }
            : options.kind === 'restore'
              ? (variables: { ignoredItemIds: string[] }) => {
                  mocks.restoreIgnoredItems(variables)
                  void options.onSuccess?.({ restoredCount: variables.ignoredItemIds.length }, variables)
                }
              : vi.fn()
  })
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => '8d434276-8e67-4ea5-b586-0b8afcdfc3b7'
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0, size: 104 }],
    getTotalSize: () => 104,
    measureElement: vi.fn()
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveUploader: {
      listSources: { queryOptions: () => ({ kind: 'sources' }), queryKey: () => ['sources'] },
      getSource: { queryOptions: () => ({ kind: 'detail' }), queryKey: () => ['detail'] },
      listItems: {
        infiniteQueryOptions: mocks.infiniteQueryOptions,
        infiniteQueryKey: () => ['items-infinite']
      },
      listIgnoredItems: {
        infiniteQueryOptions: () => ({ kind: 'ignored' }),
        infiniteQueryKey: () => ['ignored-items-infinite']
      },
      triggerScan: { mutationOptions: () => ({ kind: 'scan' }) },
      cancelScan: { mutationOptions: () => ({ kind: 'cancel' }) },
      setArchived: { mutationOptions: () => ({ kind: 'archive' }) },
      addToInbox: { mutationOptions: () => ({ kind: 'add' }) },
      ignoreItems: { mutationOptions: (options: object) => ({ kind: 'ignore', ...options }) },
      restoreIgnoredItems: { mutationOptions: (options: object) => ({ kind: 'restore', ...options }) },
      createSource: { mutationOptions: () => ({ kind: 'create' }) }
    },
    archiveInbox: {
      list: { queryKey: () => ['inbox-list'] },
      summary: { queryKey: () => ['inbox-summary'] }
    }
  })
}))

import { ArchiveUploaderSources } from '../archive-uploader-sources'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'

afterEach(cleanup)

describe('ArchiveUploaderSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAdminPreferencesStore.setState({ archiveUploaderResultView: 'list' })
  })

  it('offers direct cancellation for the active scan', () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }))
    expect(mocks.cancelScan).toHaveBeenCalledWith({ sourceId: 'source-1', runId: 'run-active' })
  })

  it('renders one aggregated virtual result feed instead of scan-run tabs', () => {
    render(<ArchiveUploaderSources />)

    expect(screen.getByRole('heading', { level: 2, name: '发现结果' })).toBeTruthy()
    expect(screen.getByText('Gallery 302')).toBeTruthy()
    expect(screen.getByText(/按画廊汇总最近 30 天的完成扫描并去重/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /2026.*已完成/ })).toBeNull()
    expect(mocks.infiniteQueryOptions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'source-1', limit: 50 }),
      expect.objectContaining({ initialCursor: null })
    )
  })

  it('defaults to a pure list and loads the stored thumbnail only after switching view modes', () => {
    render(<ArchiveUploaderSources />)

    expect(screen.queryByRole('button', { name: '预览 Gallery 302 的首图' })).toBeNull()

    fireEvent.click(screen.getByLabelText('显示首图预览'))

    fireEvent.click(screen.getByRole('button', { name: '预览 Gallery 302 的首图' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Gallery 302 的首图预览' }).getAttribute('src')).toBe(
      'https://ehgt.org/thumb-302.jpg'
    )
  })

  it('submits selected discoveries with a browser-compatible attempt id', () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.click(screen.getByRole('button', { name: '加入收件箱（1）' }))

    expect(mocks.addToInbox).toHaveBeenCalledWith({
      sourceId: 'source-1',
      submissionAttemptId: '8d434276-8e67-4ea5-b586-0b8afcdfc3b7',
      itemIds: ['scan-item-1']
    })
  })

  it('removes ignored items from the infinite cache and refreshes both result feeds', async () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '忽略 Gallery 302' }))
    expect(mocks.ignoreItems).toHaveBeenCalledWith({ sourceId: 'source-1', itemIds: ['scan-item-1'] })
    await waitFor(() => {
      expect(mocks.setQueriesData).toHaveBeenCalledWith({ queryKey: ['items-infinite'] }, expect.any(Function))
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['items-infinite'] })
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ignored-items-infinite'] })
    })
    const removeItems = mocks.setQueriesData.mock.calls.find(
      ([filter]) => filter.queryKey[0] === 'items-infinite'
    )?.[1] as (data: typeof itemsData) => typeof itemsData
    expect(removeItems(itemsData).pages[0]?.items).toEqual([])

    fireEvent.click(screen.getByLabelText('查看全局已忽略画廊'))
    expect(screen.getByRole('heading', { level: 2, name: '全局已忽略' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复 Ignored Gallery 301' }))
    expect(mocks.restoreIgnoredItems).toHaveBeenCalledWith({ ignoredItemIds: ['ignored-item-1'] })
  })
})
