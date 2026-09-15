import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchEventSource: vi.fn(),
  confirm: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: mocks.fetchEventSource }))
vi.mock('sonner', () => ({
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess, error: vi.fn() }
}))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: mocks.confirm }))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    asChild
  }: {
    children: ReactNode
    onSelect?: () => void
    disabled?: boolean
    asChild?: boolean
  }) =>
    asChild ? (
      children
    ) : (
      <button type="button" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    )
}))

import { ArtworkRowActions } from '../artwork-row-actions'
afterEach(cleanup)

describe('ArtworkRowActions central queued event', () => {
  it('disables deletion while another deletion is pending', () => {
    const onDelete = vi.fn()
    render(
      <ArtworkRowActions
        artwork={{ id: 8, title: 'work', source: 'LOCAL_IMPORT' } as any}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={onDelete}
        onRescanComplete={vi.fn()}
        deletePending
      />
    )
    const button = screen.getAllByRole('button', { name: '删除作品' }).at(-1) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onDelete).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockImplementation(({ onConfirm }) => onConfirm())
    mocks.fetchEventSource.mockImplementation(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onmessage?.({
        event: 'queued',
        data: JSON.stringify({
          success: true,
          queued: { jobId: 'rescan-job-1', scanRunId: 'rescan-run-1', status: 'PENDING' }
        })
      })
    })
  })

  it('shows queued state and does not refresh as if the rescan completed', async () => {
    const onRescanComplete = vi.fn()
    render(
      <ArtworkRowActions
        artwork={{ id: 7, title: '测试作品', source: 'PIXIV_IMPORTED' } as any}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onRescanComplete={onRescanComplete}
      />
    )

    fireEvent.click(screen.getByText('重新扫描'))

    await waitFor(() => expect(screen.getByText('重新扫描（已入队）')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain('rescan-job-1')
    expect(screen.getByRole('status').textContent).toContain('rescan-run-1')
    expect(onRescanComplete).not.toHaveBeenCalled()
    expect(mocks.toastInfo).toHaveBeenCalledWith('重新扫描任务已加入后台队列', {
      description: '任务 ID: rescan-job-1'
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.fetchEventSource.mock.calls[0]?.[1].signal.aborted).toBe(true)
  })
})
