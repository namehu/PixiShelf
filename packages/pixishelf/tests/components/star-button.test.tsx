import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { StarButton } from '@/app/admin/artists/_components/artist-management'

// 模拟外部依赖
vi.mock('lucide-react', () => ({
  Star: ({ className }: { className: string }) => <div data-testid="star-icon" className={className} />
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>
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
    expect(screen.getByRole('button', { name: '设为星标' })).toBeTruthy()
  })

  it('should toggle state optimistically', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined)
    render(<StarButton id={1} initialIsStarred={false} onToggle={onToggle} />)

    const button = screen.getByRole('button', { name: '设为星标' })
    fireEvent.click(button)

    // 验证乐观更新。
    const icon = screen.getByTestId('star-icon')
    expect(icon.className).toContain('text-warning')
    expect(screen.getByRole('button', { name: '取消星标' })).toBeTruthy()
    expect(onToggle).toHaveBeenCalledWith(1, true)
  })

  it('should rollback on error', async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error('Failed'))
    render(<StarButton id={1} initialIsStarred={false} onToggle={onToggle} />)

    const button = screen.getByRole('button', { name: '设为星标' })
    fireEvent.click(button)

    // 请求完成前先应用乐观更新。
    const icon = screen.getByTestId('star-icon')
    expect(icon.className).toContain('text-warning')

    // 等待失败后的状态回滚。
    await waitFor(() => {
      expect(icon.className).toContain('text-muted-foreground')
    })
  })
})
