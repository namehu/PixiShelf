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
  it('keeps identity conflicts visible and blocks confirmation', () => {
    mocks.preview.summary.conflicts = ['pixiv 绑定了不同外部账号，不能合并']
    render(<ArtistMergePage />)
    expect(screen.getByText('来源身份冲突')).toBeTruthy()
    expect((screen.getByRole('button', { name: '确认合并，保留 #2' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('calls out populated source fields that will stay empty in the retained profile', () => {
    mocks.preview.summary.source = {
      id: 1,
      name: 'source',
      bio: '创作者简介',
      avatar: '/avatar.png',
      backgroundImg: '/background.png'
    }
    render(<ArtistMergePage />)
    expect(screen.getByText('保留方的简介、头像、背景图为空')).toBeTruthy()
    expect(screen.getByText(/合并后仍为空/)).toBeTruthy()
    expect(screen.getByText(/不提供一键撤销/)).toBeTruthy()
  })
  it('hides a preview for a previous selection', () => {
    mocks.selection.sourceId = 3
    render(<ArtistMergePage />)
    expect(screen.queryByRole('button', { name: /确认合并/ })).toBeNull()
    expect(screen.getByRole('button', { name: '预览合并影响' })).toBeTruthy()
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
    expect(screen.getByRole('link', { name: '查看保留的艺术家' }).getAttribute('href')).toBe('/artists/2')
    expect(screen.queryByText(/不提供一键撤销/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始新的合并' }))
    expect(mocks.setSelection).toHaveBeenCalledWith({ sourceId: null, targetId: null, mergeId: null })
  })
  it('shows failed execution with recovery actions instead of a success result', () => {
    mocks.selection.mergeId = 'saved'
    mocks.result = {
      id: 'saved',
      status: 'QUEUED',
      summary: mocks.preview.summary,
      job: { id: 'job', status: 'FAILED', error: '资料已变化，请重新预览' }
    }
    render(<ArtistMergePage />)
    expect(screen.getByText('资料已变化，请重新预览')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看任务、取消或重试' }).getAttribute('href')).toBe(
      '/admin/tasks?jobId=job'
    )
    expect(screen.queryByRole('link', { name: '查看保留的艺术家' })).toBeNull()
  })
})
