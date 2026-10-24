import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuplicateMembersSheet } from '../duplicate-members-sheet'
import { group, member } from './duplicate-maintenance-fixtures'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artworkDedup: {
      listGroups: {
        queryOptions: (input: unknown) => ({ queryKey: ['members', input], queryFn: () => mocks.list(input) })
      }
    }
  })
}))
afterEach(cleanup)
describe('duplicate member pagination', () => {
  it('loads only twenty members, retains a keeper outside the page, and sends an independent member cursor', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.list.mockImplementation((input: { memberCursor?: string }) => ({
      kind: 'MEMBERS',
      runId: 'run-1',
      runVersion: 3,
      reviewRevision: 0,
      allowedActions: ['SAVE_REVIEW'],
      group: group(),
      keeper: member(1),
      items: [member(input.memberCursor ? 22 : 2)],
      nextMemberCursor: input.memberCursor ? null : 'members-page-2'
    }))
    const onKeep = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <DuplicateMembersSheet
          userId="user-a"
          runId="run-1"
          groupId="group-1"
          keeperId={1}
          saving={false}
          failed={false}
          onClose={vi.fn()}
          onKeep={onKeep}
          onRetry={vi.fn()}
        />
      </QueryClientProvider>
    )
    await screen.findByText('已保存的保留作品')
    expect(screen.getByText('作品 1')).toBeTruthy()
    expect(mocks.list.mock.calls[0]![0]).toMatchObject({ limit: 20, expectedUserId: 'user-a', groupId: 'group-1' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('作品 22')
    expect(screen.getByText('作品 1')).toBeTruthy()
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    expect(mocks.list.mock.calls[1]![0]).toMatchObject({ memberCursor: 'members-page-2', limit: 20 })
    expect(mocks.list.mock.calls[1]![0]).not.toHaveProperty('cursor')
    fireEvent.click(screen.getByRole('radio', { name: '保留 作品 22' }))
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1' }), 22)
    client.clear()
  })
})
