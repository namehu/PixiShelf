import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler, type HTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkAutoBrowseStore as store } from '@/store/use-artwork-auto-browse-store'
import { AutoBrowseControls } from '../auto-browse-controls'
import { useAutoBrowseInterruption } from '../use-auto-browse-interruption'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({
      layout: _layout,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & { layout?: unknown; transition?: unknown }) => {
      void _layout
      void _transition
      return <div {...props} />
    }
  }
}))

function Controls() {
  useAutoBrowseInterruption(1)
  return (
    <AutoBrowseControls mode="scroll" current={12} total={75} onRestart={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} />
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    pointerType: string
    isPrimary = true
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? 'mouse'
    }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('auto browse control docking', () => {
  function compactControls() {
    store.getState().initialize(1)
    return render(<AutoBrowseControls compact mode="slideshow" current={12} total={75}
      onRestart={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} />)
  }

  it('keeps only playback and count visible, with settings after one second of mouse hover', () => {
    compactControls()
    const play = screen.getByRole('button', { name: '开始或继续自动浏览' })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '自动浏览设置' }).textContent).toBe('12/75')
    fireEvent.click(play)
    fireEvent.pointerEnter(play, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(999))
    expect(screen.queryByText(/每张停留：/)).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText(/每张停留：/)).toBeTruthy()
    expect(store.getState().status).toBe('paused')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    expect(store.getState().status).toBe('paused')
  })

  it('cancels a short hover and clears the timer on unmount', () => {
    const view = compactControls()
    const play = screen.getByRole('button', { name: '开始或继续自动浏览' })
    fireEvent.pointerEnter(play, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.pointerLeave(play, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText(/每张停留：/)).toBeNull()
    fireEvent.pointerEnter(play, { pointerType: 'mouse' })
    view.unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(store.getState().status).toBe('idle')
  })

  it('opens on upward swipe without toggling playback on release, and keeps recovery accessible', () => {
    compactControls()
    act(() => { store.getState().start('slideshow'); store.getState().pause('error') })
    const count = screen.getByRole('button', { name: '自动浏览设置' })
    fireEvent.pointerDown(count, { pointerType: 'touch', clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(count, { pointerType: 'touch', clientX: 103, clientY: 70 })
    fireEvent.pointerUp(count, { pointerType: 'touch' })
    fireEvent.click(count)
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '跳过' })).toBeTruthy()
    expect(store.getState().status).toBe('paused')
  })

  it('offers count-click and keyboard access while compact playback never docks away', () => {
    compactControls()
    fireEvent.click(screen.getByRole('button', { name: '自动浏览设置' }))
    expect(screen.getByText(/每张停留：/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    const play = screen.getByRole('button', { name: '开始或继续自动浏览' })
    fireEvent.click(play)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('button', { name: '暂停自动浏览' })).toBeTruthy()
    fireEvent.keyDown(play, { key: 'ArrowUp' })
    expect(screen.getByText(/每张停留：/)).toBeTruthy()
  })

  it('ignores unrelated media updates but renders waiting and preference changes', () => {
    store.getState().initialize(1)
    store.getState().start('scroll')
    const committed = vi.fn()
    render(
      <Profiler id="controls" onRender={committed}>
        <AutoBrowseControls
          mode="scroll"
          current={1}
          total={75}
          onRestart={vi.fn()}
          onRetry={vi.fn()}
          onSkip={vi.fn()}
        />
      </Profiler>
    )
    committed.mockClear()
    act(() => store.getState().setCurrentMedia(2))
    expect(committed).not.toHaveBeenCalled()
    act(() => store.getState().wait())
    expect(committed).toHaveBeenCalled()
    committed.mockClear()
    act(() => store.getState().setPreferences({ scrollSpeed: 800 }))
    expect(committed).toHaveBeenCalled()
  })

  it('keeps pause available while loading and buffering without changing its icon', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    const pause = screen.getByRole('button', { name: '暂停自动浏览' })
    const icon = pause.querySelector('svg')
    expect(icon?.classList.contains('lucide-pause')).toBe(true)
    act(() => {
      store.getState().setActiveAnimation(12)
      store.getState().wait()
    })
    expect(store.getState().status).toBe('waiting')
    expect(pause.querySelector('svg')).toBe(icon)
    for (let index = 0; index < 3; index++) {
      act(() => store.getState().animationReady(12))
      expect(pause.querySelector('svg')).toBe(icon)
      act(() => store.getState().animationBuffering(12))
      expect(store.getState().status).toBe('waiting')
      expect(pause.querySelector('svg')).toBe(icon)
    }
    fireEvent.click(pause)
    expect(store.getState().status).toBe('paused')
    expect(screen.getByRole('button', { name: '开始或继续自动浏览' }).querySelector('.lucide-play')).toBeTruthy()
  })

  it('keeps the collapsed entry stable during buffering and expands without pausing', () => {
    render(<Controls />)
    act(() => {
      store.getState().start('scroll')
      store.getState().setActiveAnimation(12)
      store.getState().setControlsCollapsed(true)
    })
    const dock = screen.getByRole('button', { name: '展开自动浏览控制，当前第 12 张，共 75 张' })
    const icon = dock.querySelector('svg')
    expect(icon?.classList.contains('lucide-play')).toBe(true)
    act(() => store.getState().animationBuffering(12))
    expect(dock.querySelector('svg')).toBe(icon)
    fireEvent.click(dock)
    expect(store.getState().status).toBe('waiting')
    expect(screen.getByRole('button', { name: '暂停自动浏览' }).querySelector('.lucide-pause')).toBeTruthy()
  })

  it('docks after four seconds across media changes and expands without interrupting playback', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(2000))
    act(() => {
      store.getState().wait()
      store.getState().setCurrentMedia(13)
      store.getState().ready()
    })
    act(() => vi.advanceTimersByTime(1999))
    expect(screen.getByRole('button', { name: '暂停自动浏览' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    const dock = screen.getByRole('button', { name: '展开自动浏览控制，当前第 12 张，共 75 张' })
    fireEvent.pointerDown(dock)
    fireEvent.click(dock)
    expect(store.getState().status).toBe('running')
    expect(screen.getByRole('button', { name: '暂停自动浏览' })).toBeTruthy()
  })

  it('leaves Space inside the image preview to the like shortcut', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    const preview = document.createElement('div')
    preview.dataset.previewLikeShortcut = ''
    document.body.append(preview)
    fireEvent.keyDown(preview, { code: 'Space', key: ' ' })
    expect(store.getState().status).toBe('running')
    preview.remove()
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })
    expect(store.getState().status).toBe('paused')
  })

  it('automatically reveals controls on manual takeover and on load failure', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.wheel(document)
    expect(screen.getByRole('button', { name: '开始或继续自动浏览' })).toBeTruthy()
    act(() => store.getState().resume())
    act(() => vi.advanceTimersByTime(4000))
    act(() => store.getState().pause('error'))
    expect(store.getState().controlsCollapsed).toBe(false)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    expect(screen.getByRole('status').className).toContain('sr-only')
    fireEvent.click(screen.getByRole('button', { name: '自动浏览设置' }))
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '跳过' })).toBeTruthy()
  })

  it('resets the idle delay on interaction and preserves keyboard focus', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(3000))
    const pause = screen.getByRole('button', { name: '暂停自动浏览' })
    fireEvent.pointerMove(pause)
    act(() => vi.advanceTimersByTime(3000))
    expect(store.getState().controlsCollapsed).toBe(false)
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => pause.focus())
    act(() => vi.advanceTimersByTime(5000))
    expect(document.activeElement).toBe(pause)
    expect(store.getState().controlsCollapsed).toBe(false)
  })

  it('clears a pending collapse when leaving the artwork', () => {
    const { unmount } = render(<Controls />)
    act(() => store.getState().start('scroll'))
    unmount()
    act(() => {
      store.getState().initialize(2)
      store.getState().start('slideshow')
      vi.advanceTimersByTime(5000)
    })
    expect(store.getState().controlsCollapsed).toBe(false)
  })
})
