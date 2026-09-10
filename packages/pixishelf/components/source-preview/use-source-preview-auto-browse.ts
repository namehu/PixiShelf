'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  AUTO_BROWSE_STORAGE_KEY,
  useArtworkAutoBrowseStore,
  type AutoBrowseMode,
  type AutoBrowsePauseReason,
  type AutoBrowseStatus
} from '@/store/use-artwork-auto-browse-store'
import type { ControlledAutoBrowseState } from './controlled-auto-browse-controls'

interface SourcePreviewAutoBrowseRuntime extends ControlledAutoBrowseState {
  revision: number
}

type PreferenceUpdate = Partial<Pick<SourcePreviewAutoBrowseRuntime, 'scrollSpeed' | 'slideSeconds' | 'loop'>>

type Action =
  | { type: 'hydrate'; preferences: PreferenceUpdate }
  | { type: 'reset' }
  | { type: 'start'; mode: AutoBrowseMode }
  | { type: 'pause'; reason: AutoBrowsePauseReason }
  | { type: 'resume' }
  | { type: 'wait' }
  | { type: 'ready' }
  | { type: 'end' }
  | { type: 'error' }
  | { type: 'recover' }
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'preferences'; preferences: PreferenceUpdate }

const defaults: SourcePreviewAutoBrowseRuntime = {
  mode: null,
  status: 'idle',
  reason: null,
  controlsCollapsed: false,
  scrollSpeed: 50,
  slideSeconds: 1.5,
  loop: false,
  revision: 0
}

function bounded(value: unknown, fallback: number, min: number, max: number, step: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.max(min, Math.min(max, value)) / step) * step
}

function sanitizePreferences(value: unknown): PreferenceUpdate {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    scrollSpeed: bounded(input.scrollSpeed, defaults.scrollSpeed, 50, 800, 50),
    slideSeconds: bounded(input.slideSeconds, defaults.slideSeconds, 0.5, 3, 0.5),
    loop: input.loop === true
  }
}

function reduce(state: SourcePreviewAutoBrowseRuntime, action: Action): SourcePreviewAutoBrowseRuntime {
  const revision = state.revision + 1
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...sanitizePreferences(action.preferences), revision }
    case 'reset':
      return { ...state, mode: null, status: 'idle', reason: null, controlsCollapsed: false, revision }
    case 'start':
      return { ...state, mode: action.mode, status: 'running', reason: null, controlsCollapsed: false, revision }
    case 'pause':
      if (state.status !== 'running' && state.status !== 'waiting') return state
      return { ...state, status: 'paused', reason: action.reason, controlsCollapsed: false, revision }
    case 'resume':
      if (!state.mode || state.reason === 'error' || state.reason === 'zoom') return state
      return { ...state, status: 'running', reason: null, controlsCollapsed: false, revision }
    case 'wait':
      return state.status === 'running' ? { ...state, status: 'waiting', reason: null, revision } : state
    case 'ready':
      return state.status === 'waiting' ? { ...state, status: 'running', reason: null, revision } : state
    case 'end':
      return { ...state, status: 'ended', reason: null, controlsCollapsed: false, revision }
    case 'error':
      if (state.status !== 'running' && state.status !== 'waiting') return state
      return { ...state, status: 'paused', reason: 'error', controlsCollapsed: false, revision }
    case 'recover':
      return { ...state, status: 'paused', reason: null, controlsCollapsed: false, revision }
    case 'collapse':
      if (action.collapsed && state.status !== 'running' && state.status !== 'waiting') return state
      return { ...state, controlsCollapsed: action.collapsed, revision }
    case 'preferences':
      return { ...state, ...sanitizePreferences({ ...state, ...action.preferences }), revision }
  }
}

function readPreferences(): PreferenceUpdate {
  try {
    const raw = localStorage.getItem(AUTO_BROWSE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { state?: unknown }
    return sanitizePreferences(parsed.state)
  } catch {
    return {}
  }
}

export function useSourcePreviewAutoBrowse(previewId: string) {
  const [state, dispatch] = useReducer(reduce, defaults)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    dispatch({ type: 'hydrate', preferences: readPreferences() })
  }, [])

  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [previewId])

  const setPreferences = useCallback((preferences: PreferenceUpdate) => {
    const next = sanitizePreferences({ ...stateRef.current, ...preferences })
    dispatch({ type: 'preferences', preferences: next })
    // The shared store action only changes persisted preferences; its artwork runtime remains intact.
    useArtworkAutoBrowseStore.getState().setPreferences(next)
  }, [])
  const start = useCallback((mode: AutoBrowseMode) => dispatch({ type: 'start', mode }), [])
  const pause = useCallback(
    (reason: AutoBrowsePauseReason = 'manual') => dispatch({ type: 'pause', reason }),
    []
  )
  const resume = useCallback(() => dispatch({ type: 'resume' }), [])
  const wait = useCallback(() => dispatch({ type: 'wait' }), [])
  const ready = useCallback(() => dispatch({ type: 'ready' }), [])
  const end = useCallback(() => dispatch({ type: 'end' }), [])
  const error = useCallback(() => dispatch({ type: 'error' }), [])
  const recover = useCallback(() => dispatch({ type: 'recover' }), [])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  const setControlsCollapsed = useCallback(
    (collapsed: boolean) => dispatch({ type: 'collapse', collapsed }),
    []
  )

  return useMemo(
    () => ({
      state,
      start,
      pause,
      resume,
      wait,
      ready,
      end,
      error,
      recover,
      reset,
      setControlsCollapsed,
      setPreferences
    }),
    [end, error, pause, ready, recover, reset, resume, setControlsCollapsed, setPreferences, start, state, wait]
  )
}

export type SourcePreviewAutoBrowseStatus = AutoBrowseStatus
