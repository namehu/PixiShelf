'use client'

import { useEffect, useState } from 'react'
import { useArtworkAutoBrowseStore as store, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'

/** 两种阅读模式共用播放意图；完成回调必须仍属于当前播放尝试。 */
export function useArtworkAnimation(id: number | undefined, mode: AutoBrowseMode) {
  const state = store()
  const [manualId, setManualId] = useState<number | null>(null)
  const running = state.mode === mode && ['running', 'waiting'].includes(state.status)
  const automatic = running && id !== undefined && state.activeAnimationId === id
  const { session, revision, animationAttempt } = state
  // 自动浏览接管后清除手动播放意图，避免退出自动模式时恢复旧的手动播放。
  useEffect(() => {
    if (running) setManualId(null)
  }, [running])

  // revision 是状态版本；会话、状态版本或尝试号变化都会使旧回调失效。
  const currentAttempt = () => {
    const latest = store.getState()
    return (
      automatic &&
      latest.session === session &&
      latest.revision === revision &&
      latest.animationAttempt === animationAttempt &&
      latest.activeAnimationId === id &&
      latest.mode === mode &&
      ['running', 'waiting'].includes(latest.status)
    )
  }
  return {
    playing: automatic || (!running && manualId === id && id !== undefined),
    playOnce: automatic,
    playbackKey: `${session}:${revision}:${animationAttempt}`,
    autoBrowseControl: true,
    onPlayingChange: (playing: boolean) => {
      if (id === undefined) return
      const latest = store.getState()
      if (latest.mode === mode && ['running', 'waiting'].includes(latest.status)) {
        setManualId(null)
        if (playing) store.getState().replayAnimation(id)
        else store.getState().stopAnimation(id)
      } else setManualId(playing ? id : null)
    },
    onAnimationReady: () => {
      if (currentAttempt()) store.getState().animationReady(id!)
    },
    onAnimationComplete: () => {
      if (currentAttempt()) store.getState().finishAnimation(id!)
    },
    onAnimationError: () => {
      setManualId(null)
      if (currentAttempt()) store.getState().pause('error')
    },
    onPlaybackInterrupted: () => {
      setManualId(null)
      if (currentAttempt()) store.getState().pause(document.hidden ? 'hidden' : 'manual')
    },
    stopManual: () => setManualId(null)
  }
}
