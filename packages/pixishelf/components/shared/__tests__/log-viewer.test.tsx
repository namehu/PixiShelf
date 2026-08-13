import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '@/lib/db'
import { LogViewer } from '../log-viewer'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error }
}))

vi.mock('@/components/shared/global-confirm', () => ({
  confirm: mocks.confirm
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent
  }: {
    data: LogEntry[]
    itemContent: (index: number, log: LogEntry) => React.ReactNode
  }) => (
    <div>
      {data.map((log, index) => (
        <React.Fragment key={log.id}>{itemContent(index, log)}</React.Fragment>
      ))}
    </div>
  )
}))

const logs: LogEntry[] = [
  { id: 1, module: 'system', level: 'info', message: '扫描开始', timestamp: new Date('2026-08-13T08:00:00').getTime() },
  {
    id: 2,
    module: 'system',
    level: 'error',
    message: '文件读取失败',
    timestamp: new Date('2026-08-13T08:00:01').getTime()
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText }
  })
})

afterEach(cleanup)

describe('LogViewer', () => {
  it('keeps log messages selectable and exposes labelled controls', () => {
    render(<LogViewer logs={logs} onClear={vi.fn()} />)

    expect(screen.getByRole('region', { name: '运行日志' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '筛选日志' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '筛选日志' }).getAttribute('name')).toBe('log-filter')
    expect(screen.getByRole('searchbox', { name: '筛选日志' }).getAttribute('autocomplete')).toBe('off')
    expect(screen.getByRole('checkbox', { name: '自动滚动' })).toBeTruthy()
    const logRow = screen.getByText('文件读取失败').parentElement
    expect(logRow?.querySelector('.select-none')).toBeNull()
    expect(screen.getByRole('button', { name: '复制日志' }).querySelector('svg')?.dataset.icon).toBe('inline-start')
    expect(screen.getByRole('button', { name: '清空' }).querySelector('svg')?.dataset.icon).toBe('inline-start')
  })

  it('copies only the currently filtered logs', async () => {
    render(<LogViewer logs={logs} />)

    fireEvent.change(screen.getByRole('searchbox', { name: '筛选日志' }), { target: { value: '失败' } })
    fireEvent.click(screen.getByRole('button', { name: '复制筛选结果' }))

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(1))
    const copiedText = String(mocks.writeText.mock.calls[0]?.[0])
    expect(copiedText).toContain('[ERROR] 文件读取失败')
    expect(copiedText).not.toContain('扫描开始')
    expect(mocks.success).toHaveBeenCalledWith('已复制 1 条日志')
  })

  it('falls back to direct selection when clipboard access fails', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('denied'))
    render(<LogViewer logs={logs} />)

    fireEvent.click(screen.getByRole('button', { name: '复制日志' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('复制失败，请直接框选日志内容复制'))
  })

  it('confirms before irreversibly clearing logs', () => {
    const onClear = vi.fn()
    render(<LogViewer logs={logs} onClear={onClear} />)

    fireEvent.click(screen.getByRole('button', { name: '清空' }))

    expect(onClear).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '清空运行日志？',
        confirmText: '清空日志',
        variant: 'destructive',
        onConfirm: onClear
      })
    )
  })
})
