import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  refetch: vi.fn(),
  startScan: vi.fn(),
  onQueued: null as (() => void) | null,
  onRefreshActivity: null as (() => void) | null,
  mediaActivityIsFetching: false,
  summaryIsRefreshingActivity: false
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({
    data: { activity: { scan: null, localImport: null } },
    refetch: mocks.refetch,
    isFetching: mocks.mediaActivityIsFetching
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    setting: {
      health: { queryOptions: vi.fn(() => ({})) },
      getScanPath: { queryOptions: vi.fn(() => ({})) },
      setScanPath: { mutationOptions: vi.fn(() => ({})) }
    },
    localImport: { status: { queryOptions: vi.fn(() => ({})) } },
    scanRun: { list: { queryKey: vi.fn(() => ['scanRun.list']) } }
  })
}))

vi.mock('../../_hooks/use-sse-scan', () => ({
  useSseScan: ({ onQueued }: { onQueued?: () => void }) => {
    mocks.onQueued = onQueued ?? null
    return { state: { streaming: false }, actions: { startScan: mocks.startScan } }
  }
}))
vi.mock('../scan-history-summary-card', () => ({
  ScanHistorySummaryCard: ({
    onRefreshActivity,
    isRefreshingActivity
  }: {
    onRefreshActivity?: () => void
    isRefreshingActivity?: boolean
  }) => {
    mocks.onRefreshActivity = onRefreshActivity ?? null
    mocks.summaryIsRefreshingActivity = Boolean(isRefreshingActivity)
    return <section data-testid="scan-summary">当前/最近扫描</section>
  }
}))
vi.mock('../server-scan-card', () => ({
  ServerScanCard: () => <section data-testid="server-scan">服务端扫描</section>
}))
vi.mock('../source-audit-card', () => ({
  SourceAuditCard: () => <section data-testid="source-audit">来源一致性核对</section>
}))
vi.mock('../client-scan-card', () => ({
  ClientScanCard: () => <section data-testid="client-scan">客户端扫描</section>
}))
import ScanManagement from '../scan-management'

describe('ScanManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onQueued = null
    mocks.onRefreshActivity = null
    mocks.mediaActivityIsFetching = false
    mocks.summaryIsRefreshingActivity = false
  })

  it('puts current/recent scan status before every scan action and removes the log region', () => {
    render(<ScanManagement />)

    expect(screen.getByRole('heading', { name: 'Pixiv 扫描' })).toBeTruthy()
    expect(screen.getAllByTestId(/scan-summary|server-scan|source-audit|client-scan/).map((item) => item.dataset.testid)).toEqual([
      'scan-summary',
      'server-scan',
      'source-audit',
      'client-scan'
    ])
    expect(screen.queryByText('运行日志')).toBeNull()
  })

  it('refreshes Worker activity and Pixiv scan history as soon as a scan is queued', () => {
    render(<ScanManagement />)

    mocks.onQueued?.()

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['scanRun.list'] })
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('passes Worker activity refresh controls to the current/recent scan card', () => {
    mocks.mediaActivityIsFetching = true
    render(<ScanManagement />)

    mocks.onRefreshActivity?.()

    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.summaryIsRefreshingActivity).toBe(true)
  })
})
