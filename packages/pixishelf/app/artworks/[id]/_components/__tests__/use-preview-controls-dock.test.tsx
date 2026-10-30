import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DockablePreviewControls } from '../dockable-preview-controls'
import { usePreviewControlsDock } from '../use-preview-controls-dock'
import {
  usePreviewControlsPreferences as preferences,
  PREVIEW_CONTROLS_STORAGE_KEY
} from '@/store/use-preview-controls-preferences'
import { useArtworkAutoBrowseStore as auto } from '@/store/use-artwork-auto-browse-store'

vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => true
}))
let current: ReturnType<typeof usePreviewControlsDock>
let width: number
let height: number
const listeners = new Set<() => void>()
const clicked = vi.fn()
const close = vi.fn()
function Controls({ dialog = false, open = true }: { dialog?: boolean; open?: boolean }) {
  current = usePreviewControlsDock(open)
  const controls = (
    <DockablePreviewControls dock={current}>
      <button onClick={clicked}>播放控件</button>
    </DockablePreviewControls>
  )
  return dialog ? (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onEscapeKeyDown={current.onEscapeKeyDown}>
        <DialogTitle>阅读</DialogTitle>
        <DialogDescription>测试阅读工具栏</DialogDescription>
        {controls}
      </DialogContent>
    </Dialog>
  ) : (
    controls
  )
}
function pointer(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y })
  fireEvent(screen.getByRole('button', { name: '拖动阅读工具栏' }), event)
}
function drag(x: number, y: number) {
  pointer('pointerdown', 500, 700)
  pointer('pointermove', x, y)
  pointer('pointerup', x, y)
}
beforeEach(() => {
  width = 1000
  height = 800
  listeners.clear()
  clicked.mockClear()
  close.mockClear()
  localStorage.clear()
  preferences.setState({ mobile: 'bottom', desktop: 'bottom' })
  auto.getState().initialize(1)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return width >= 640
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback)
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.orientation === 'vertical' ? 60 : 300
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.orientation === 'vertical' ? 260 : 48
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  auto.getState().stop()
})

describe('preview controls drag and dock', () => {
  it('measures a mobile dialog after its portal mounts and again on reopening with the saved dock', () => {
    width = 390
    const view = render(<Controls dialog />)
    expect(screen.getByRole('button', { name: '拖动阅读工具栏' })).toBeTruthy()
    expect(current.dock).toBe('bottom')
    expect(current.x.get()).toBe(45)
    expect(current.y.get()).toBe(740)
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动阅读工具栏' }), { key: 'ArrowLeft' })
    expect(current.dock).toBe('left')
    expect(current.x.get()).toBe(12)
    expect(current.y.get()).toBe(270)
    view.rerender(<Controls dialog open={false} />)
    expect(screen.queryByRole('button', { name: '拖动阅读工具栏' })).toBeNull()
    view.rerender(<Controls dialog />)
    expect(current.x.get()).toBe(12)
    expect(current.y.get()).toBe(270)
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动阅读工具栏' }), { key: 'ArrowDown' })
    expect(current.x.get()).toBe(45)
    expect(current.y.get()).toBe(740)
  })
  it('follows a drag without changing orientation, pauses only after threshold and snaps to all three anchors', () => {
    render(<Controls />)
    expect(current.x.get()).toBe(350)
    expect(current.y.get()).toBe(740)
    auto.getState().start('slideshow')
    pointer('pointerdown', 500, 700)
    pointer('pointermove', 503, 703)
    expect(current.dragging).toBe(false)
    expect(auto.getState().status).toBe('running')
    pointer('pointermove', 200, 500)
    expect(current.dragging).toBe(true)
    expect(current.x.get()).toBe(50)
    expect(current.y.get()).toBe(540)
    expect(current.orientation).toBe('horizontal')
    expect(auto.getState().status).toBe('paused')
    pointer('pointermove', 0, 360)
    pointer('pointerup', 0, 360)
    expect(current.dock).toBe('left')
    expect(current.settingsSide).toBe('right')
    expect(current.x.get()).toBe(12)
    expect(current.y.get()).toBe(270)
    drag(1600, 700)
    expect(current.dock).toBe('right')
    expect(current.x.get()).toBe(928)
    expect(current.settingsSide).toBe('left')
    drag(100, 1400)
    expect(current.dock).toBe('bottom')
    expect(current.orientation).toBe('horizontal')
  })
  it.each(['pointercancel', 'lostpointercapture', 'Escape'])(
    'cancels %s to the original dock without persisting free pixels',
    (kind) => {
      render(<Controls />)
      pointer('pointerdown', 500, 700)
      pointer('pointermove', 40, 300)
      if (kind === 'Escape') {
        fireEvent.keyDown(screen.getByRole('button', { name: '拖动阅读工具栏' }), { key: 'Escape' })
      } else pointer(kind, 40, 300)
      expect(current.dragging).toBe(false)
      expect(current.dock).toBe('bottom')
      expect(current.x.get()).toBe(350)
      expect(current.y.get()).toBe(740)
    }
  )
  it('consumes Escape before Radix dismisses the dialog during a drag, then restores normal close behavior', () => {
    render(<Controls dialog />)
    pointer('pointerdown', 500, 700)
    pointer('pointermove', 30, 300)
    const handle = screen.getByRole('button', { name: '拖动阅读工具栏' })
    fireEvent.keyDown(handle, { key: 'Escape' })
    expect(current.dragging).toBe(false)
    expect(current.dock).toBe('bottom')
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(handle, { key: 'Escape' })
    expect(close).toHaveBeenCalledExactlyOnceWith(false)
  })
  it('keeps short presses inert and internal controls independent; keyboard docks without moving slides', () => {
    render(<Controls />)
    pointer('pointerdown', 500, 700)
    pointer('pointerup', 500, 700)
    expect(current.dock).toBe('bottom')
    fireEvent.click(screen.getByRole('button', { name: '播放控件' }))
    expect(clicked).toHaveBeenCalledTimes(1)
    const handle = screen.getByRole('button', { name: '拖动阅读工具栏' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(current.dock).toBe('left')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(current.dock).toBe('right')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(current.dock).toBe('bottom')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(current.dock).toBe('bottom')
  })
  it('remembers only dock enums separately at the 640px breakpoint and across reopening', () => {
    const view = render(<Controls />)
    const handle = screen.getByRole('button', { name: '拖动阅读工具栏' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    act(() => {
      width = 390
      listeners.forEach((listener) => listener())
      window.dispatchEvent(new Event('resize'))
    })
    expect(current.dock).toBe('bottom')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    const saved = JSON.parse(localStorage.getItem(PREVIEW_CONTROLS_STORAGE_KEY)!).state
    expect(saved).toEqual({ mobile: 'left', desktop: 'right' })
    view.unmount()
    render(<Controls />)
    expect(current.dock).toBe('left')
    act(() => {
      width = 640
      listeners.forEach((listener) => listener())
      window.dispatchEvent(new Event('resize'))
    })
    expect(current.dock).toBe('right')
  })
  it('recalculates anchors after resize using measured safe insets and keeps pointer movement bounded', () => {
    render(<Controls />)
    const stage = screen.getByRole('button', { name: '拖动阅读工具栏' }).parentElement!.parentElement!
    stage.style.padding = '80px 24px 20px 30px'
    act(() => window.dispatchEvent(new Event('resize')))
    expect(current.y.get()).toBe(732)
    pointer('pointerdown', 500, 700)
    pointer('pointermove', 10000, -10000)
    expect(current.x.get()).toBe(676)
    expect(current.y.get()).toBe(80)
    pointer('pointercancel', 0, 0)
    act(() => {
      width = 700
      height = 500
      window.dispatchEvent(new Event('resize'))
    })
    expect(current.x.get()).toBe(200)
    expect(current.y.get()).toBe(432)
  })
  it('keeps this session draggable when localStorage throws and ignores invalid saved docks', async () => {
    localStorage.setItem(
      PREVIEW_CONTROLS_STORAGE_KEY,
      JSON.stringify({ state: { mobile: 'floating', desktop: { x: 200 } }, version: 0 })
    )
    await preferences.persist.rehydrate()
    expect(preferences.getState().mobile).toBe('bottom')
    expect(preferences.getState().desktop).toBe('bottom')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked storage')
    })
    render(<Controls />)
    drag(0, 200)
    expect(current.dock).toBe('left')
  })
})
