import type { ArtworkDedupArtworkPreviewDto } from '@pixishelf/job-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateOperationPreview } from '../duplicate-operation-preview'
import { DuplicateGroupRow } from '../duplicate-group-row'
import { group, member, operation } from './duplicate-maintenance-fixtures'
const mocks = vi.hoisted(() => ({ get: vi.fn(), ready: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: {
      getOperation: {
        queryOptions: (input: unknown) => ({ queryKey: ['preview', input], queryFn: () => mocks.get(input) })
      },
      allowReimport: { mutationOptions: () => ({ mutationFn: vi.fn() }) }
    }
  })
}))
let client: QueryClient
function item(id: number, overrides: Partial<ArtworkDedupArtworkPreviewDto> = {}): ArtworkDedupArtworkPreviewDto {
  return {
    ...member(id),
    itemId: id,
    groupId: 'group-1',
    role: id === 1 ? 'KEEPER' : 'COPY',
    status: 'VERIFIED',
    reasons: [],
    canAllowReimport: false,
    sources: [],
    personalRecords: 'CURRENT',
    mediaCount: '2',
    fileCount: '3',
    ...overrides
  }
}
function mount(value = operation()) {
  return render(
    <QueryClientProvider client={client}>
      <DuplicateOperationPreview
        operation={value}
        userId="user-a"
        disabled={false}
        onUpdate={vi.fn()}
        onRefresh={vi.fn()}
        onReady={mocks.ready}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
})
describe('frozen direct delete preview', () => {
  it('paginates server artwork and file manifests independently without exposing a raw failure path', async () => {
    mocks.get.mockImplementation((input: { preview: { kind: string; cursor?: string } }) => ({
      operation: operation(),
      preview:
        input.preview.kind === 'ARTWORKS'
          ? {
              kind: 'ARTWORKS',
              items: input.preview.cursor ? [item(22)] : [item(1), item(2)],
              nextCursor: input.preview.cursor ? null : 'artwork-page-2'
            }
          : {
              kind: 'FILES',
              items: [
                {
                  fileId: 'file-1',
                  artworkId: 2,
                  role: 'CHAPTER',
                  artworkRole: 'COPY',
                  artworkTitle: '冻结副本',
                  relativeName: 'chapters.json',
                  sizeBytes: '2048',
                  status: 'BLOCKED',
                  requiresReview: true,
                  blockReason: '/private/media/secret.jpg'
                }
              ],
              nextCursor: null
            }
    }))
    mount()
    await screen.findByText('作品 1')
    expect(screen.queryByText(/服务器冻结/)).toBeNull()
    expect(mocks.ready).toHaveBeenLastCalledWith(1)
    expect(mocks.get.mock.calls[0]![0]).toMatchObject({
      expectedUserId: 'user-a',
      operationId: 'op-1',
      preview: { kind: 'ARTWORKS', limit: 20 }
    })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品 22')
    expect(mocks.get.mock.calls[1]![0]).toMatchObject({ preview: { cursor: 'artwork-page-2' } })
    fireEvent.click(screen.getByRole('button', { name: '查看文件清单' }))
    await screen.findByText('chapters.json')
    expect(screen.getByText('章节文件 · 2 KB · 无法处理')).toBeTruthy()
    expect(screen.getByText('删除副本的文件', { exact: false }).textContent).toContain('冻结副本')
    expect(screen.getByText('chapters.json').closest('[data-privacy-sensitive]')).not.toBeNull()
    expect(screen.getByText('冻结副本').closest('[data-privacy-sensitive]')).not.toBeNull()
    expect(screen.getByText('章节文件 · 2 KB · 无法处理').closest('[data-privacy-sensitive]')).toBeNull()
    expect(screen.queryByText('/private/media/secret.jpg')).toBeNull()
    expect(screen.getByText('REVIEW_REQUIRED')).toBeTruthy()
    expect(mocks.get.mock.lastCall![0]).toMatchObject({ preview: { kind: 'FILES', cursor: undefined, limit: 20 } })
  })
  it('shows post-delete snapshot evidence and removed private records without inventing empty history', async () => {
    const value = operation({ mode: 'DIRECT_DELETE', status: 'DELETED' })
    mocks.get.mockResolvedValue({
      operation: value,
      preview: {
        kind: 'ARTWORKS',
        items: [
          item(2, {
            status: 'DELETED',
            personalRecords: 'REMOVED',
            sourceLabel: 'LOCAL_CREATED',
            sources: [{ sourceId: 'path-1', displayName: '原件 · a.jpg', generation: '2', status: 'TOMBSTONE' }]
          })
        ],
        nextCursor: null
      }
    })
    mount(value)
    await screen.findByText('作品 2')
    expect(screen.getByText('手动创建 · 2 项媒体')).toBeTruthy()
    expect(screen.queryByText('防止重复导入')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看作品 2的详情' }))
    expect(screen.getByText('防止重复导入')).toBeTruthy()
    expect(screen.getByText('原件 · a.jpg').closest('[data-privacy-sensitive]')).not.toBeNull()
    expect(screen.getByText('防止重复导入').closest('[data-privacy-sensitive]')).toBeNull()
    expect(screen.getByText(/整理记录已随副本删除/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /查看作品：作品 2/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '作品 2的详情' })).toBeTruthy()
    expect(screen.queryByText('未评分')).toBeNull()
    expect(screen.queryByText('未阅读')).toBeNull()
  })
  it('does not enable confirmation for a failed or mismatched-version preview', async () => {
    mocks.get.mockResolvedValue({
      operation: operation({ version: 2 }),
      preview: { kind: 'ARTWORKS', items: [item(1)], nextCursor: null }
    })
    mount()
    await screen.findByRole('button', { name: '清单已更新，点击刷新' })
    expect(mocks.ready).not.toHaveBeenCalledWith(1)
    expect(mocks.ready).toHaveBeenLastCalledWith(null)
  })
  it('retains a concrete keeper summary outside the first three members', () => {
    render(
      <DuplicateGroupRow
        group={group('long-group', {
          keeper: member(22),
          memberCount: 25,
          previewMembers: [member(1), member(2), member(3)]
        })}
        keeperId={22}
        selected={false}
        selectable
        saving={false}
        failed={false}
        disabled={false}
        onSelect={vi.fn()}
        onKeep={vi.fn()}
        onDetails={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('作品 22')).toBeTruthy()
    expect(screen.getByText('已选保留作品')).toBeTruthy()
  })
  it('refetches a stale manifest before allowing confirmation', async () => {
    mocks.get
      .mockResolvedValueOnce({
        operation: operation({ version: 0 }),
        preview: { kind: 'ARTWORKS', items: [item(1)], nextCursor: null }
      })
      .mockResolvedValue({
        operation: operation(),
        preview: { kind: 'ARTWORKS', items: [item(1), item(2)], nextCursor: null }
      })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '清单已更新，点击刷新' }))
    await screen.findByText('作品 2')
    await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(1))
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })
})
