import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArchiveImageCounts,
  ArchiveTaskCard,
  ArchiveTaskTable,
  ArchiveTransferStatus,
  WorkerLaneStrip,
  canExpandArchivePublishedMedia
} from '../archive-management'

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

    const strip = screen.getByRole('region', { name: 'Worker 执行通道' })
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

  it('renders live transfer speed, waiting state, and stale speed accessibly', () => {
    const telemetry = {
      version: 1 as const,
      kind: 'archive.transfer' as const,
      archiveImportId: 'archive-1',
      downloadedBytes: String(318 * 1024 * 1024),
      bytesPerSecond: 13_000_000,
      activeDownloads: 2,
      concurrencyLimit: 4,
      completedItems: 3,
      failedItems: 0,
      totalItems: 10,
      sampledAt: '2026-09-01T00:00:00.000Z'
    }
    const view = render(<ArchiveTransferStatus telemetry={telemetry} now={Date.parse(telemetry.sampledAt) + 1_000} />)
    expect(screen.getByLabelText(/12.4 MB\/s · 有效已下载 318 MB · 2\/4 路/)).toBeTruthy()

    view.rerender(
      <ArchiveTransferStatus
        telemetry={{ ...telemetry, activeDownloads: 0 }}
        now={Date.parse(telemetry.sampledAt) + 1_000}
      />
    )
    expect(screen.getByLabelText(/等待远端响应/)).toBeTruthy()

    view.rerender(<ArchiveTransferStatus telemetry={telemetry} now={Date.parse(telemetry.sampledAt) + 6_000} />)
    expect(screen.getByLabelText(/速度 —/)).toBeTruthy()
  })
})
