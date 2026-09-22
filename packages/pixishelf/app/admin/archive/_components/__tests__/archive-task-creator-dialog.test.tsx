import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveTaskCreatorDialog } from '../archive-task-creator-dialog'
import { DiscoveryCreatorStatus } from '../discovery-creator-status'
import { TaskFiltersForm, hasTaskFilters, type TaskFilters } from '../archive-task-filters'

const mocks = vi.hoisted(() => ({ edit: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      editTaskCreators: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.edit }) },
      listTasks: {
        queryOptions: () => ({ queryKey: ['archive', 'listTasks'], queryFn: mocks.list }),
        queryKey: () => ['archive', 'listTasks']
      }
    },
    ...Object.fromEntries(
      ['archiveSearch', 'archiveUploader', 'artwork', 'artist'].map((key) => [key, { pathKey: () => [key] }])
    )
  })
}))
vi.mock('@/components/creators/creator-picker', () => ({
  CreatorPicker: ({ onChange }: { onChange: (value: { id: number; name: string }[]) => void }) => (
    <button onClick={() => onChange([{ id: 7, name: 'Alice' }])}>选择 Alice</button>
  )
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="private-name">{children}</span>
  )
}))
const task = {
  id: 'task',
  title: '作品',
  effectiveCreators: [{ id: 1, name: 'Bob', kind: 'PERSON' }],
  pendingCreators: [{ id: 2, name: 'Group', kind: 'GROUP' }],
  creatorEditBlockedReason: null
}
const success = { items: [{ result: 'APPLIED' }] }
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <ArchiveTaskCreatorDialog taskId="task" onClose={vi.fn()} onUpdated={vi.fn()} />
    </QueryClientProvider>
  )
}
async function add() {
  fireEvent.click(await screen.findByText('选择 Alice'))
  fireEvent.click(screen.getByRole('button', { name: '追加所选艺术家' }))
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  mocks.edit.mockReset()
  mocks.list.mockReset().mockResolvedValue({ items: [task] })
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('task creator dialog', () => {
  it('separates effective and pending creators and confirms one removal', async () => {
    mocks.edit.mockResolvedValue(success)
    show()
    const effective = await screen.findByRole('region', { name: '已绑定' })
    expect(within(effective).getByText('Bob')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '待生效' })).getByText('社团：Group')).toBeTruthy()
    fireEvent.click(within(effective).getByRole('button', { name: '移除' }))
    expect(mocks.edit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1))
    expect(mocks.edit.mock.calls[0]![0]).toMatchObject({ taskId: 'task', action: 'REMOVE', artistIds: [1] })
  })
  it('preserves an unknown request across remounts', async () => {
    mocks.edit.mockRejectedValueOnce(new Error('network')).mockResolvedValue(success)
    const first = show()
    await add()
    await screen.findByText('操作未完成')
    const request = mocks.edit.mock.calls[0]![0]
    first.unmount()
    show()
    fireEvent.click(await screen.findByRole('button', { name: '确认原操作结果' }))
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2))
    expect(mocks.edit.mock.calls[1]![0]).toEqual(request)
    await waitFor(() => expect(sessionStorage.getItem('archive-task-creators:task')).toBeNull())
  })
  it('retries a confirmed failure with a new id and preserves the selected artists', async () => {
    mocks.edit.mockResolvedValueOnce({ items: [{ result: 'FAILED', message: '失败' }] }).mockResolvedValue(success)
    show()
    await add()
    fireEvent.click(await screen.findByRole('button', { name: '重试未完成操作' }))
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2))
    expect(mocks.edit.mock.calls[1]![0].requestId).not.toBe(mocks.edit.mock.calls[0]![0].requestId)
    expect(mocks.edit.mock.calls[1]![0].artistIds).toEqual([7])
  })
  it('blocks editing when the authoritative task is in trash', async () => {
    mocks.list.mockResolvedValue({ items: [{ ...task, creatorEditBlockedReason: '请先恢复作品' }] })
    show()
    await screen.findByText('请先恢复作品')
    expect(screen.queryByText('选择 Alice')).toBeNull()
    expect(
      screen.getAllByRole('button', { name: '移除' }).every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true)
  })
  it('summarizes at most three members using privacy-aware names', () => {
    render(
      <DiscoveryCreatorStatus
        effectiveCreators={[
          { id: 1, name: 'A' },
          { id: 2, name: 'B' }
        ]}
        pendingCreators={[
          { id: 3, name: 'C' },
          { id: 4, name: 'D' }
        ]}
        maxVisible={3}
      />
    )
    expect(screen.getByText('另 1 位')).toBeTruthy()
    expect(screen.queryByText('D')).toBeNull()
    expect(screen.getAllByTestId('private-name')).toHaveLength(3)
  })
  it('shows the unbound state and applies the filter immediately', () => {
    const filters: TaskFilters = { status: 'ALL', kind: 'ALL', search: '', providerKey: '', submissionId: '' }
    const change = vi.fn()
    const reset = vi.fn()
    render(
      <>
        <DiscoveryCreatorStatus />
        <TaskFiltersForm
          value={{ ...filters, unboundOnly: true }}
          appliedValue={filters}
          onChange={vi.fn()}
          onImmediateChange={change}
          onSubmit={vi.fn()}
          onReset={reset}
        />
      </>
    )
    expect(screen.getByText('未绑定艺术家')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '仅看未绑定艺术家' }))
    expect(change).toHaveBeenCalledWith({ unboundOnly: false })
    expect(hasTaskFilters({ ...filters, unboundOnly: true })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(reset).toHaveBeenCalledOnce()
  })
})
