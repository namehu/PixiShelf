import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClearModeHistory } from '../immersive-image-viewer'

describe('useClearModeHistory', () => {
  beforeEach(() => history.replaceState({}, '', window.location.href))

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses a history entry so the first Back action exits clear mode', () => {
    const setChromeHidden = vi.fn()
    const pushSpy = vi.spyOn(history, 'pushState')
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    const { result, rerender } = renderHook(({ hidden }) => useClearModeHistory(hidden, setChromeHidden), {
      initialProps: { hidden: false }
    })

    act(() => result.current.enterClearMode())
    expect(pushSpy).toHaveBeenCalledOnce()
    expect(setChromeHidden).toHaveBeenLastCalledWith(true)

    rerender({ hidden: true })
    act(() => result.current.exitClearMode())
    expect(backSpy).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })))
    expect(setChromeHidden).toHaveBeenLastCalledWith(false)
  })
})
