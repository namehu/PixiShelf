'use client'

import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ControlledAutoBrowseControls } from '@/components/media-preview/controlled-auto-browse-controls'
import { useArtworkAutoBrowseStore, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'

interface AutoBrowseControlsProps {
  mode: AutoBrowseMode
  current: number
  total: number
  compact?: boolean
  navigation?: ReactNode
  trailingControl?: ReactNode
  onRestart: () => void
  onRetry: () => void
  onSkip: () => void
  onExit?: () => void
  blocked?: boolean
  container?: HTMLElement | null
}

export function AutoBrowseControls({
  mode,
  current,
  total,
  compact,
  navigation,
  trailingControl,
  onRestart,
  onRetry,
  onSkip,
  onExit,
  blocked,
  container
}: AutoBrowseControlsProps) {
  const state = useArtworkAutoBrowseStore(
    useShallow((state) => ({
      mode: state.mode,
      status: state.status,
      reason: state.reason,
      controlsCollapsed: state.controlsCollapsed,
      scrollSpeed: state.scrollSpeed,
      slideSeconds: state.slideSeconds,
      loop: state.loop,
      animationPhase: state.animationPhase,
      start: state.start,
      pause: state.pause,
      resume: state.resume,
      setControlsCollapsed: state.setControlsCollapsed,
      setPreferences: state.setPreferences
    }))
  )
  return (
    <ControlledAutoBrowseControls
      mode={mode}
      current={current}
      total={total}
      state={state}
      compact={compact}
      navigation={navigation}
      trailingControl={trailingControl}
      onStart={state.start}
      onPause={state.pause}
      onResume={state.resume}
      onSetControlsCollapsed={state.setControlsCollapsed}
      onSetPreferences={state.setPreferences}
      onRestart={onRestart}
      onRetry={onRetry}
      onSkip={onSkip}
      onExit={onExit}
      blocked={blocked}
      container={container}
    />
  )
}
