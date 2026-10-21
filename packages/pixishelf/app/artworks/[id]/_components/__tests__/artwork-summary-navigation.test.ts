import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settleSummaryNavigation } from '../artwork-summary-navigation'

vi.mock('../use-artwork-auto-scroll', () => ({ getAutoBrowseViewport: () => ({ top: 56, bottom: 844 }) }))

describe('summary navigation settling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
    vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(2634)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3478)
  })
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('settles the final group at the document scroll limit', () => {
    const anchor = document.createElement('div')
    anchor.dataset.summaryAnchor = '31'
    anchor.getBoundingClientRect = () => ({ top: 289, height: 455 }) as DOMRect
    document.body.append(anchor)
    const onSettled = vi.fn()
    settleSummaryNavigation({ mediaId: 31, isCurrent: () => true, onSettled })
    vi.advanceTimersByTime(300)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits through delayed virtualizer corrections before enabling observations', () => {
    let top = 56
    const anchor = document.createElement('div')
    anchor.dataset.summaryAnchor = '7'
    anchor.getBoundingClientRect = () => ({ top, height: 455 }) as DOMRect
    document.body.append(anchor)
    const onSettled = vi.fn()
    settleSummaryNavigation({ mediaId: 7, isCurrent: () => true, onSettled })
    vi.advanceTimersByTime(80)
    top = 61
    vi.advanceTimersByTime(80)
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('releases missing targets and lets user input stop pending corrections', () => {
    const onSettled = vi.fn()
    settleSummaryNavigation({ mediaId: 99, isCurrent: () => true, onSettled })
    vi.advanceTimersByTime(2100)
    expect(onSettled).toHaveBeenCalledTimes(1)
    settleSummaryNavigation({ mediaId: 99, isCurrent: () => true, onSettled })
    window.dispatchEvent(new Event('wheel'))
    expect(onSettled).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
