import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProTable } from './index'
import * as React from 'react'

// 模拟消息提示。
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

// 模拟 matchMedia。
const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}

const mockColumns = [
  {
    header: 'Name',
    accessorKey: 'name'
  }
]

describe('ProTable Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMatchMedia(false)
  })

  afterEach(() => {
    cleanup()
  })

  it('triggers request with correct pagination params when page changes', async () => {
    const requestFn = vi.fn().mockResolvedValue({
      data: Array(10).fill({ name: 'Test' }),
      success: true,
      total: 100
    })

    render(<ProTable columns={mockColumns} request={requestFn} defaultPageSize={10} rowKey="id" />)

    // 首次加载。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })

    const nextBtn = await screen.findByRole('button', { name: '下一页' }, { timeout: 3000 })

    fireEvent.click(nextBtn)

    // 验证请求使用第 2 页参数。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(2)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 2, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })
  })

  it('triggers request with correct pagination params when using jumper', async () => {
    const requestFn = vi.fn().mockResolvedValue({
      data: Array(10).fill({ name: 'Test' }),
      success: true,
      total: 100
    })

    render(<ProTable columns={mockColumns} request={requestFn} defaultPageSize={10} rowKey="id" />)

    // 首次加载。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
    })

    const input = screen.getByRole('spinbutton', { name: '跳转页码，范围 1 到 10' })
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // 验证请求使用第 5 页参数。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(2)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 5, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })
  })

  it('triggers request when clicking specific page number', async () => {
    const requestFn = vi.fn().mockResolvedValue({
      data: Array(10).fill({ name: 'Test' }),
      success: true,
      total: 100
    })

    render(<ProTable columns={mockColumns} request={requestFn} defaultPageSize={10} rowKey="id" />)

    // 首次加载。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
    })

    // 找到并点击第 2 页。
    const page2Btn = await screen.findByText('2', {}, { timeout: 3000 })
    fireEvent.click(page2Btn)

    // 验证请求使用第 2 页参数。
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(2)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 2, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })
  })

  it('supports controlled column visibility', () => {
    const columns = [
      ...mockColumns,
      {
        id: 'cover',
        header: 'Cover',
        accessorKey: 'cover'
      }
    ]
    const data = [{ id: 1, name: 'Test', cover: 'cover.webp' }]
    const { rerender } = render(
      <ProTable columns={columns} dataSource={data} columnVisibility={{ cover: true }} rowKey="id" />
    )

    expect(screen.getByRole('columnheader', { name: 'Cover' })).toBeTruthy()
    expect(screen.getByText('cover.webp')).toBeTruthy()

    rerender(<ProTable columns={columns} dataSource={data} columnVisibility={{ cover: false }} rowKey="id" />)

    expect(screen.queryByRole('columnheader', { name: 'Cover' })).toBeNull()
    expect(screen.queryByText('cover.webp')).toBeNull()
  })
})
