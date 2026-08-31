import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveQueueControlPanel } from '../archive-inbox'

const summary = {
  activeCount: 1,
  capacity: 1000,
  paused: false,
  queuedCount: 0,
  currentItem: null,
  oldestWaitingAt: null,
  recentFailedCount: 0,
  remainingCapacity: 999
}

const lanes = [
  { executionLane: 'ARCHIVE_RESOLVE', status: 'READY', runningJob: null },
  { executionLane: 'BACKGROUND_WRITER', status: 'READY', runningJob: null }
]

describe('archive inbox control panel', () => {
  afterEach(() => cleanup())

  it('summarizes the queue before disclosing operational details', () => {
    render(
      <ArchiveQueueControlPanel
        summary={summary as any}
        lanes={lanes as any}
        loading={false}
        error={false}
        pausePending={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    const status = screen.getByRole('region', { name: '处理状态' })
    expect(within(status).getByText('运行正常')).toBeTruthy()
    expect(within(status).getByText('当前没有待处理项目。')).toBeTruthy()
    expect(within(status).getByText('1 / 1000')).toBeTruthy()
    expect(screen.queryByText('链接解析')).toBeNull()
    expect(screen.queryByRole('button', { name: '暂停解析' })).toBeNull()

    const detailsButton = within(status).getByRole('button', { name: '运行详情' })
    expect(detailsButton.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(detailsButton)

    const pipeline = screen.getByRole('region', { name: '处理路径' })
    expect(within(pipeline).getByText('链接解析')).toBeTruthy()
    expect(within(pipeline).getByText('媒体写入')).toBeTruthy()
    expect(screen.queryByText('ARCHIVE_RESOLVE')).toBeNull()
    expect(screen.queryByText('BACKGROUND_WRITER')).toBeNull()

    const capacity = screen.getByRole('region', { name: '收件容量' })
    expect(within(capacity).getByText('1 / 1000')).toBeTruthy()
    expect(within(capacity).getByText('剩余容量')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '收件箱容量已使用 0%' })).toBeTruthy()
    expect(detailsButton.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the queue pause action wired to the control panel', () => {
    const onPause = vi.fn()
    render(
      <ArchiveQueueControlPanel
        summary={summary as any}
        lanes={lanes as any}
        loading={false}
        error={false}
        pausePending={false}
        onPause={onPause}
        onResume={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '运行详情' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停解析' }))
    expect(onPause).toHaveBeenCalledOnce()
  })
})
