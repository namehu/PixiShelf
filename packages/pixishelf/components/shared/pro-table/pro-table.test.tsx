import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProTable } from './index'
import * as React from 'react'

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

    // Initial load
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })

    // Click Next Page (to page 2)
    // Use findByLabelText which handles waiting automatically and tests accessibility
    const nextBtn = await screen.findByLabelText('Next Page', {}, { timeout: 3000 })

    fireEvent.click(nextBtn)

    // Verify request called with page 2
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

    // Initial load
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
    })

    // Find jumper input
    // Note: input type is now text, so role is textbox
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Verify request called with page 5
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

    // Initial load
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(1)
    })

    // Find and click page 2
    const page2Btn = await screen.findByText('2', {}, { timeout: 3000 })
    fireEvent.click(page2Btn)

    // Verify request called with page 2
    await waitFor(() => {
      expect(requestFn).toHaveBeenCalledTimes(2)
      expect(requestFn).toHaveBeenCalledWith(
        expect.objectContaining({ current: 2, pageSize: 10 }),
        expect.anything(),
        expect.anything()
      )
    })
  })
})
