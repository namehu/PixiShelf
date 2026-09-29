'use client'

import type { ReactNode } from 'react'
import { ControlledAutoBrowseControls } from '@/components/source-preview/controlled-auto-browse-controls'
import { useArtworkAutoBrowseStore, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'

interface AutoBrowseControlsProps {
  mode: AutoBrowseMode
  current: number
  total: number
  navigation?: ReactNode
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
  navigation,
  onRestart,
  onRetry,
  onSkip,
  onExit,
  blocked,
  container
}: AutoBrowseControlsProps) {
  const state = useArtworkAutoBrowseStore()
  return (
    <ControlledAutoBrowseControls
      mode={mode}
      current={current}
      total={total}
      state={state}
      navigation={navigation}
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
