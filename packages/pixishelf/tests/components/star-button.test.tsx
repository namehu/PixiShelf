import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StarButton } from '@/app/admin/artists/_components/artist-management'

// Mock dependencies
vi.mock('lucide-react', () => ({
  Star: ({ className }: { className: string }) => <div data-testid="star-icon" className={className} />
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, title, disabled }: any) => (
    <button onClick={onClick} title={title} disabled={disabled} data-testid="star-button">
      {children}
    </button>
  )
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

describe('StarButton', () => {
  afterEach(() => {
    cleanup()
  })

  it('should render initial state correctly', () => {
    const onToggle = vi.fn()
    render(<StarButton id={1} initialIsStarred={false} onToggle={onToggle} />)

    const icon = screen.getByTestId('star-icon')
    expect(icon.className).toContain('text-muted-foreground')
    expect(screen.getByTestId('star-button').title).toBe('设为星标')
  })

  it('should toggle state optimistically', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<StarButton id={1} initialIsStarred={false} onToggle={onToggle} />)

    const button = screen.getByTestId('star-button')
    fireEvent.click(button)

    // Check optimistic update
    const icon = screen.getByTestId('star-icon')
    expect(icon.className).toContain('text-yellow-400')
    expect(onToggle).toHaveBeenCalledWith(1, true)
  })

  it('should rollback on error', async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error('Failed'))
    render(<StarButton id={1} initialIsStarred={false} onToggle={onToggle} />)

    const button = screen.getByTestId('star-button')
    fireEvent.click(button)

    // Optimistic update first
    const icon = screen.getByTestId('star-icon')
    expect(icon.className).toContain('text-yellow-400')

    // Wait for rollback
    await waitFor(() => {
      expect(icon.className).toContain('text-muted-foreground')
    })
  })
})
