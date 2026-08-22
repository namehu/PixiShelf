import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audit: null as Record<string, unknown> | null,
  items: [] as Array<Record<string, unknown>>,
  nextCursor: null as string | null,
  listInputs: [] as Array<Record<string, unknown>>,
  overview: { activeOperation: null, latestOperation: null } as Record<string, unknown>,
  operation: null as Record<string, unknown> | null,
  startApply: vi.fn(),
  overviewRefetch: vi.fn(),
  replace: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/scan-history/audit-1/source-audit',
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    sourceAudit: {
      get: { queryOptions: (input: Record<string, unknown>) => ({ kind: 'get', input }) },
      listItems: {
        queryOptions: (input: Record<string, unknown>) => {
          mocks.listInputs.push(input)
          return { kind: 'items', input }
        }
      },
      getApplyOverview: { queryOptions: (input: Record<string, unknown>) => ({ kind: 'overview', input }) },
      getApplyOperation: { queryOptions: (input: Record<string, unknown>) => ({ kind: 'operation', input }) },
      startApply: { mutationOptions: () => ({ kind: 'start-apply' }) }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { kind: string }) => {
    const data =
      options.kind === 'get'
        ? mocks.audit
        : options.kind === 'items'
          ? { items: mocks.items, nextCursor: mocks.nextCursor }
          : options.kind === 'overview'
            ? mocks.overview
            : mocks.operation
    return {
      data,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: options.kind === 'overview' ? mocks.overviewRefetch : vi.fn()
    }
  },
  useMutation: () => ({ mutateAsync: mocks.startApply, isPending: false })
}))

import { SourceAuditManagement } from '../source-audit-management'

const completedAudit = {
  id: 'audit-1',
  jobId: 'job-1',
  status: 'COMPLETED',
  verification: 'FAST',
  startedAt: '2026-08-20T02:00:00.000Z',
  finishedAt: '2026-08-20T02:01:00.000Z',
  completed: true,
  actionRequiredReason: null,
  counts: { new: 1, changed: 2, missing: 3, invalid: 4, identityConflict: 5, unchanged: 10_000 },
  work: {
    walked: 10_020,
    candidates: 10_015,
    hashed: 15,
    changed: 15,
    discoveryDurationMs: 1_000,
    hashDurationMs: 2_000
  }
}

const missingItem = {
  id: 'missing-1',
  classification: 'MISSING',
  externalId: '123',
  title: 'Example',
  artistName: 'Artist',
  metadataRelativePath: '123/123.json',
  artwork: { id: 7, title: 'Example' },
  expectedExternalId: null,
  observedExternalId: null,
  reasonCode: 'SOURCE_NOT_SEEN',
  reasonSummary: '来源快照中没有找到这件作品。',
  eligibleAction: null,
  apply: { state: 'NOT_APPLICABLE', action: null },
  latestApplyResult: null
}

const newItem = {
  id: 'new-1',
  classification: 'NEW',
  externalId: '101',
  title: 'New work',
  artistName: 'Artist',
  metadataRelativePath: '101/101.json',
  artwork: null,
  expectedExternalId: null,
  observedExternalId: '101',
  reasonCode: null,
  reasonSummary: '来源中发现新作品。',
  eligibleAction: 'IMPORT',
  apply: { state: 'ELIGIBLE', action: 'IMPORT' },
  latestApplyResult: null
}

const changedItem = {
  id: 'changed-1',
  classification: 'CHANGED',
  externalId: '202',
  title: 'Changed work',
  artistName: 'Artist',
  metadataRelativePath: '202/202.json',
  artwork: { id: 202, title: 'Changed work' },
  expectedExternalId: '202',
  observedExternalId: '202',
  reasonCode: null,
  reasonSummary: '来源内容发生变化。',
  eligibleAction: 'SYNC',
  apply: { state: 'ELIGIBLE', action: 'SYNC' },
  latestApplyResult: null
}

describe('SourceAuditManagement', () => {
  beforeEach(() => {
    mocks.audit = completedAudit
    mocks.items = [missingItem]
    mocks.nextCursor = null
    mocks.listInputs = []
    mocks.overview = { activeOperation: null, latestOperation: null }
    mocks.operation = null
    mocks.startApply.mockReset()
    mocks.startApply.mockResolvedValue({
      outcome: 'ACCEPTED',
      operationId: 'apply-1',
      jobId: 'job-apply-1',
      status: 'PENDING',
      reused: false
    })
    mocks.overviewRefetch.mockReset()
    mocks.overviewRefetch.mockResolvedValue({ data: mocks.overview })
    mocks.replace.mockReset()
  })

  afterEach(cleanup)

  it('keeps missing differences read-only and filters from the summary band', () => {
    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getByText('10,000')).toBeTruthy()
    expect(screen.getAllByText('来源快照中没有找到这件作品。').length).toBeGreaterThan(0)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /删除|同步所选/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '筛选来源缺失，3 项' }))
    expect(mocks.listInputs.at(-1)?.classification).toBe('MISSING')
  })

  it('polls an in-flight audit without presenting partial results', () => {
    mocks.audit = { ...completedAudit, status: 'RUNNING', completed: false, finishedAt: null }
    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getByText(/可以安全离开页面/)).toBeTruthy()
    expect(screen.queryByText('差异摘要')).toBeNull()
    expect(screen.queryByText('差异明细')).toBeNull()
  })

  it('does not expose stale details when a terminal run has no consumable result', () => {
    mocks.audit = { ...completedAudit, status: 'FAILED', completed: false, actionRequiredReason: null }
    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getByText('本次核对没有形成可用结果')).toBeTruthy()
    expect(screen.queryByText('差异摘要')).toBeNull()
    expect(screen.queryByText('差异明细')).toBeNull()
  })

  it('selects eligible new and changed items from the current page and confirms one mixed command', async () => {
    mocks.items = [newItem, changedItem]
    render(<SourceAuditManagement auditRunId="audit-1" />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页可同步项目' }))
    fireEvent.click(screen.getByRole('button', { name: '同步所选来源（2）' }))

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('新增导入 1')).toBeTruthy()
    expect(screen.getByText('变化同步 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }))

    await waitFor(() => expect(mocks.startApply).toHaveBeenCalledOnce())
    expect(mocks.startApply.mock.calls[0]?.[0]).toMatchObject({
      auditRunId: 'audit-1',
      itemIds: ['changed-1', 'new-1']
    })
    expect(mocks.startApply.mock.calls[0]?.[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(mocks.replace).toHaveBeenCalledWith('/admin/scan-history/audit-1/source-audit?operation=apply-1', {
      scroll: false
    })
  })

  it('locks selection while an operation is active but keeps differences visible', () => {
    mocks.items = [newItem]
    mocks.overview = {
      activeOperation: { operationId: 'apply-1', jobId: 'job-apply-1', status: 'RUNNING' },
      latestOperation: { operationId: 'apply-1', jobId: 'job-apply-1', status: 'RUNNING' }
    }
    mocks.operation = createOperation({ status: 'RUNNING', terminal: false, stage: 'APPLYING', progress: 40 })

    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getByText('来源同步正在执行')).toBeTruthy()
    expect(screen.getAllByText('来源中发现新作品。').length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: '选择当前页可同步项目' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '同步所选来源' })).toHaveProperty('disabled', true)
  })

  it('clears current-page selection when the difference filter changes', () => {
    mocks.items = [newItem]
    render(<SourceAuditManagement auditRunId="audit-1" />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择New work' })[0]!)
    expect(screen.getByRole('button', { name: '同步所选来源（1）' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '筛选来源变化，2 项' }))
    expect(screen.getByRole('button', { name: '同步所选来源' })).toHaveProperty('disabled', true)
  })

  it('reuses the same idempotency key when a response cannot be confirmed', async () => {
    mocks.items = [newItem]
    mocks.startApply.mockRejectedValue(new Error('network unavailable'))
    render(<SourceAuditManagement auditRunId="audit-1" />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页可同步项目' }))
    fireEvent.click(screen.getByRole('button', { name: '同步所选来源（1）' }))
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }))

    await screen.findByText(/提交结果暂时无法确认/)
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }))
    await waitFor(() => expect(mocks.startApply).toHaveBeenCalledTimes(2))

    expect(mocks.startApply.mock.calls[0]?.[0].idempotencyKey).toBe(mocks.startApply.mock.calls[1]?.[0].idempotencyKey)
  })

  it('keeps safe per-item results visible after a partially failed terminal operation', () => {
    mocks.overview = {
      activeOperation: null,
      latestOperation: { operationId: 'apply-1', jobId: 'job-apply-1', status: 'FAILED' }
    }
    mocks.operation = createOperation({
      status: 'FAILED',
      terminal: true,
      stage: 'FAILED',
      counts: { pending: 0, processing: 0, applied: 0, skipped: 0, stale: 1, conflict: 0, failed: 0 },
      items: [
        {
          id: 'result-1',
          auditItemId: 'new-1',
          classification: 'NEW',
          action: 'IMPORT',
          state: 'STALE',
          externalId: '101',
          title: 'New work',
          artistName: 'Artist',
          metadataRelativePath: '101/101.json',
          artwork: null,
          code: 'STALE_SOURCE_INPUT',
          summary: null,
          retryable: true,
          startedAt: null,
          finishedAt: '2026-08-20T02:02:00.000Z'
        }
      ]
    })

    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getByText(/1 项需要检查/)).toBeTruthy()
    expect(screen.getAllByText('来源已变化').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/本项没有写入图库/).length).toBeGreaterThan(0)
  })

  it('labels cancellation without hiding items completed before cancellation', () => {
    mocks.overview = {
      activeOperation: null,
      latestOperation: { operationId: 'apply-1', jobId: 'job-apply-1', status: 'CANCELLED' }
    }
    mocks.operation = createOperation({
      status: 'CANCELLED',
      terminal: true,
      stage: 'CANCELLED',
      counts: { pending: 0, processing: 0, applied: 1, skipped: 0, stale: 0, conflict: 0, failed: 0 },
      items: [
        {
          id: 'result-1',
          auditItemId: 'new-1',
          classification: 'NEW',
          action: 'IMPORT',
          state: 'APPLIED',
          externalId: '101',
          title: 'New work',
          artistName: 'Artist',
          metadataRelativePath: '101/101.json',
          artwork: { id: 101, title: 'New work' },
          code: null,
          summary: null,
          retryable: false,
          startedAt: '2026-08-20T02:01:02.000Z',
          finishedAt: '2026-08-20T02:01:04.000Z'
        }
      ]
    })

    render(<SourceAuditManagement auditRunId="audit-1" />)

    expect(screen.getAllByText('来源同步已取消').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已导入').length).toBeGreaterThan(0)
  })
})

function createOperation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apply-1',
    auditRunId: 'audit-1',
    jobId: 'job-apply-1',
    status: 'COMPLETED',
    terminal: true,
    resultComplete: true,
    progress: 100,
    stage: 'COMPLETED',
    requested: { total: 1, new: 1, changed: 0 },
    counts: { pending: 0, processing: 0, applied: 1, skipped: 0, stale: 0, conflict: 0, failed: 0 },
    createdAt: '2026-08-20T02:01:00.000Z',
    startedAt: '2026-08-20T02:01:01.000Z',
    finishedAt: '2026-08-20T02:02:00.000Z',
    items: [],
    ...overrides
  }
}
