import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkNavigationMenu } from '../artwork-navigation-menu'
import { artworkQuerySnapshotSchema } from '@/schemas/artwork-quick-filter.dto'
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  usePathname: () => '/artworks',
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('search=old')
}))
vi.mock('@/hooks/use-artwork-quick-filters', () => ({
  useArtworkQuickFilters: () => ({
    userId: '1',
    items: [
      {
        id: 'one',
        name: '未读漫画',
        query: artworkQuerySnapshotSchema.parse({ readingStatus: 'UNREAD' }),
        invalidReferences: []
      }
    ],
    navigation: { revision: 1, ids: ['one'] },
    loading: false,
    error: ''
  })
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerType = init.pointerType || 'mouse'
      }
    }
  )
  window.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  push.mockClear()
})
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const touch = (x = 0, y = 0) => ({ touches: [{ clientX: x, clientY: y }] })
describe('artwork navigation gestures', () => {
  it('opens after exactly one second and allows moving into the menu', () => {
    render(<ArtworkNavigationMenu />)
    const trigger = screen.getByRole('link', { name: '作品' }).parentElement!
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    advance(999)
    expect(screen.queryByRole('menu')).toBeNull()
    advance(1)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
    advance(100)
    fireEvent.pointerEnter(screen.getByRole('menu'))
    advance(300)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerLeave(screen.getByRole('menu'))
    advance(199)
    expect(screen.getByRole('menu')).toBeTruthy()
    advance(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('cancels a short hover and supports the arrow keyboard entry', () => {
    render(<ArtworkNavigationMenu />)
    const trigger = screen.getByRole('link', { name: '作品' }).parentElement!
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    advance(500)
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
    advance(1000)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: '作品快捷筛选' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('navigates on short taps and keeps the custom menu open after a 500ms long press', () => {
    render(<ArtworkNavigationMenu mobile />)
    const link = screen.getByRole('button', { name: '作品' })
    expect(link.closest('a')).toBeNull()
    fireEvent.touchStart(link, touch())
    advance(499)
    fireEvent.touchEnd(link, { touches: [] })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(link)
    expect(push).toHaveBeenCalledExactlyOnceWith('/artworks')
    push.mockClear()
    fireEvent.touchStart(link, touch())
    advance(500)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.touchEnd(link, { touches: [] })
    expect(fireEvent.contextMenu(link)).toBe(false)
    expect(fireEvent.click(link)).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })
  it.each(['move', 'multitouch', 'cancel'])('cancels mobile %s without opening or navigating', (gesture) => {
    render(<ArtworkNavigationMenu mobile />)
    const trigger = screen.getByRole('button', { name: '作品' })
    fireEvent.touchStart(trigger, touch())
    advance(200)
    if (gesture === 'move') {
      fireEvent.touchMove(trigger, touch(11))
    } else if (gesture === 'multitouch') {
      fireEvent.touchStart(trigger, {
        touches: [{ clientX: 0, clientY: 0 }, { clientX: 5, clientY: 5 }]
      })
    } else {
      fireEvent.touchCancel(trigger, { touches: [] })
    }
    advance(500)
    fireEvent.touchEnd(trigger, { touches: [] })
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(push).not.toHaveBeenCalled()
    // Cancelling one gesture must not disable the next short tap.
    fireEvent.touchStart(trigger, touch())
    fireEvent.touchEnd(trigger, { touches: [] })
    fireEvent.click(trigger)
    expect(push).toHaveBeenCalledExactlyOnceWith('/artworks')
  })
  it('suppresses the native context menu before the long-press timer fires', () => {
    render(<ArtworkNavigationMenu mobile />)
    const trigger = screen.getByRole('button', { name: '作品' })
    fireEvent.touchStart(trigger, touch())
    advance(400)
    expect(fireEvent.contextMenu(trigger)).toBe(false)
    advance(100)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.touchEnd(trigger, { touches: [] })
    fireEvent.click(trigger)
    expect(push).not.toHaveBeenCalled()
  })
  it('opens the mobile menu by keyboard and restores focus on Escape', () => {
    render(<ArtworkNavigationMenu mobile />)
    const trigger = screen.getByRole('button', { name: '作品' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    advance(0)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    expect(push).toHaveBeenCalledExactlyOnceWith('/artworks')
  })
  it('applies the full saved query and preserves current conditions when opening management', () => {
    render(<ArtworkNavigationMenu />)
    const arrow = screen.getByRole('button', { name: '作品快捷筛选' })
    fireEvent.keyDown(arrow, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: /未读漫画/ }))
    const url = new URL(push.mock.calls[0]![0], 'http://localhost')
    expect(url.searchParams.get('readingStatuses')).toBe('UNREAD')
    expect(url.searchParams.has('readingStatus')).toBe(false)
    expect(url.searchParams.get('mediaKinds')).toBe('')
    expect(url.searchParams.get('search')).toBeNull()
    expect(url.searchParams.has('quickApply')).toBe(true)
    fireEvent.keyDown(arrow, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: '管理快捷筛选' }))
    expect(push).toHaveBeenLastCalledWith('/artworks?search=old&quickFilters=manage')
  })
})
