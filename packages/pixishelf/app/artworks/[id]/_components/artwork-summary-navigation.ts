import { getAutoBrowseViewport } from './use-artwork-auto-scroll'

/** Wait for measured virtual rows to settle; never hold reading disabled indefinitely. */
export function settleSummaryNavigation({ mediaId, isCurrent, onSettled }: {
  mediaId?: number
  isCurrent: () => boolean
  onSettled: () => void
}) {
  let frame = 0
  let previousPosition = ''
  let stableSince = performance.now()
  let done = false
  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    clearTimeout(deadline)
    window.removeEventListener('wheel', finish)
    window.removeEventListener('touchstart', finish)
    window.removeEventListener('keydown', finish)
    if (isCurrent()) onSettled()
  }
  const deadline = window.setTimeout(finish, 2_000)
  const settle = () => {
    if (!isCurrent()) { finish(); return }
    const element = mediaId === undefined ? null : document.querySelector<HTMLElement>(`[data-summary-anchor="${mediaId}"]`)
    if (mediaId !== undefined && !element) { frame = requestAnimationFrame(settle); return }
    const rect = element?.getBoundingClientRect()
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const target = Math.max(0, Math.min(maxScroll, window.scrollY + (rect ? rect.top - getAutoBrowseViewport().top : 0)))
    if (Math.abs(target - window.scrollY) > 2) window.scrollTo({ top: target, behavior: 'instant' })
    const position = `${window.scrollY}:${rect?.top ?? 0}:${rect?.height ?? 0}:${maxScroll}`
    if (position !== previousPosition) stableSince = performance.now()
    previousPosition = position
    // Virtualizer retries span several animation frames after scrollToIndex returns.
    if (performance.now() - stableSince >= 100) { finish(); return }
    frame = requestAnimationFrame(settle)
  }
  window.addEventListener('wheel', finish, { passive: true })
  window.addEventListener('touchstart', finish, { passive: true })
  window.addEventListener('keydown', finish)
  frame = requestAnimationFrame(settle)
}
