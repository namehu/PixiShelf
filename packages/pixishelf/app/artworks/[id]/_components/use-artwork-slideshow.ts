'use client'

import { useEffect } from 'react'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

export function useArtworkSlideshow({
  index,
  count,
  ready,
  error,
  blocked,
  transitioning,
  mediaId,
  animated = false,
  onNext,
  onFirst,
  enabled
}: {
  index: number
  count: number
  ready: boolean
  error: boolean
  blocked: boolean
  transitioning: boolean
  enabled: boolean
  mediaId?: number
  animated?: boolean
  onNext: () => void
  onFirst: () => void
}) {
  const active = useArtworkAutoBrowseStore(
    (state) => state.mode === 'slideshow' && ['running', 'waiting'].includes(state.status)
  )
  const revision = useArtworkAutoBrowseStore((state) => state.revision)
  const completed = useArtworkAutoBrowseStore(
    (state) => mediaId !== undefined && state.completedAnimationIds.includes(mediaId)
  )
  const stopped = useArtworkAutoBrowseStore(
    (state) => mediaId !== undefined && state.stoppedAnimationIds.includes(mediaId)
  )
  const skipped = useArtworkAutoBrowseStore((state) => mediaId !== undefined && state.skippedIds.includes(mediaId))
  const animationId = useArtworkAutoBrowseStore((state) => state.activeAnimationId)
  const animationPhase = useArtworkAutoBrowseStore((state) => state.animationPhase)
  useEffect(() => {
    if (!active || !enabled) return
    const store = useArtworkAutoBrowseStore
    const state = store.getState()
    if (blocked) {
      state.pause('zoom')
      return
    }
    if (error && !skipped) {
      state.pause('error')
      return
    }
    if ((!ready && !skipped) || transitioning) {
      state.wait()
      return
    }
    if (animated && mediaId !== undefined && !completed && !stopped && !skipped) {
      // 动图未完成时不启动静态停留计时；正常完成后直接换页，主动停止后按静态时长停留。
      state.setActiveAnimation(mediaId)
      if (animationPhase === 'playing') state.ready()
      else state.wait()
      return
    }
    state.ready()
    const { session, currentMediaId } = state
    const timeout = window.setTimeout(
      () => {
        const latest = store.getState()
        // 定时期间状态可能已切页、暂停或重启，只允许原始轮播轮次继续。
        if (
          latest.session !== session ||
          latest.revision !== revision ||
          latest.currentMediaId !== currentMediaId ||
          latest.mode !== 'slideshow' ||
          latest.status !== 'running'
        ) {
          return
        }
        if (index < count - 1) onNext()
        else if (latest.loop && count > 1) {
          latest.resetCycle()
          onFirst()
        } else latest.end()
      },
      completed || skipped ? 0 : state.slideSeconds * 1000
    )
    // 依赖变化即撤销旧计时，避免快速切换时旧回调越过当前媒体。
    return () => window.clearTimeout(timeout)
  }, [
    active,
    blocked,
    count,
    enabled,
    error,
    index,
    onFirst,
    onNext,
    ready,
    revision,
    transitioning,
    mediaId,
    animated,
    completed,
    stopped,
    skipped,
    animationId,
    animationPhase
  ])
}
