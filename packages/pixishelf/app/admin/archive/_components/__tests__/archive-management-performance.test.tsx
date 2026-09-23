import { useEffect, type ComponentProps, type ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveManagement, type ArchiveTaskCard } from '../archive-management'

const mocks = vi.hoisted(() => ({ mounted: vi.fn(), items: [] as unknown[] }))
const searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({}), useSearchParams: () => searchParams }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('../archive-add-dialog', () => ({ ArchiveAddDialog: () => null }))
vi.mock('../archive-item-drawer', () => ({ ArchiveItemDrawer: () => null }))
vi.mock('../archive-bulk-result-dialog', () => ({ ArchiveBulkResultDialog: () => null }))
vi.mock('@/components/source-preview/source-preview-button', () => ({
  SourcePreviewButton: () => <button>原站预览</button>
}))
vi.mock('../archive-task-creators', () => ({
  ArchiveTaskCreators: ({ task }: { task: { id: string } }) => {
    useEffect(() => {
      mocks.mounted(task.id)
    }, [])
    return <button>管理艺术家</button>
  }
}))
vi.mock('../../../_components/background-job-event-provider', () => {
  const stream = { status: 'connected', items: [], readyVersion: 0, resetVersion: 0 }
  return { useBackgroundJobEventSubscription: () => stream }
})
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      listTasks: {
        queryOptions: (input: { limit: number }, options: object) => ({
          queryKey: ['tasks', input],
          queryFn: async () => ({ items: mocks.items, nextCursor: null }),
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

let client: QueryClient
let desktop = true
let listeners: Set<() => void>

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  mocks.mounted.mockClear()
  mocks.items = Array.from(
    { length: 50 },
    (_, index) =>
      ({
        id: `task-${index}`,
        systemJobId: `job-${index}`,
        title: `测试作品 ${index}`,
        providerKey: 'pixiv',
        externalId: String(index),
        status: 'COMPLETED',
        systemJobStatus: 'COMPLETED',
        publishedArtwork: { id: index + 1, archiveLifecycleState: 'ACTIVE', deletedAt: null },
        totalItems: 20,
        completedItems: 20,
        failedItems: 0,
        progress: 100,
        createdAt: '2026-09-23T00:00:00.000Z'
      }) as ComponentProps<typeof ArchiveTaskCard>['task']
  )
  desktop = true
  listeners = new Set()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return desktop
      },
      addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback)
    }))
  )
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  // 模拟浏览器后退时命中整页任务缓存，避免网络等待掩盖首帧重复挂载。
  client.setQueryData(['tasks', { limit: 50, unboundOnly: false }], { items: mocks.items, nextCursor: null })
  client.setQueryData(['dashboard'], { lanes: [], activeCount: 0, queuedCount: 0 })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

function mountPage() {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<ArchiveManagement />, { wrapper: Wrapper })
}

describe('archive task page mounting', () => {
  it.each([true, false])('mounts one layout for 50 cached tasks on return (desktop: %s)', (isDesktop) => {
    desktop = isDesktop
    const first = mountPage()
    // 统计全部已挂载节点（包括 CSS 隐藏节点），无需对整页逐个计算可访问名称。
    expect(screen.getAllByText('管理艺术家', { selector: 'button' })).toHaveLength(50)
    expect(mocks.mounted).toHaveBeenCalledTimes(50)
    expect(Boolean(screen.queryByRole('table'))).toBe(isDesktop)
    first.unmount()
    mocks.mounted.mockClear()
    mountPage()
    expect(screen.getAllByText('管理艺术家', { selector: 'button' })).toHaveLength(50)
    expect(mocks.mounted).toHaveBeenCalledTimes(50)
    expect(Boolean(screen.queryByRole('table'))).toBe(isDesktop)
  })

  it('replaces the layout at the breakpoint without retaining hidden task controls', () => {
    mountPage()
    act(() => {
      desktop = false
      listeners.forEach((callback) => callback())
    })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByText('管理艺术家', { selector: 'button' })).toHaveLength(50)
  })
})
