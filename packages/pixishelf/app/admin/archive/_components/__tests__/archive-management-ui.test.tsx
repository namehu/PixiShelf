import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArchiveImageCounts,
  ArchiveTaskCard,
  ArchiveTaskTable,
  WorkerLaneStrip,
  archiveImportIdFromPayload,
  canExpandArchivePublishedMedia,
  isActiveArchiveDownloadStatus,
  selectActiveArchiveImportId
} from '../archive-management'
import { ActiveArchiveDownloadPanel } from '../archive-active-download-panel'
import { TaskProgress } from '../archive-task-progress'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ 'aria-label': label }: { 'aria-label'?: string }) => (
    <button type="button" role="checkbox" aria-label={label} />
  )
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('../../../_components/admin-status-badge', () => ({
  AdminStatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('../archive-submission-badge', () => ({
  ArchiveSubmissionBadge: () => null
}))

vi.mock('../archive-published-media-preview', () => ({
  ArchivePublishedMediaPreview: ({ artworkId }: { artworkId: number }) => (
    <div data-testid="published-media">published-{artworkId}</div>
  )
}))

function createTask(
  id: string,
  publishedArtwork: { id: number; archiveLifecycleState: string; deletedAt: string | null } | null
) {
  return {
    id,
    title: `任务 ${id}`,
    providerKey: 'pixiv',
    externalId: id,
    submittedUrl: `https://example.test/${id}`,
    kind: 'NEW',
    submissionId: null,
    status: 'COMPLETED',
    systemJobStatus: 'COMPLETED',
    selectedQuality: 'ORIGINAL',
    decisionCode: null,
    attempt: 1,
    message: '已发布',
    progress: 100,
    warning: null,
    errorCode: null,
    errorMessage: null,
    retainUntil: null,
    completedItems: 8,
    failedItems: 2,
    totalItems: 10,
    createdAt: '2026-08-30T00:00:00.000Z',
    publishedArtwork
  }
}

const activeTask = createTask('active', {
  id: 42,
  archiveLifecycleState: 'ACTIVE',
  deletedAt: null
})

describe('archive management UI', () => {
  afterEach(() => cleanup())

  it('allows expansion only for an active, non-deleted published artwork', () => {
    expect(canExpandArchivePublishedMedia(activeTask)).toBe(true)
    expect(canExpandArchivePublishedMedia(createTask('unpublished', null))).toBe(false)
    expect(
      canExpandArchivePublishedMedia(
        createTask('trashing', { id: 43, archiveLifecycleState: 'TRASHING', deletedAt: null })
      )
    ).toBe(false)
    expect(
      canExpandArchivePublishedMedia(
        createTask('trashed', {
          id: 44,
          archiveLifecycleState: 'TRASHED',
          deletedAt: '2026-08-30T00:00:00.000Z'
        })
      )
    ).toBe(false)
  })

  it('renders one eligible desktop expander, compact counts, and no standalone image action', () => {
    const onToggleExpanded = vi.fn()
    const tasks = [
      activeTask,
      createTask('unpublished', null),
      createTask('trashing', { id: 43, archiveLifecycleState: 'TRASHING', deletedAt: null }),
      createTask('trashed', {
        id: 44,
        archiveLifecycleState: 'TRASHED',
        deletedAt: '2026-08-30T00:00:00.000Z'
      })
    ]
    render(
      <ArchiveTaskTable
        tasks={tasks as any}
        selectedTaskIds={new Set()}
        expandedTaskIds={new Set(['active'])}
        selectionState={false}
        pendingActions={new Set()}
        onToggleAll={vi.fn()}
        onToggleTask={vi.fn()}
        onToggleExpanded={onToggleExpanded}
        onViewItems={vi.fn()}
        onAction={vi.fn()}
      />
    )

    expect(screen.getByText('成功 / 失败 / 总数').getAttribute('aria-label')).toContain('顺序为成功、失败、总数')
    expect(screen.getAllByLabelText('图片数量：成功 8，失败 2，总数 10')).toHaveLength(4)
    expect(screen.getAllByLabelText('图片数量：成功 8，失败 2，总数 10')[0]!.children[2]!.className).toContain(
      'text-destructive'
    )
    expect(screen.getByTestId('published-media').textContent).toBe('published-42')
    expect(screen.getAllByLabelText(/完成 100%/)[0]!.parentElement?.className).toContain('w-56')
    expect(screen.getAllByRole('button', { name: /已发布媒体/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '查看图片明细' })).toBeNull()
    expect(screen.getAllByText('图片明细')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: '收起已发布媒体' }))
    expect(onToggleExpanded).toHaveBeenCalledWith('active')
  })

  it('uses the same inline published-media expansion in the mobile card', () => {
    render(
      <ArchiveTaskCard
        task={activeTask as any}
        selected={false}
        expanded
        pendingActions={new Set()}
        onToggle={vi.fn()}
        onToggleExpanded={vi.fn()}
        onViewItems={vi.fn()}
        onAction={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '收起已发布媒体' })).toBeTruthy()
    expect(screen.getByTestId('published-media').textContent).toBe('published-42')
    expect(screen.getByLabelText('图片数量：成功 8，失败 2，总数 10')).toBeTruthy()
    expect(screen.getByLabelText('任务 active 完成 100%').parentElement?.className).toContain('w-full')
    expect(screen.queryByRole('button', { name: '查看图片明细' })).toBeNull()
  })

  it('keeps worker lane status in a compact wrapping strip', () => {
    render(
      <WorkerLaneStrip
        loading={false}
        dashboard={
          {
            lanes: [
              {
                executionLane: 'ARCHIVE_RESOLVE',
                status: 'RUNNING',
                runningJob: { type: 'ARCHIVE_INTAKE_RESOLVE', progress: 35 }
              },
              { executionLane: 'BACKGROUND_WRITER', status: 'READY', runningJob: null }
            ]
          } as any
        }
      />
    )

    const strip = screen.getByRole('region', { name: '后台任务执行通道' })
    expect(strip.className).toContain('flex')
    expect(strip.className).toContain('flex-wrap')
    expect(screen.getByText('链接解析')).toBeTruthy()
    expect(screen.getByText('ARCHIVE_INTAKE_RESOLVE · 35%')).toBeTruthy()
    expect(screen.getByText('媒体写入')).toBeTruthy()
    expect(screen.getByText('等待领取任务')).toBeTruthy()
  })

  it('renders failed counts in destructive text', () => {
    render(<ArchiveImageCounts task={{ completedItems: 3, failedItems: 1, totalItems: 4 } as any} />)

    const counts = screen.getByLabelText('图片数量：成功 3，失败 1，总数 4')
    expect(counts.textContent?.replace(/\s/g, '')).toBe('3/1/4')
    expect(counts.children[2]!.className).toContain('text-destructive')
  })

  it('renders a current-download panel with aggregate and per-file phases', () => {
    const telemetry = {
      version: 1 as const,
      kind: 'archive.transfer' as const,
      archiveImportId: 'archive-1',
      downloadedBytes: String(318 * 1024 * 1024),
      bytesPerSecond: 13_000_000,
      activeDownloads: 1,
      activeWorkers: 4,
      activeItems: [
        {
          itemId: 'item-1',
          pageIndex: 90,
          expectedFilename: '0091.jpg',
          attempt: 1,
          phase: 'DOWNLOADING' as const,
          downloadedBytes: String(7.5 * 1024 * 1024),
          totalBytes: String(18 * 1024 * 1024),
          bytesPerSecond: 3_100_000
        },
        {
          itemId: 'item-2',
          pageIndex: 91,
          expectedFilename: '0092.jpg',
          attempt: 1,
          phase: 'WAITING_MEDIA_RESPONSE' as const,
          downloadedBytes: '0',
          totalBytes: null,
          bytesPerSecond: 0
        },
        {
          itemId: 'item-3',
          pageIndex: 92,
          expectedFilename: '0093.jpg',
          attempt: 1,
          phase: 'RESOLVING_SOURCE_PAGE' as const,
          downloadedBytes: '0',
          totalBytes: null,
          bytesPerSecond: 0
        },
        {
          itemId: 'item-4',
          pageIndex: 93,
          expectedFilename: '0094.jpg',
          attempt: 2,
          phase: 'VERIFYING' as const,
          downloadedBytes: String(12 * 1024 * 1024),
          totalBytes: String(12 * 1024 * 1024),
          bytesPerSecond: 0
        }
      ],
      concurrencyLimit: 4,
      completedItems: 90,
      failedItems: 0,
      totalItems: 234,
      sampledAt: '2026-09-01T00:00:00.000Z'
    }
    const onViewItems = vi.fn()
    const onPause = vi.fn()
    const onCancel = vi.fn()
    render(
      <ActiveArchiveDownloadPanel
        task={{
          ...activeTask,
          systemJobStatus: 'RUNNING',
          progress: 38,
          completedItems: 90,
          failedItems: 0,
          totalItems: 234,
          liveTransfer: telemetry
        }}
        now={Date.parse(telemetry.sampledAt) + 1_000}
        pausePending={false}
        cancelPending={false}
        onViewItems={onViewItems}
        onPause={onPause}
        onCancel={onCancel}
      />
    )

    expect(screen.getByRole('region', { name: '当前归档下载' })).toBeTruthy()
    expect(screen.getByText(/12.4 MB\/s/)).toBeTruthy()
    expect(screen.getByText('活跃任务 4/4')).toBeTruthy()
    expect(screen.getByText('正在传输 1')).toBeTruthy()
    expect(screen.getByText('等待远端 2')).toBeTruthy()
    expect(screen.getByText('校验写入 1')).toBeTruthy()
    expect(screen.getByText('等待图片响应')).toBeTruthy()
    expect(screen.getByText('解析图片页')).toBeTruthy()
    expect(screen.getByText('校验并写入')).toBeTruthy()
    expect(screen.getByLabelText('第 91 张下载 41%')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看全部图片' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onViewItems).toHaveBeenCalledOnce()
    expect(onPause).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps slot counts out of the historical task progress row', () => {
    render(
      <TaskProgress
        task={
          {
            ...activeTask,
            systemJobStatus: 'RUNNING',
            progress: 38,
            message: '等待远端响应',
            liveTransfer: {
              activeDownloads: 1,
              concurrencyLimit: 4
            }
          } as any
        }
      />
    )

    expect(screen.getByText('等待远端响应')).toBeTruthy()
    expect(screen.queryByText(/1\s*\/\s*4\s*路/)).toBeNull()
  })

  it('extracts only a non-empty archive import id from a job payload', () => {
    expect(archiveImportIdFromPayload({ archiveImportId: 'archive-1' })).toBe('archive-1')
    expect(archiveImportIdFromPayload({ archiveImportId: '' })).toBeNull()
    expect(archiveImportIdFromPayload([])).toBeNull()
  })

  it('drops cached transfer identity when a disconnected dashboard reports the task terminal', () => {
    expect(
      selectActiveArchiveImportId({
        dashboardLoaded: true,
        dashboardArchiveImportId: null,
        liveArchiveImportId: 'archive-old',
        realtimeConnected: false
      })
    ).toBeNull()
    expect(isActiveArchiveDownloadStatus('COMPLETED')).toBe(false)
    expect(isActiveArchiveDownloadStatus('FAILED')).toBe(false)
    expect(isActiveArchiveDownloadStatus('CANCELLED')).toBe(false)
  })

  it('lets the dashboard hand a disconnected panel from an old transfer to the next task', () => {
    expect(
      selectActiveArchiveImportId({
        dashboardLoaded: true,
        dashboardArchiveImportId: 'archive-new',
        liveArchiveImportId: 'archive-old',
        realtimeConnected: false
      })
    ).toBe('archive-new')
  })
})
