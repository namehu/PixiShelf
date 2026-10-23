import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkDetailControlsProvider, ArtworkFloatingPortal } from '../artwork-detail-controls'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

const mocks = vi.hoisted(() => ({
  changeMode: vi.fn(),
  summary: null as {
    ready: boolean
    mode: 'complete' | 'stack'
    groups: { mediaIds: number[] }[]
    navigating: boolean
    changeMode: (mode: 'complete' | 'stack') => void
  } | null
}))
vi.mock('../artwork-summary-context', () => ({ useArtworkSummary: () => mocks.summary }))

vi.mock('@/hooks/use-artwork-rating', () => ({
  useArtworkRating: () => ({
    level: null,
    confirmedLevel: null,
    isLoading: false,
    isSaving: false,
    error: null,
    setLevel: vi.fn(),
    retry: vi.fn()
  })
}))
vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => true
}))

function Probe({ toolbar = false }: { toolbar?: boolean }) {
  const view = useArtworkMediaView()!
  useEffect(() => {
    view.setReaderBlocked(toolbar, 'toolbar')
    return () => view.setReaderBlocked(false, 'toolbar')
  }, [toolbar, view.setReaderBlocked])
  return <output data-testid="blocked">{String(view.readerBlocked)}</output>
}
function Harness({ media = false, toolbar = false }: { media?: boolean; toolbar?: boolean }) {
  return (
    <ArtworkMediaViewProvider>
      <ArtworkDetailControlsProvider artworkId={7}>
        <Probe toolbar={toolbar} />
        {media && (
          <ArtworkFloatingPortal active>
            <button>媒体操作</button>
          </ArtworkFloatingPortal>
        )}
      </ArtworkDetailControlsProvider>
    </ArtworkMediaViewProvider>
  )
}
beforeEach(() => {
  mocks.summary = null
  mocks.changeMode.mockClear()
  useArtworkAutoBrowseStore.setState(useArtworkAutoBrowseStore.getInitialState())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('stable detail floating controls', () => {
  it.each([
    ['complete', 'stack', '切换到堆叠浏览'],
    ['stack', 'complete', '切换到完整浏览']
  ] as const)('switches from %s to %s and closes the dock', (mode, nextMode, label) => {
    mocks.summary = { ready: true, mode, groups: [{ mediaIds: [1, 2] }], navigating: false, changeMode: mocks.changeMode }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开作品快捷操作' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(mocks.changeMode).toHaveBeenCalledWith(nextMode)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    { ready: false, mediaIds: [1, 2] },
    { ready: true, mediaIds: [1] }
  ])('hides mode switching when no ready stack is available: %j', ({ ready, mediaIds }) => {
    mocks.summary = { ready, mode: 'complete', groups: [{ mediaIds }], navigating: false, changeMode: mocks.changeMode }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开作品快捷操作' }))
    expect(screen.queryByRole('button', { name: '切换到堆叠浏览' })).toBeNull()
  })

  it('disables mode switching while locating media', () => {
    mocks.summary = { ready: true, mode: 'complete', groups: [{ mediaIds: [1, 2] }], navigating: true, changeMode: mocks.changeMode }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '打开作品快捷操作' }))
    const button = screen.getByRole('button', { name: '切换到堆叠浏览' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(mocks.changeMode).not.toHaveBeenCalled()
  })

  it('offers scoring without a mounted media list and restores focus to the dock', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开作品快捷操作' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '评分：未评分' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('blocked').textContent).toBe('true')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('blocked').textContent).toBe('false')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps other reader blockers when scoring closes', async () => {
    render(<Harness toolbar />)
    fireEvent.click(screen.getByRole('button', { name: '打开作品快捷操作' }))
    fireEvent.click(screen.getByRole('button', { name: '评分：未评分' }))
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('blocked').textContent).toBe('true')
  })

  it('uses one dock and restores fallback operations when a filtered media list unmounts', () => {
    const view = render(<Harness media />)
    expect(
      screen.getByRole('button', { name: '媒体操作' }).closest('[data-testid="artwork-floating-controls"]')
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打开作品快捷操作' })).toBeNull()
    view.rerender(<Harness />)
    expect(screen.getByRole('button', { name: '打开作品快捷操作' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '媒体操作' })).toBeNull()
  })
})
