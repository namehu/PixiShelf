import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addToInbox: vi.fn(),
  createSubmissionAttempt: vi.fn(),
  cancelScan: vi.fn(),
  ignoreItems: vi.fn(),
  restoreIgnoredItems: vi.fn(),
  matchUploaderUid: vi.fn(),
  setUploaderUid: vi.fn(),
  writeClipboard: vi.fn(),
  infiniteQueryOptions: vi.fn(() => ({ kind: 'items' })),
  invalidateQueries: vi.fn(),
  setQueriesData: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))

const source = {
  id: 'source-1',
  providerKey: 'e-hentai',
  identityKind: 'UID',
  identityValue: '123',
  uploaderUid: '123',
  uidRevalidationRequiredAt: null,
  uidBindingState: 'BOUND',
  displayName: 'UID 123',
  status: 'ACTIVE',
  latestSeenExternalId: '302',
  hasPendingLatest: false,
  canContinueHistory: true,
  latestCoverage: 'CURRENT',
  historyCoverage: 'HAS_MORE',
  catalogCounts: { actionable: 1, processing: 0, archived: 0, attention: 0, total: 1 },
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
  searchIdentityKind: 'UID',
  searchIdentityValue: '123',
  status: 'RUNNING',
  itemCount: 0,
  newCount: 0,
  activeCount: 0,
  archivedCount: 0,
  possibleUpdateCount: 0,
  replacementCount: 0,
  stopReason: null,
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
          id: 'catalog-item-1',
          sourceId: 'source-1',
          providerKey: 'e-hentai',
          externalId: '302',
          displayUrl: 'https://e-hentai.org/g/302/[redacted]/',
          title: 'Gallery 302',
          thumbnailUrl: 'https://ehgt.org/thumb-302.jpg',
          uploaderName: 'Uploader',
          postedAt: new Date('2026-09-02T10:30:00.000Z'),
          classification: 'NEW',
          comparisonKnown: true,
          changeReasons: [],
          firstSeenAt: new Date('2026-09-02T11:10:00.000Z'),
          lastSeenAt: new Date('2026-09-02T11:10:00.000Z'),
          workflowStage: 'NEW',
          workflowBucket: 'ACTIONABLE',
          recommendation: 'NEW' as string | null,
          actionable: true,
          intakeItemId: null as string | null,
          intakeStatus: null as string | null,
          archiveImportId: null as string | null,
          archiveImportStatus: null as string | null,
          artworkId: null as number | null,
          errorCode: null as string | null,
          errorMessage: null as string | null,
          recoverable: false,
          sortAt: new Date('2026-09-02T10:30:00.000Z')
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
let currentDetailData: unknown = detailData
let currentItemsData = itemsData
let currentSourcesData: unknown = sourcesData
let currentUidMutationResult: Record<string, unknown> = {
  outcome: 'UPDATED',
  sourceId: 'source-1',
  uploaderUid: '456',
  source: {}
}

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning
  }
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries, setQueriesData: mocks.setQueriesData }),
  useQuery: (options: { kind?: string }) =>
    options.kind === 'sources'
      ? { data: currentSourcesData, isPending: false, isError: false }
      : { data: currentDetailData, isPending: false, isError: false },
  useInfiniteQuery: (options: { kind?: string }) => ({
    data: options.kind === 'ignored' ? ignoredItemsData : currentItemsData,
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
        : options.kind === 'prepare'
          ? (variables: { sourceId: string; itemIds: string[] }) => {
              mocks.createSubmissionAttempt(variables)
              void options.onSuccess?.({ submissionAttemptId: '00000000-0000-4000-8000-000000000001' }, variables)
            }
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
                : options.kind === 'uid'
                  ? (variables: { sourceId: string; uploaderUid: string }) => {
                      mocks.setUploaderUid(variables)
                      void options.onSuccess?.(currentUidMutationResult, variables)
                    }
                  : options.kind === 'match-uid'
                    ? (variables: { sourceId: string }) => {
                        mocks.matchUploaderUid(variables)
                        void options.onSuccess?.(
                          {
                            outcome: 'MATCHED',
                            sourceId: 'source-1',
                            uploaderUid: '456',
                            uploaderName: 'alice',
                            evidenceExternalId: '302'
                          },
                          variables
                        )
                      }
                  : vi.fn()
  })
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
      matchUploaderUid: { mutationOptions: (options: object) => ({ kind: 'match-uid', ...options }) },
      setUploaderUid: { mutationOptions: (options: object) => ({ kind: 'uid', ...options }) },
      createSubmissionAttempt: { mutationOptions: (options: object) => ({ kind: 'prepare', ...options }) },
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
    currentDetailData = detailData
    currentItemsData = itemsData
    currentSourcesData = sourcesData
    currentUidMutationResult = {
      outcome: 'UPDATED',
      sourceId: 'source-1',
      uploaderUid: '456',
      source: {}
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeClipboard }
    })
    useAdminPreferencesStore.setState({ archiveUploaderResultView: 'list' })
  })

  it('offers direct cancellation for the active scan', () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }))
    expect(mocks.cancelScan).toHaveBeenCalledWith({ sourceId: 'source-1', runId: 'run-active' })
  })

  it('shows and copies the stable uploader UID from both source views', async () => {
    render(<ArchiveUploaderSources />)

    expect(screen.getAllByText('UID 123').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: '复制上传者 UID' }))

    await waitFor(() => expect(mocks.writeClipboard).toHaveBeenCalledWith('123'))
  })

  it('binds an unbound NAME source through a two-step confirmation', () => {
    const unboundSource = {
      ...source,
      identityKind: 'NAME' as const,
      identityValue: 'alice',
      displayName: 'alice',
      uploaderUid: null,
      uidBindingState: 'UNBOUND' as const,
      latestRun: completedRun
    }
    currentSourcesData = [unboundSource]
    currentDetailData = { source: unboundSource, runs: [completedRun] }
    render(<ArchiveUploaderSources />)

    expect(screen.getAllByText('未绑定 UID').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '绑定 UID' }))
    fireEvent.change(screen.getByLabelText('上传者 UID'), { target: { value: '000456' } })
    fireEvent.click(screen.getByRole('button', { name: '检查变更' }))

    expect(screen.getByText(/alice → UID 456/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))
    expect(mocks.setUploaderUid).toHaveBeenCalledWith({ sourceId: 'source-1', uploaderUid: '456' })
  })

  it('auto-matches a UID into the editable field without saving before confirmation', () => {
    const unboundSource = {
      ...source,
      identityKind: 'NAME' as const,
      identityValue: 'alice',
      displayName: 'alice',
      uploaderUid: null,
      uidBindingState: 'UNBOUND' as const,
      latestRun: completedRun
    }
    currentSourcesData = [unboundSource]
    currentDetailData = { source: unboundSource, runs: [completedRun] }
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '绑定 UID' }))
    fireEvent.click(screen.getByRole('button', { name: '自动匹配' }))

    expect(mocks.matchUploaderUid).toHaveBeenCalledWith({ sourceId: 'source-1' })
    expect((screen.getByLabelText('上传者 UID') as HTMLInputElement).value).toBe('456')
    expect(screen.getByText(/已由 alice 的画廊 GID 302 验证/)).toBeTruthy()
    expect(mocks.setUploaderUid).not.toHaveBeenCalled()
  })

  it('disables UID changes while the source has an active scan', () => {
    render(<ArchiveUploaderSources />)

    expect(screen.getByRole('button', { name: '更正 UID' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('扫描完成或取消后才能绑定或更正 UID。')).toBeTruthy()
  })

  it('keeps the existing catalog visible while UID coverage awaits revalidation', () => {
    const revalidatingSource = {
      ...source,
      uidBindingState: 'REVALIDATION_REQUIRED' as const,
      uidRevalidationRequiredAt: new Date('2026-09-04T00:00:00.000Z'),
      lastScanAt: null,
      lastSuccessAt: null,
      latestSeenExternalId: null,
      hasPendingLatest: false,
      canContinueHistory: false,
      latestCoverage: 'NOT_SCANNED' as const,
      historyCoverage: 'NOT_SCANNED' as const,
      latestRun: completedRun
    }
    currentSourcesData = [revalidatingSource]
    currentDetailData = { source: revalidatingSource, runs: [completedRun] }

    render(<ArchiveUploaderSources />)

    expect(screen.getAllByText('UID 覆盖待校验').length).toBeGreaterThan(0)
    expect(screen.getByText('UID 待校验')).toBeTruthy()
    expect(screen.getByText('UID 覆盖：待重新验证')).toBeTruthy()
    expect(screen.queryByText('最新：尚未扫描')).toBeNull()
    expect(screen.queryByText('历史：尚未扫描')).toBeNull()
    expect(screen.getByText(/现有目录、收件箱关联和归档状态仍然有效/)).toBeTruthy()
    expect(screen.getByText('Gallery 302')).toBeTruthy()
  })

  it('offers a jump to the existing source when a UID binding conflicts', async () => {
    const unboundSource = {
      ...source,
      identityKind: 'NAME' as const,
      identityValue: 'alice',
      displayName: 'alice',
      uploaderUid: null,
      uidBindingState: 'UNBOUND' as const,
      latestRun: completedRun
    }
    const existingSource = {
      ...source,
      id: 'source-existing',
      identityValue: '456',
      uploaderUid: '456',
      displayName: 'Existing uploader',
      latestRun: completedRun
    }
    currentSourcesData = [unboundSource, existingSource]
    currentDetailData = { source: unboundSource, runs: [completedRun] }
    currentUidMutationResult = {
      outcome: 'CONFLICT',
      sourceId: 'source-1',
      conflictingSourceId: 'source-existing',
      uploaderUid: '456'
    }
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '绑定 UID' }))
    fireEvent.change(screen.getByLabelText('上传者 UID'), { target: { value: '456' } })
    fireEvent.click(screen.getByRole('button', { name: '检查变更' }))
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalled())
    const toastOptions = mocks.toastWarning.mock.calls[0]?.[1] as { action: { onClick: () => void } }
    toastOptions.action.onClick()
    await waitFor(() =>
      expect(mocks.infiniteQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'source-existing' }),
        expect.any(Object)
      )
    )
  })

  it('renders one aggregated virtual result feed instead of scan-run tabs', () => {
    render(<ArchiveUploaderSources />)

    expect(screen.getByRole('heading', { level: 2, name: '待处理' })).toBeTruthy()
    expect(screen.getByText('Gallery 302')).toBeTruthy()
    expect(screen.getByText(/尚未处理，或本地版本与当前公开信息存在稳定差异/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /2026.*已完成/ })).toBeNull()
    expect(mocks.infiniteQueryOptions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'source-1', view: 'ACTIONABLE', limit: 50 }),
      expect.objectContaining({ initialCursor: null })
    )
    expect(screen.getByText('最新：已追到上次水位')).toBeTruthy()
    expect(screen.getAllByText(/仍有更早内容/).length).toBeGreaterThan(0)
  })

  it('keeps the durable catalog visible after retained scan runs have been cleaned up', () => {
    currentDetailData = { source, runs: [] }

    render(<ArchiveUploaderSources />)

    expect(screen.getByText('Gallery 302')).toBeTruthy()
    expect(screen.queryByText('尚无扫描记录')).toBeNull()
  })

  it('forces one final catalog refresh when processing reaches a terminal state', async () => {
    currentDetailData = {
      source: { ...source, catalogCounts: { ...source.catalogCounts, actionable: 0, processing: 1 } },
      runs: [completedRun]
    }
    const rendered = render(<ArchiveUploaderSources />)
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalled())
    mocks.invalidateQueries.mockClear()

    currentDetailData = {
      source: { ...source, catalogCounts: { ...source.catalogCounts, actionable: 0, processing: 0, archived: 1 } },
      runs: [completedRun]
    }
    rendered.rerender(<ArchiveUploaderSources />)

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['items-infinite'] })
    })
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

  it('submits selected catalog items without generating persistence ids in the browser', () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gallery 302' }))
    fireEvent.click(screen.getByRole('button', { name: '加入收件箱（1）' }))

    expect(mocks.createSubmissionAttempt).toHaveBeenCalledWith({
      sourceId: 'source-1',
      itemIds: ['catalog-item-1']
    })
    expect(mocks.addToInbox).toHaveBeenCalledWith({
      sourceId: 'source-1',
      itemIds: ['catalog-item-1'],
      submissionAttemptId: '00000000-0000-4000-8000-000000000001'
    })
  })

  it('can recreate an inbox item after terminal intake history was cleaned up', () => {
    const archivedItem = itemsData.pages[0]!.items[0]!
    currentItemsData = {
      pages: [
        {
          items: [
            {
              ...archivedItem,
              workflowStage: 'CANCELLED',
              workflowBucket: 'ATTENTION',
              recommendation: null,
              actionable: false,
              intakeItemId: null,
              intakeStatus: null,
              errorCode: 'CANCELLED',
              errorMessage: 'Archive intake cancelled',
              recoverable: true
            }
          ],
          nextCursor: null
        }
      ]
    }
    currentDetailData = {
      source: { ...source, catalogCounts: { actionable: 0, processing: 0, archived: 0, attention: 1, total: 1 } },
      runs: [completedRun]
    }
    render(<ArchiveUploaderSources />)
    fireEvent.click(screen.getByLabelText('查看异常'))
    fireEvent.click(screen.getByRole('button', { name: '重新加入收件箱 Gallery 302' }))

    expect(mocks.createSubmissionAttempt).toHaveBeenCalledWith({
      sourceId: 'source-1',
      itemIds: ['catalog-item-1']
    })
    expect(mocks.addToInbox).toHaveBeenCalledWith({
      sourceId: 'source-1',
      itemIds: ['catalog-item-1'],
      submissionAttemptId: '00000000-0000-4000-8000-000000000001'
    })
  })

  it('removes ignored items from the infinite cache and refreshes both result feeds', async () => {
    render(<ArchiveUploaderSources />)

    fireEvent.click(screen.getByRole('button', { name: '忽略 Gallery 302' }))
    expect(mocks.ignoreItems).toHaveBeenCalledWith({ sourceId: 'source-1', itemIds: ['catalog-item-1'] })
    await waitFor(() => {
      expect(mocks.setQueriesData).toHaveBeenCalledWith({ queryKey: ['items-infinite'] }, expect.any(Function))
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['items-infinite'] })
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ignored-items-infinite'] })
    })
    const removeItems = mocks.setQueriesData.mock.calls.find(
      ([filter]) => filter.queryKey[0] === 'items-infinite'
    )?.[1] as (data: typeof itemsData) => typeof itemsData
    expect(removeItems(itemsData).pages[0]?.items).toEqual([])

    fireEvent.click(screen.getByLabelText('查看全局已忽略'))
    expect(screen.getByRole('heading', { level: 2, name: '全局已忽略' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复 Ignored Gallery 301' }))
    expect(mocks.restoreIgnoredItems).toHaveBeenCalledWith({ ignoredItemIds: ['ignored-item-1'] })
  })
})
