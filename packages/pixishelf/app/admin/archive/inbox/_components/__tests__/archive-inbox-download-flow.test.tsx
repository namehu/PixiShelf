import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  mutate: vi.fn(),
  listOptions: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: (options: { kind: string }) => ({
    data:
      options.kind === 'list'
        ? { items: mocks.items, nextCursor: null }
        : options.kind === 'summary'
          ? {
              activeCount: mocks.items.length,
              capacity: 1000,
              paused: false,
              queuedCount: 0,
              counts: { READY: 0, SKIPPED: 0 },
              currentItem: null,
              recentFailedCount: 0,
              remainingCapacity: 999
            }
          : { lanes: [] },
    isPending: false,
    isError: false,
    isFetching: false
  }),
  useMutation: () => ({ mutate: mocks.mutate, isPending: false })
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => {
    const mutation = { mutationOptions: (options: unknown) => options }
    return {
      archiveInbox: {
        list: {
          queryOptions: (input: unknown) => {
            mocks.listOptions(input)
            return { kind: 'list' }
          },
          queryKey: () => ['list']
        },
        summary: { queryOptions: () => ({ kind: 'summary' }), queryKey: () => ['summary'] },
        create: mutation,
        enqueueMany: mutation,
        cancelMany: mutation,
        retryMany: mutation,
        pause: mutation,
        resume: mutation,
        replace: mutation
      },
      job: { backgroundDashboard: { queryOptions: () => ({ kind: 'dashboard' }), queryKey: () => ['dashboard'] } }
    }
  }
}))
vi.mock('@/app/admin/archive/_components/archive-replace-dialog', () => ({ ArchiveReplaceDialog: () => null }))
vi.mock('@/app/admin/archive/_components/archive-bulk-result-dialog', () => ({ ArchiveBulkResultDialog: () => null }))

import { ArchiveInbox } from '../archive-inbox'

const item = {
  id: 'item-1',
  queueOrder: '1',
  status: 'READY',
  resolutionKind: 'UPDATE',
  downloadMode: 'AUTO',
  selectedQuality: 'DISPLAY',
  resolvedTitle: '已收藏作品',
  submittedUrl: 'https://e-hentai.org/g/123/[redacted]/',
  providerKey: 'e-hentai',
  externalId: '123',
  submissionId: 'submission-1',
  pageCount: 2,
  attempts: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  finishedAt: new Date(),
  activeArchiveImportId: null,
  archiveImportId: null,
  duplicateOfItemId: null,
  errorMessage: null
}

describe('archive inbox download flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.items = [item]
  })
  afterEach(cleanup)

  it('requires choosing an automatic update and confirms the submitted display quality', async () => {
    render(<ArchiveInbox />)
    expect(screen.getAllByText('待确认更新')).toHaveLength(2)
    expect(screen.getAllByText('已有作品发生变化，请勾选后确认下载更新。')).toHaveLength(2)
    const checkbox = screen.getAllByRole('checkbox', { name: '选择队列项目 1' })[0]!
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('button', { name: '确认下载 0' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '确认下载 1' }))
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ itemId: 'item-1', quality: 'DISPLAY' }] })
    )
    await waitFor(() =>
      expect(screen.getAllByRole('combobox', { name: '队列项目 1 的归档质量' })[0]!.textContent).toBe('展示图')
    )
  })

  it('shows unchanged skipped items without selection or download controls', () => {
    mocks.items = [{ ...item, status: 'SKIPPED', resolutionKind: 'UNCHANGED' }]
    render(<ArchiveInbox />)
    expect(screen.getAllByText('已跳过')).toHaveLength(2)
    expect(screen.getAllByText('与本地归档一致，已跳过下载。')).toHaveLength(2)
    for (const checkbox of screen.getAllByRole('checkbox', { name: '选择队列项目 1' })) {
      expect((checkbox as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.queryByRole('button', { name: /确认下载/ })).toBeNull()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '已跳过 / 取消 / 重复' }), { button: 0, ctrlKey: false })
    expect(mocks.listOptions).toHaveBeenCalledWith(expect.objectContaining({ view: 'CANCELLED' }))
  })
})
