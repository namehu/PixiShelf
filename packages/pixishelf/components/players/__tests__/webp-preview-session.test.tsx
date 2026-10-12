import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CompressedInputCache } from '@pixishelf/webp-player'
import { useWebpPlayerStore } from '@/store/use-webp-player-store'
import { WebpPreviewSession, useWebpPreviewSession } from '../webp-preview-session'

let current: ReturnType<typeof useWebpPreviewSession>
function Child() {
  current = useWebpPreviewSession()
  return null
}
beforeEach(() => {
  useWebpPlayerStore.getState().setSessionOwner('alice')
})
afterEach(() => {
  cleanup()
  useWebpPlayerStore.getState().reset()
  vi.restoreAllMocks()
})
it('shares pressure and input across child rerenders, clears on close and account change', () => {
  const clear = vi.spyOn(CompressedInputCache.prototype, 'clear')
  const view = render(
    <WebpPreviewSession open scopeKey="artwork">
      <Child />
    </WebpPreviewSession>
  )
  const first = current
  expect(first).not.toBeNull()
  view.rerender(
    <WebpPreviewSession open scopeKey="artwork">
      <Child />
    </WebpPreviewSession>
  )
  expect(current).toBe(first)
  act(() => useWebpPlayerStore.getState().setSessionOwner('bob'))
  expect(current).not.toBe(first)
  expect(clear.mock.instances).toContain(first!.inputCache)
  const second = current
  view.rerender(
    <WebpPreviewSession open={false} scopeKey="artwork">
      <Child />
    </WebpPreviewSession>
  )
  expect(current).toBeNull()
  expect(clear.mock.instances).toContain(second!.inputCache)
})
it('does not provide a media cache without an account and handles hidden/pagehide', () => {
  act(() => useWebpPlayerStore.getState().reset())
  const view = render(
    <WebpPreviewSession open scopeKey="one">
      <Child />
    </WebpPreviewSession>
  )
  expect(current).toBeNull()
  act(() => useWebpPlayerStore.getState().setSessionOwner('alice'))
  const trim = vi.spyOn(current!.inputCache, 'trim'),
    clear = vi.spyOn(current!.inputCache, 'clear')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(trim).toHaveBeenCalledOnce()
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(clear).toHaveBeenCalledOnce()
  view.unmount()
})
it('replaces the scope on artwork changes and permits only one active preview pool', () => {
  const firstView = render(
    <WebpPreviewSession open scopeKey="one">
      <Child />
    </WebpPreviewSession>
  )
  const first = current!,
    clear = vi.spyOn(first.inputCache, 'clear')
  const secondView = render(
    <WebpPreviewSession open scopeKey="two">
      <Child />
    </WebpPreviewSession>
  )
  expect(clear).toHaveBeenCalledOnce()
  expect(current).not.toBe(first)
  secondView.unmount()
  firstView.unmount()
})
