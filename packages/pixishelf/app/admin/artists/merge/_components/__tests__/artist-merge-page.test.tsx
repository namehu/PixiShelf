import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selection: { sourceId: 1, targetId: 2, mergeId: null as string | null },
  preview: null as any,
  result: null as any,
  submit: vi.fn(),
  reset: vi.fn(),
  setSelection: vi.fn(),
  invalidate: vi.fn()
}))
vi.mock('nuqs', () => ({
  parseAsInteger: {},
  parseAsString: {},
  useQueryStates: () => [mocks.selection, mocks.setSelection]
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artist: Object.fromEntries(
      ['getById', 'queryPage', 'getMerge', 'listMerges', 'previewMerge', 'submitMerge'].map((name) => [
        name,
        { queryOptions: (input: unknown) => ({ name, input }), mutationOptions: () => ({ name }) }
      ])
    )
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useQuery: ({ name, input }: any) => ({
    data:
      name === 'getById'
        ? { id: input, name: `artist ${input}`, kind: 'PERSON' }
        : name === 'queryPage'
          ? { data: [] }
          : name === 'getMerge'
            ? mocks.result
            : [],
    isLoading: false
  }),
  useMutation: ({ name }: any) => ({
    data: name === 'previewMerge' ? mocks.preview : undefined,
    isPending: false,
    reset: mocks.reset,
    mutate: mocks.submit
  })
}))

import { ArtistMergePage } from '../artist-merge-page'
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.selection = { sourceId: 1, targetId: 2, mergeId: null }
  mocks.result = null
  mocks.preview = {
    previewId: 'preview',
    fingerprint: 'digest',
    blockers: [],
    summary: {
      source: { id: 1, name: 'source' },
      target: { id: 2, name: 'target' },
      sourceCount: 4,
      targetCount: 3,
      commonCount: 1,
      mergedCount: 6,
      allMemberships: 4,
      localMappings: 1,
      tagMappings: 1,
      defaults: 2,
      pending: 3,
      suppressions: 1,
      identities: [],
      conflicts: []
    }
  }
})
describe('artist merge confirmation', () => {
  it('shows deduplicated totals and binding impact and submits the frozen preview', () => {
    render(<ArtistMergePage />)
    expect(screen.getByText(/合并后 6 件/)).toBeTruthy()
    expect(screen.getByText(/2 个来源固定绑定、3 个待生效绑定、1 条人工移除记录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认合并，保留 #2' }))
    expect(mocks.submit).toHaveBeenCalledWith({ previewId: 'preview', fingerprint: 'digest' })
  })
  it('blocks confirmation when an archive scan has unfinished bindings', () => {
    mocks.preview.blockers = [{ jobId: 'scan', type: 'ARCHIVE_UPLOADER_SCAN', status: 'PAUSED', reason: '扫描未结束' }]
    render(<ArtistMergePage />)
    expect((screen.getByRole('button', { name: '确认合并，保留 #2' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: /查看任务/ }).getAttribute('href')).toBe('/admin/tasks?jobId=scan')
  })
  it('invalidates the preview when swapping direction', () => {
    render(<ArtistMergePage />)
    fireEvent.click(screen.getByRole('button', { name: '交换合并方向' }))
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(mocks.setSelection).toHaveBeenCalledWith({ sourceId: 2, targetId: 1 })
  })
  it('restores completed results from the URL and refreshes cached bindings', () => {
    mocks.selection.mergeId = 'saved'
    mocks.result = {
      id: 'saved',
      status: 'COMPLETE',
      summary: mocks.preview.summary,
      job: { id: 'job', status: 'COMPLETED' }
    }
    render(<ArtistMergePage />)
    expect(screen.getByRole('status').textContent).toContain('合并完成')
    expect(screen.queryByRole('button', { name: /确认合并/ })).toBeNull()
    expect(mocks.invalidate).toHaveBeenCalledOnce()
  })
})
