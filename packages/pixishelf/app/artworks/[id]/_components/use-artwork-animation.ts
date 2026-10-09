'use client'

import { useEffect, useId } from 'react'
import { useArtworkAutoBrowseStore as store, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'

/** 两种阅读模式共用播放意图；完成回调必须仍属于当前播放尝试。 */
export function useArtworkAnimation(id: number | undefined, mode: AutoBrowseMode, resourceIdentity = '') {
  const state = store()
  const owner = useId()
  const manualOwned =
    state.manualAnimation?.owner === owner &&
    state.manualAnimation.id === id &&
    state.manualAnimation.resourceIdentity === resourceIdentity
  const manualPlaying = manualOwned && !state.manualAnimation?.paused
  const manualPaused = manualOwned && state.manualAnimation?.paused === true
  const autoRunning = ['running', 'waiting'].includes(state.status)
  const running = state.mode === mode && ['running', 'waiting'].includes(state.status)
  const owned =
    state.mode === mode &&
    id !== undefined &&
    state.activeAnimationId === id &&
    ['running', 'waiting', 'paused'].includes(state.status)
  const automatic = running && owned
  const { session, revision, animationAttempt } = state
  useEffect(() => () => store.getState().clearManualAnimation(owner), [owner, id, resourceIdentity])

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
    playing: automatic || (!autoRunning && manualPlaying && id !== undefined),
    playOnce: owned,
    playbackPaused: owned && state.status === 'paused',
    manualPlaybackPaused: !owned && !autoRunning && manualPaused && id !== undefined,
    playbackKey: `${session}:${mode}:${animationAttempt}`,
    autoBrowseControl: true,
    onPlayingChange: (playing: boolean) => {
      if (id === undefined) return
      const latest = store.getState()
      if (latest.mode === mode && ['running', 'waiting'].includes(latest.status)) {
        if (playing) store.getState().replayAnimation(id)
        else if (currentAttempt()) store.getState().stopAnimation(id)
      } else {
        if (playing && ['running', 'waiting'].includes(latest.status)) latest.pause('manual')
        if (playing && owned && latest.activeAnimationId === id) store.getState().stopAnimation(id)
        if (playing || (manualPlaying && latest.manualAnimation?.owner === owner)) {
          store.getState().setManualAnimation({ owner, id, resourceIdentity, paused: !playing })
        } else store.getState().clearManualAnimation(owner)
      }
    },
    onAnimationReady: () => {
      if (currentAttempt()) store.getState().animationReady(id!)
    },
    onAnimationBuffering: () => {
      if (currentAttempt()) store.getState().animationBuffering(id!)
    },
    onAnimationComplete: () => {
      if (currentAttempt()) store.getState().finishAnimation(id!)
    },
    onAnimationError: () => {
      store.getState().clearManualAnimation(owner)
      if (currentAttempt()) store.getState().pause('error')
    },
    onPlaybackInterrupted: () => {
      store.getState().clearManualAnimation(owner)
      if (currentAttempt()) store.getState().pause(document.hidden ? 'hidden' : 'manual')
      // Leaving the viewport releases retained progress, including while paused.
      const latest = store.getState()
      if (
        !document.hidden &&
        owned &&
        latest.session === session &&
        latest.mode === mode &&
        latest.animationAttempt === animationAttempt &&
        latest.activeAnimationId === id
      ) {
        latest.setActiveAnimation(null)
      }
    },
    stopManual: () => {
      store.getState().clearManualAnimation(owner)
    }
  }
}
