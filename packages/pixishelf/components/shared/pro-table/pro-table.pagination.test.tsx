import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProTablePagination } from './pagination'
import * as React from 'react'
import { toast } from 'sonner'

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

describe('ProTablePagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMatchMedia(false) // Default to PC view
  })

  afterEach(() => {
    cleanup()
  })

  it('renders correctly on PC (Page 3 of 10)', () => {
    render(
      <ProTablePagination
        pageIndex={2} // Page 3
        pageSize={10}
        rowCount={100} // 10 pages
        onChange={vi.fn()}
      />
    )

    // 检查分页文本。
    expect(screen.getByText('共 100 项')).toBeTruthy()

    // 检查页码按钮：1、2、3（当前页）、4、5、…、10。
    expect(screen.getByRole('button', { name: '第 1 页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '第 2 页' })).toBeTruthy()
    const btn3 = screen.getByRole('button', { name: '第 3 页' })
    expect(btn3).toBeTruthy()
    // 单独检查当前页样式。
    expect(btn3.className).toContain('border-primary')

    expect(btn3.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '第 4 页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '第 5 页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '第 10 页' })).toBeTruthy()

    // 检查快速跳转输入框存在。
    expect(screen.getByRole('spinbutton', { name: '跳转页码，范围 1 到 10' })).toBeTruthy()
  })

  it('calls onChange when clicking a page number', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const btn5 = screen.getByRole('button', { name: '第 5 页' })
    fireEvent.click(btn5)
    expect(handleChange).toHaveBeenCalledWith(4, 10) // 0-based index
  })

  it('handles jumper input correctly (valid)', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).toHaveBeenCalledWith(4, 10)
  })

  it('shows error for invalid jumper input (PC)', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    // 模拟按下回车键。
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(handleChange).not.toHaveBeenCalled()
    // 检查错误样式是否生效。
    expect(input.className).toContain('border-destructive')
    // 检查提示文本。
    expect(screen.getByText('请输入 1-10')).toBeTruthy()
  })

  it('renders mobile layout when width <= 768px', () => {
    mockMatchMedia(true) // Mobile

    render(
      <ProTablePagination
        pageIndex={2} // Page 3
        pageSize={10}
        rowCount={100}
        onChange={vi.fn()}
      />
    )

    // 检查移动端元素，不应显示“10 条/页”选择器。
    expect(screen.queryByText('10 条/页')).toBeNull()

    // 应显示“第 3 / 10 页”。
    expect(screen.getByText('第 3 / 10 页')).toBeTruthy()

    // 应只有上一页和下一页两个幽灵样式图标按钮。
    const buttons = screen.getAllByRole('button')
    // 预期仅存在两个翻页按钮。
    expect(buttons.length).toBe(2)
  })

  it('shows toast for invalid input on mobile', () => {
    mockMatchMedia(true) // Mobile
    const handleChange = vi.fn()

    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('页码超出范围')
  })

  it('disables buttons when loading', () => {
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={vi.fn()} loading={true} />)

    // 使用精确选择器，避免多个元素同时匹配文本“2”。
    const nextBtn = screen.getByRole('button', { name: '第 2 页' }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('hides when total <= 1 page', () => {
    const { container } = render(
      <ProTablePagination
        pageIndex={0}
        pageSize={10}
        rowCount={5} // 1 page
        onChange={vi.fn()}
      />
    )

    expect(container.firstChild).toBeNull()
  })
})
