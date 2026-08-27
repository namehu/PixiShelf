import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { useArtworkStore } from '@/store/use-artwork-store'
import NavHead from '../nav-head'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  safeBack: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push })
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => <a href="/admin/artworks">{children}</a>
}))

vi.mock('@/hooks/use-safe-back', () => ({
  useSafeBack: () => mocks.safeBack
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    asChild
  }: {
    children: ReactNode
    onSelect?: () => void
    asChild?: boolean
  }) =>
    asChild ? (
      children
    ) : (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    )
}))

vi.mock('../media-order-review-dialog', () => ({
  default: () => (
    <div role="dialog" aria-label="媒体顺序校对">
      媒体顺序校对
    </div>
  )
}))

const data = {
  id: 7,
  images: [{ id: 1, path: '/one.jpg' }, { id: 2, path: '/two.jpg' }]
} as unknown as ArtworkResponseDto

describe('NavHead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    useArtworkStore.getState().clearImages()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('groups the three artwork actions under a single more menu trigger', () => {
    render(<NavHead data={data} id="7" />)

    expect(screen.getByRole('button', { name: '更多作品操作' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '管理当前作品' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '顺序校对' }))
    expect(screen.getByRole('dialog', { name: '媒体顺序校对' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }))
    expect(useArtworkStore.getState().images).toEqual(data.images)
    expect(mocks.push).toHaveBeenCalledWith('/artworks/preview')
  })
})
