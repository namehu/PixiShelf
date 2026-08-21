import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.data, isFetching: false, refetch: vi.fn() })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ scanRun: { list: { queryOptions: vi.fn(() => ({})) } } })
}))

import { ScanHistorySummaryCard } from '../scan-history-summary-card'

const baseRun = {
  id: 'run-1',
  type: 'PIXIV',
  mode: 'INCREMENTAL',
  status: 'COMPLETED',
  startedAt: new Date('2026-08-20T00:00:00.000Z'),
  durationMs: 1_000,
  errorMessage: null,
  totalArtworks: 10_000,
  succeededArtworks: 4,
  skippedArtworks: 9_996,
  failedArtworks: 0,
  newImages: 4
}

describe('ScanHistorySummaryCard inventory metrics', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.data = []
  })

  it('shows localized incremental work and the changed-input count', () => {
    mocks.data = [
      {
        ...baseRun,
        walkedEntries: 10_004,
        metadataCandidates: 10_000,
        inventoryUnchanged: 9_996,
        contentHashed: 4,
        contentChanged: 4,
        parsedInputs: 4,
        publishedInputs: 4
      }
    ]

    render(<ScanHistorySummaryCard />)

    expect(screen.getByText('本次扫描工作量')).toBeTruthy()
    expect(screen.getByText('遍历 10,004')).toBeTruthy()
    expect(screen.getByText('变化 4')).toBeTruthy()
    expect(screen.getByText('未变化 9,996')).toBeTruthy()
  })

  it('does not fabricate inventory measurements for a historical or explicit-list run', () => {
    mocks.data = [{ ...baseRun, mode: 'CLIENT_LIST', walkedEntries: null }]

    render(<ScanHistorySummaryCard />)

    expect(screen.queryByText('本次扫描工作量')).toBeNull()
  })

  it('shows source audit differences and links to the recoverable result page', () => {
    mocks.data = [
      {
        ...baseRun,
        operationKind: 'CONSISTENCY_AUDIT',
        auditNewInputs: 2,
        auditChangedInputs: 3,
        missingInputs: 4,
        auditInvalidInputs: 5,
        auditIdentityConflictInputs: 6,
        inventoryUnchanged: 9_980,
        walkedEntries: 10_010
      }
    ]

    render(<ScanHistorySummaryCard />)

    expect(screen.getByText(/来源一致性核对/)).toBeTruthy()
    expect(screen.getByText('身份冲突')).toBeTruthy()
    expect(screen.getByText('9,980')).toBeTruthy()
    expect(screen.queryByText('本次扫描工作量')).toBeNull()
    expect(screen.getByRole('link', { name: /查看核对结果/ }).getAttribute('href')).toBe(
      '/admin/scan-history/run-1/source-audit'
    )
  })

  it('shows source apply outcomes without ordinary media metrics and deep-links to the parent audit', () => {
    mocks.data = [
      {
        ...baseRun,
        operationKind: 'AUDIT_APPLY',
        sourceAuditRunId: 'audit-1',
        totalArtworks: 5,
        succeededArtworks: 3,
        skippedArtworks: 1,
        failedArtworks: 1,
        newImages: 99,
        walkedEntries: 100
      }
    ]

    render(<ScanHistorySummaryCard />)

    expect(screen.getByText(/来源选定同步/)).toBeTruthy()
    expect(screen.getByText('已应用')).toBeTruthy()
    expect(screen.queryByText('新增图片')).toBeNull()
    expect(screen.queryByText('本次扫描工作量')).toBeNull()
    expect(screen.getByRole('link', { name: /查看同步结果/ }).getAttribute('href')).toBe(
      '/admin/scan-history/audit-1/source-audit?operation=run-1'
    )
  })
})
