import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelScan: vi.fn(),
  infiniteQueryOptions: vi.fn(() => ({ kind: 'items' })),
  invalidateQueries: vi.fn()
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

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: (options: { kind?: string }) =>
    options.kind === 'sources'
      ? { data: sourcesData, isPending: false, isError: false }
      : { data: detailData, isPending: false, isError: false },
  useInfiniteQuery: () => ({
    data: itemsData,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn()
  }),
  useMutation: (options: { kind?: string }) => ({
    isPending: false,
    mutate: options.kind === 'cancel' ? mocks.cancelScan : vi.fn()
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
        queryKey: () => ['items']
      },
      triggerScan: { mutationOptions: () => ({ kind: 'scan' }) },
      cancelScan: { mutationOptions: () => ({ kind: 'cancel' }) },
      setArchived: { mutationOptions: () => ({ kind: 'archive' }) },
      addToInbox: { mutationOptions: () => ({ kind: 'add' }) },
      createSource: { mutationOptions: () => ({ kind: 'create' }) }
    },
    archiveInbox: {
      list: { queryKey: () => ['inbox-list'] },
      summary: { queryKey: () => ['inbox-summary'] }
    }
  })
}))

import { ArchiveUploaderSources } from '../archive-uploader-sources'

afterEach(cleanup)

describe('ArchiveUploaderSources', () => {
  beforeEach(() => vi.clearAllMocks())

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
})
