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
})
