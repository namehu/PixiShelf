import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProTablePagination } from './pagination'
import * as React from 'react'
import { toast } from 'sonner'

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

// Mock matchMedia
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

    // Check text
    expect(screen.getByText('共 100 项')).toBeTruthy()

    // Check buttons: 1, 2, 3 (active), 4, 5, ..., 10
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '2' })).toBeTruthy()
    const btn3 = screen.getByRole('button', { name: '3' })
    expect(btn3).toBeTruthy()
    // Check active class manually
    expect(btn3.className).toContain('border-primary')

    expect(screen.getByRole('button', { name: '4' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '5' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10' })).toBeTruthy()

    // Check jumper input exists
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThan(0)
  })

  it('calls onChange when clicking a page number', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const btn5 = screen.getByRole('button', { name: '5' })
    fireEvent.click(btn5)
    expect(handleChange).toHaveBeenCalledWith(4, 10) // 0-based index
  })

  it('handles jumper input correctly (valid)', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getAllByRole('textbox')[0] as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).toHaveBeenCalledWith(4, 10)
  })

  it('shows error for invalid jumper input (PC)', () => {
    const handleChange = vi.fn()
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    // Simulate Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(handleChange).not.toHaveBeenCalled()
    // Check if error class is applied
    expect(input.className).toContain('border-red-500')
    // Tooltip text
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

    // Check mobile elements
    // Should NOT see "10 条/页" (Select)
    expect(screen.queryByText('10 条/页')).toBeNull()

    // Should see "第 3 / 10 页"
    expect(screen.getByText('第 3 / 10 页')).toBeTruthy()

    // Should have Prev, Next buttons (icon only, ghost)
    const buttons = screen.getAllByRole('button')
    // We expect 2 buttons (Prev, Next).
    // Wait, are there others? No.
    expect(buttons.length).toBe(2)
  })

  it('shows toast for invalid input on mobile', () => {
    mockMatchMedia(true) // Mobile
    const handleChange = vi.fn()

    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={handleChange} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handleChange).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('页码超出范围')
  })

  it('disables buttons when loading', () => {
    render(<ProTablePagination pageIndex={0} pageSize={10} rowCount={100} onChange={vi.fn()} loading={true} />)

    // Use specific selector to avoid ambiguity if multiple elements match text "2"
    const nextBtn = screen.getByRole('button', { name: '2' }) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(true)

    const input = screen.getByRole('textbox') as HTMLInputElement
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
