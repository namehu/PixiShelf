import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import MediaOrderReviewDialog from '../media-order-review-dialog'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refresh: vi.fn(),
  useSensor: vi.fn(() => ({}))
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({
    artwork: {
      reorderImages: { mutate: mocks.mutate }
    }
  })
}))

vi.mock('@/components/media/media-thumbnail', () => ({
  default: ({ media, alt }: { media: { path: string }; alt: string }) => (
    // oxlint-disable-next-line nextjs/no-img-element
    <img src={media.path} alt={alt} />
  )
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  DragOverlay: ({ children }: { children: React.ReactNode }) => children,
  KeyboardSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  closestCenter: vi.fn(),
  useSensor: mocks.useSensor,
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  rectSortingStrategy: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false
  })
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } }
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (open ? children : null),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}))

function media(id: number, path: string, sortOrder: number): ArtworkImageResponseDto {
  return {
    id,
    path,
    width: 1200,
    height: 1800,
    size: null,
    sortOrder,
    artworkId: 8,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    webpAnimationStatus: null,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersUpdatedAt: null,
    chaptersHash: null,
    mediaType: 'image',
    hasChapters: false,
    chaptersUrl: null
  }
}

const images = [media(3, '/work/page-10.jpg', 0), media(1, '/work/page-1.jpg', 1), media(2, '/work/page-2.jpg', 2)]

describe('MediaOrderReviewDialog', () => {
  it('does not add a second main landmark inside the full-screen dialog', () => {
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={vi.fn()} />)

    expect(document.body.querySelector('main')).toBeNull()
  })

  beforeEach(() => {
    mocks.mutate.mockReset().mockResolvedValue({ success: true })
    mocks.refresh.mockReset()
    mocks.useSensor.mockClear()
    history.replaceState({}, '', window.location.href)
  })

  afterEach(() => cleanup())

  it('shows natural-order differences and saves a normalized filename order without closing', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={onClose} onSaved={onSaved} />)

    expect(screen.getByText('3 项与文件名顺序不同')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /文件名排序/ }))
    expect(screen.getByText('未保存')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))

    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith({
        artworkId: 8,
        imageIds: [1, 2, 3],
        expectedImageIds: [3, 1, 2]
      })
    })
    expect(onSaved.mock.calls[0]![0].map((item: ArtworkImageResponseDto) => item.sortOrder)).toEqual([0, 1, 2])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('顺序校对')).toBeTruthy()
  })

  it('swaps the visible adjacent pair and supports undo', () => {
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /交换这两项/ }))
    expect(screen.getByText('未保存')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }))
    expect(screen.queryByText('未保存')).toBeNull()
  })

  it('switches to a names-only sortable list while keeping order controls available', () => {
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /名称列表/ }))

    const nameList = screen.getByTestId('media-name-list')
    expect(nameList.querySelectorAll('[data-testid="media-name-row"]')).toHaveLength(3)
    expect(nameList.querySelector('img')).toBeNull()
    expect(nameList.textContent).toContain('page-10.jpg')
    expect(nameList.textContent).not.toContain('1200×1800')

    fireEvent.click(screen.getByRole('button', { name: /选择第 2 项 page-1.jpg/ }))
    fireEvent.click(screen.getByRole('button', { name: /移到开头/ }))
    expect(screen.getByText('未保存')).toBeTruthy()
    expect(screen.getAllByTestId('media-name-row')[0]!.textContent).toContain('page-1.jpg')
  })

  it('uses a two-column mobile grid, hides image badges, and configures reliable handle dragging', () => {
    const video = { ...media(4, '/work/page-4.mp4', 3), mediaType: 'video' as const }
    render(<MediaOrderReviewDialog artworkId={8} images={[...images, video]} onClose={vi.fn()} />)

    const grid = screen.getByTestId('media-contact-grid')
    expect(grid.className).toContain('grid-cols-2')
    expect(grid.className).toContain('md:grid-cols-3')
    expect(screen.queryByText('图片')).toBeNull()
    expect(screen.getByText('视频')).toBeTruthy()
    expect(mocks.useSensor).toHaveBeenCalledWith(expect.any(Function), {
      activationConstraint: { distance: 4 }
    })
  })

  it('asks before discarding a dirty draft', () => {
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /反转/ }))
    fireEvent.click(screen.getByRole('button', { name: '关闭顺序校对' }))

    expect(screen.getByText('放弃未保存的顺序？')).toBeTruthy()
  })

  it('closes on browser back when there are no unsaved changes', () => {
    const onClose = vi.fn()
    render(<MediaOrderReviewDialog artworkId={8} images={images} onClose={onClose} />)

    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
