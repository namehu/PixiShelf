import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveManagement } from '../archive-management'
import type { ArchiveTaskOutput } from '../archive-task-list'

interface TaskListInput {
  limit: number
  taskId?: string
  cursor?: string
  statuses?: string[]
  providerKey?: string
  kind?: string
  submissionId?: string
  search?: string
  unboundOnly?: boolean
}

const mocks = vi.hoisted(() => ({ list: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams()
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('../archive-add-dialog', () => ({ ArchiveAddDialog: () => null }))
vi.mock('../archive-item-drawer', () => ({ ArchiveItemDrawer: () => null }))
vi.mock('../archive-bulk-result-dialog', () => ({ ArchiveBulkResultDialog: () => null }))
vi.mock('@/components/source-preview/source-preview-button', () => ({ SourcePreviewButton: () => null }))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))
vi.mock('../../../_components/background-job-event-provider', () => {
  const stream = { status: 'connected', items: [], readyVersion: 0, resetVersion: 0 }
  return { useBackgroundJobEventSubscription: () => stream }
})
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      listTasks: {
        queryOptions: (input: TaskListInput, options: object) => ({
          queryKey: ['tasks', input],
          queryFn: () => mocks.list(input),
          ...options
        })
      },
      action: { mutationOptions: (options: object) => options },
      actionMany: { mutationOptions: (options: object) => options }
    },
    job: {
      backgroundDashboard: {
        queryOptions: (_input: unknown, options: object) => ({
          queryKey: ['dashboard'],
          queryFn: async () => ({ lanes: [], activeCount: 0, queuedCount: 0 }),
          ...options
        })
      }
    }
  })
}))

const task = {
  id: 'task-1',
  systemJobId: 'job-1',
  title: '测试作品',
  providerKey: 'pixiv',
  externalId: '123',
  status: 'COMPLETED',
  systemJobStatus: 'COMPLETED',
  totalItems: 20,
  completedItems: 20,
  failedItems: 0,
  progress: 100,
  createdAt: '2026-10-10T00:00:00.000Z'
} as ArchiveTaskOutput

let client: QueryClient
beforeEach(() => {
  mocks.list.mockReset().mockImplementation(async (input: TaskListInput) => ({
    items: [task],
    nextCursor: input.cursor ? null : 'cursor-2'
  }))
  mocks.replace.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

function mountPage(searchParams = '') {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const page = (search: string) => (
    <NuqsTestingAdapter hasMemory searchParams={search} onUrlUpdate={onUrlUpdate}>
      <QueryClientProvider client={client}>
        <ArchiveManagement />
      </QueryClientProvider>
    </NuqsTestingAdapter>
  )
  const view = render(page(searchParams))
  return { ...view, onUrlUpdate, navigate: (search: string) => view.rerender(page(search)) }
}

function latestInput(): TaskListInput | undefined {
  return mocks.list.mock.calls
    .map(([input]) => input as TaskListInput)
    .filter((input) => input.limit === 50)
    .at(-1)
}

function latestUrl(update: ReturnType<typeof mountPage>['onUrlUpdate']) {
  return update.mock.calls.at(-1)?.[0].searchParams
}

function chooseFilter(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('archive task URL filters', () => {
  it('restores all applied filters in the form and query on initial load and remount', async () => {
    const search =
      '?status=FAILED&kind=UPDATE&providerKey=pixiv&submissionId=batch-1&search=%E6%A0%87%E9%A2%98&unboundOnly=true'
    const first = mountPage(search)
    await screen.findByRole('checkbox', { name: '选择 测试作品' })
    expect(latestInput()).toMatchObject({
      statuses: ['FAILED'],
      kind: 'UPDATE',
      providerKey: 'pixiv',
      submissionId: 'batch-1',
      search: '标题',
      unboundOnly: true
    })
    expect(screen.getByRole('combobox', { name: '状态' }).textContent).toBe('失败')
    expect(screen.getByRole('combobox', { name: '归档类型' }).textContent).toBe('更新归档')
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('标题')
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    expect(screen.getByLabelText<HTMLInputElement>('来源站点').value).toBe('pixiv')
    expect(screen.getByLabelText<HTMLInputElement>('本次加入 ID').value).toBe('batch-1')
    expect(screen.getByRole('checkbox', { name: '仅看未绑定艺术家' }).getAttribute('aria-checked')).toBe('true')
    expect(first.onUrlUpdate).not.toHaveBeenCalled()
    first.unmount()
    mountPage(search)
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('标题')
    expect(screen.getByRole('combobox', { name: '状态' }).textContent).toBe('失败')
  })

  it('keeps text drafts until submit while immediate filters update the URL without discarding them', async () => {
    const { onUrlUpdate } = mountPage('?taskId=task-1&entry=direct&context=keep')
    await screen.findByRole('checkbox', { name: '选择 测试作品' })
    fireEvent.change(screen.getByLabelText('标题或来源'), { target: { value: '  标题 & 来源  ' } })
    expect(onUrlUpdate).not.toHaveBeenCalled()
    chooseFilter('状态', '失败')
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.get('status')).toBe('FAILED'))
    chooseFilter('归档类型', '更新归档')
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.get('kind')).toBe('UPDATE'))
    fireEvent.click(screen.getByRole('button', { name: /更多筛选/ }))
    fireEvent.change(screen.getByLabelText('来源站点'), { target: { value: ' pixiv ' } })
    fireEvent.change(screen.getByLabelText('本次加入 ID'), { target: { value: ' batch-1 ' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '仅看未绑定艺术家' }))
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.get('unboundOnly')).toBe('true'))
    expect(latestUrl(onUrlUpdate)?.has('search')).toBe(false)
    expect(latestUrl(onUrlUpdate)?.has('providerKey')).toBe(false)
    expect(latestInput()).toMatchObject({ statuses: ['FAILED'], kind: 'UPDATE', unboundOnly: true })
    expect(latestInput()?.search).toBeUndefined()
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('  标题 & 来源  ')
    expect(screen.getByLabelText<HTMLInputElement>('来源站点').value).toBe(' pixiv ')
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.get('search')).toBe('标题 & 来源'))
    expect(latestUrl(onUrlUpdate)?.get('providerKey')).toBe('pixiv')
    expect(latestUrl(onUrlUpdate)?.get('submissionId')).toBe('batch-1')
    expect(latestUrl(onUrlUpdate)?.get('taskId')).toBe('task-1')
    expect(latestUrl(onUrlUpdate)?.get('entry')).toBe('direct')
    expect(latestUrl(onUrlUpdate)?.get('context')).toBe('keep')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options).toMatchObject({ history: 'push', shallow: true, scroll: false })
    await waitFor(() => expect(latestInput()?.search).toBe('标题 & 来源'))
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('标题 & 来源')
  })

  it('clears only filter parameters and omits default values', async () => {
    const { onUrlUpdate } = mountPage(
      '?status=FAILED&kind=UPDATE&providerKey=pixiv&submissionId=batch-1&search=abc&unboundOnly=true&taskId=task-1&context=keep'
    )
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.toString()).toBe('taskId=task-1&context=keep'))
    expect(screen.getByRole('combobox', { name: '状态' }).textContent).toBe('全部状态')
    expect(screen.getByRole('combobox', { name: '归档类型' }).textContent).toBe('全部类型')
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('')
    chooseFilter('状态', '失败')
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.get('status')).toBe('FAILED'))
    chooseFilter('状态', '全部状态')
    await waitFor(() => expect(latestUrl(onUrlUpdate)?.has('status')).toBe(false))
  })

  it('restores external URL navigation and resets cursor browsing and page selection', async () => {
    const { navigate, onUrlUpdate } = mountPage('?status=FAILED&search=original')
    await screen.findByRole('checkbox', { name: '选择 测试作品' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(latestInput()?.cursor).toBe('cursor-2'))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 测试作品' }))
    expect(screen.getByRole('region', { name: '当前页批量操作' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('标题或来源'), { target: { value: 'unsubmitted' } })
    navigate('?status=RUNNING&search=restored')
    await waitFor(() => expect(latestInput()).toMatchObject({ statuses: ['RUNNING'], search: 'restored' }))
    expect(latestInput()?.cursor).toBeUndefined()
    expect(mocks.list.mock.calls.map(([input]) => input)).not.toContainEqual(
      expect.objectContaining({ statuses: ['RUNNING'], cursor: 'cursor-2' })
    )
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('restored')
    expect(screen.getByText('第 1 页 · 每页最多 50 项')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '当前页批量操作' })).toBeNull()
    navigate('?status=FAILED&search=original')
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('original'))
    expect(screen.getByRole('combobox', { name: '状态' }).textContent).toBe('失败')
    expect(screen.getByRole('checkbox', { name: '选择 测试作品' }).getAttribute('aria-checked')).toBe('false')
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('falls back to defaults for invalid enums, booleans and oversized text before querying', async () => {
    const params = new URLSearchParams({
      status: 'RETRY_WAIT',
      kind: 'unknown',
      unboundOnly: 'invalid',
      providerKey: 'p'.repeat(51),
      submissionId: 's'.repeat(129),
      search: 'x'.repeat(501)
    })
    mountPage(params.toString())
    await screen.findByRole('checkbox', { name: '选择 测试作品' })
    expect(latestInput()).toEqual({
      limit: 50,
      cursor: undefined,
      statuses: undefined,
      providerKey: undefined,
      kind: undefined,
      submissionId: undefined,
      search: undefined,
      unboundOnly: false
    })
    expect(screen.getByRole('combobox', { name: '状态' }).textContent).toBe('全部状态')
    expect(screen.getByLabelText<HTMLInputElement>('标题或来源').value).toBe('')
  })
})
