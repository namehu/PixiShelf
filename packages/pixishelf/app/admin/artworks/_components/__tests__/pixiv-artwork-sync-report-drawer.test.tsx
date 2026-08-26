import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reports: [] as any[],
  report: null as any,
  snapshot: null as any,
  snapshotInputs: [] as unknown[]
}))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ items: mocks.reports, nextCursor: null, total: mocks.reports.length }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn()
  }),
  useQuery: (options: { kind?: string }) =>
    options.kind === 'snapshot'
      ? { data: mocks.snapshot, isLoading: false, isError: false, error: null }
      : { data: mocks.report, isLoading: false, isError: false, error: null }
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artwork: {
      pixivSyncReportHistory: { infiniteQueryOptions: () => ({ kind: 'history' }) },
      pixivSyncReport: { queryOptions: () => ({ kind: 'report' }) },
      pixivSyncSnapshot: {
        queryOptions: (input: unknown) => {
          mocks.snapshotInputs.push(input)
          return { kind: 'snapshot' }
        }
      }
    }
  })
}))

import { PixivArtworkSyncReportDrawer } from '../pixiv-artwork-sync-report-drawer'

afterEach(cleanup)

describe('PixivArtworkSyncReportDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.snapshotInputs = []
    mocks.reports = [
      {
        id: 'job-1',
        checkedAt: '2026-08-26T00:00:00.000Z',
        status: 'SUCCESS',
        changeKind: 'UPDATED',
        refreshExisting: true,
        fieldCount: 1,
        addedTagCount: 1,
        removedTagCount: 1,
        protectedFieldCount: 0,
        snapshotChanged: true
      }
    ]
    mocks.report = {
      schemaVersion: 1,
      jobId: 'job-1',
      artworkId: 1,
      externalRefId: 'ref-1',
      pixivArtworkId: '123',
      checkedAt: '2026-08-26T00:00:00.000Z',
      refreshExisting: true,
      status: 'SUCCESS',
      changeKind: 'UPDATED',
      fields: [{ key: 'title', before: { value: '旧标题' }, after: { value: '新标题' } }],
      tags: { before: ['旧标签'], after: ['新标签'], added: ['新标签'], removed: ['旧标签'] },
      protectedFields: [],
      snapshots: {
        before: { hash: 'a'.repeat(64), path: `artworks/123/metadata/${'a'.repeat(64)}.json` },
        after: { hash: 'b'.repeat(64), path: `artworks/123/metadata/${'b'.repeat(64)}.json` },
        changed: true
      }
    }
    mocks.snapshot = {
      available: true,
      hash: 'b'.repeat(64),
      path: `artworks/123/metadata/${'b'.repeat(64)}.json`,
      content: { raw: { title: 'Raw title' }, normalized: { title: 'Normalized title' } }
    }
  })

  it('shows the history timeline and actual field and tag changes', () => {
    render(<PixivArtworkSyncReportDrawer artwork={artwork()} onOpenChange={vi.fn()} />)

    expect(screen.getByText('完整同步历史')).toBeTruthy()
    expect(screen.getAllByText('有更新').length).toBeGreaterThan(0)
    expect(screen.getByText('旧标题')).toBeTruthy()
    expect(screen.getByText('新标题')).toBeTruthy()
    expect(screen.getByText('新标签')).toBeTruthy()
    expect(screen.getByText('旧标签')).toBeTruthy()
  })

  it('loads complete snapshot JSON only after selecting a JSON tab', async () => {
    render(<PixivArtworkSyncReportDrawer artwork={artwork()} onOpenChange={vi.fn()} />)

    expect(screen.queryByText(/Normalized title/)).toBeNull()
    const tab = screen.getByRole('tab', { name: '同步后 JSON' })
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
    fireEvent.click(tab)
    await waitFor(() => expect(document.querySelector('pre')?.textContent).toContain('Normalized title'))
    expect(mocks.snapshotInputs.some((input: any) => input.side === 'after')).toBe(true)
  })

  it('explains legacy syncs that do not have report files', () => {
    mocks.reports = []
    render(<PixivArtworkSyncReportDrawer artwork={artwork()} onOpenChange={vi.fn()} />)
    expect(screen.getByText('暂无详细同步报告')).toBeTruthy()
    expect(screen.getByText(/报告功能上线之前/)).toBeTruthy()
  })
})

function artwork() {
  return {
    id: 1,
    title: 'Artwork',
    pixivEligible: true,
    pixivArtworkId: '123',
    pixivSync: { status: 'SUCCESS' }
  } as any
}
