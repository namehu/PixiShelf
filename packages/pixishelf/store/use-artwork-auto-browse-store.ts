'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type AutoBrowseMode = 'scroll' | 'slideshow'
export type AutoBrowseStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'ended'
export type AutoBrowsePauseReason = 'manual' | 'hidden' | 'overlay' | 'video' | 'error' | 'zoom' | null
export type PreviewStatus = 'loading' | 'ready' | 'error'
export const AUTO_BROWSE_STORAGE_KEY = 'pixishelf-artwork-auto-browse-settings'

interface AutoBrowsePreferences {
  scrollSpeed: number
  slideSeconds: number
  loop: boolean
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function preferences(value: unknown): AutoBrowsePreferences {
  const saved = value && typeof value === 'object' ? (value as Partial<AutoBrowsePreferences>) : {}
  return {
    scrollSpeed: bounded(saved.scrollSpeed, 40, 10, 400),
    slideSeconds: bounded(saved.slideSeconds, 5, 2, 30),
    loop: saved.loop === true
  }
}

interface AutoBrowseState extends AutoBrowsePreferences {
  artworkId: number | null
  session: number
  revision: number
  mode: AutoBrowseMode | null
  status: AutoBrowseStatus
  reason: AutoBrowsePauseReason
  currentMediaId: number | null
  previewOpen: boolean
  controlsCollapsed: boolean
  skippedIds: number[]
  initialize: (artworkId: number) => number
  release: (session: number) => void
  start: (mode: AutoBrowseMode) => void
  pause: (reason?: AutoBrowsePauseReason) => void
  resume: () => void
  stop: () => void
  end: () => void
  wait: () => void
  ready: () => void
  setCurrentMedia: (id: number) => void
  setPreviewOpen: (open: boolean) => void
  setControlsCollapsed: (collapsed: boolean) => void
  closePreview: () => void
  clearPauseReason: () => void
  skip: (id: number) => void
  resetCycle: () => void
  setPreferences: (value: Partial<AutoBrowsePreferences>) => void
}

const runtimeDefaults = {
  artworkId: null,
  mode: null,
  status: 'idle',
  reason: null,
  currentMediaId: null,
  previewOpen: false,
  controlsCollapsed: false,
  skippedIds: []
} as const

export const useArtworkAutoBrowseStore = create<AutoBrowseState>()(
  persist(
    (set, get) => ({
      ...preferences(null),
      ...runtimeDefaults,
      skippedIds: [],
      session: 0,
      revision: 0,
      initialize: (artworkId) => {
        const session = get().session + 1
        set({ ...runtimeDefaults, skippedIds: [], artworkId, session, revision: get().revision + 1 })
        return session
      },
      release: (session) => {
        if (get().session !== session) return
        set({ ...runtimeDefaults, skippedIds: [], session: session + 1, revision: get().revision + 1 })
      },
      start: (mode) => {
        if (get().artworkId === null) return
        set({
          mode,
          status: 'running',
          reason: null,
          controlsCollapsed: false,
          skippedIds: [],
          revision: get().revision + 1
        })
      },
      pause: (reason = 'manual') => {
        if (!['running', 'waiting'].includes(get().status)) return
        set({ status: 'paused', reason, controlsCollapsed: false, revision: get().revision + 1 })
      },
      resume: () => {
        const state = get()
        if (!state.mode || state.artworkId === null) return
        set({
          status: 'running',
          controlsCollapsed: false,
          reason: null,
          revision: state.revision + 1,
          skippedIds:
            state.reason === 'video' && state.currentMediaId !== null
              ? [...state.skippedIds, state.currentMediaId]
              : state.skippedIds
        })
      },
      stop: () =>
        set({
          mode: null,
          status: 'idle',
          reason: null,
          controlsCollapsed: false,
          skippedIds: [],
          revision: get().revision + 1
        }),
      end: () => set({ status: 'ended', reason: null, controlsCollapsed: false, revision: get().revision + 1 }),
      wait: () => {
        if (get().status === 'running') set({ status: 'waiting' })
      },
      ready: () => {
        if (get().status === 'waiting') set({ status: 'running' })
      },
      setCurrentMedia: (id) => {
        if (get().currentMediaId !== id) set({ currentMediaId: id })
      },
      setPreviewOpen: (previewOpen) => set({ previewOpen }),
      setControlsCollapsed: (controlsCollapsed) => {
        if (controlsCollapsed && !['running', 'waiting'].includes(get().status)) return
        set({ controlsCollapsed })
      },
      closePreview: () =>
        set({
          previewOpen: false,
          controlsCollapsed: false,
          ...(get().mode ? { mode: 'scroll' as const, status: 'paused' as const, reason: 'overlay' as const } : {}),
          revision: get().revision + 1
        }),
      clearPauseReason: () => set({ reason: null }),
      skip: (id) => set({ skippedIds: [...get().skippedIds, id], reason: null }),
      resetCycle: () => set({ skippedIds: [] }),
      setPreferences: (value) => set({ ...preferences({ ...get(), ...value }), revision: get().revision + 1 })
    }),
    {
      name: AUTO_BROWSE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ scrollSpeed, slideSeconds, loop }) => ({ scrollSpeed, slideSeconds, loop }),
      // Persisted JSON must never restore playback or overwrite an active session.
      merge: (saved, current) => ({ ...current, ...preferences(saved) })
    }
  )
)
