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
    scrollSpeed: Math.round(bounded(saved.scrollSpeed, 50, 50, 800) / 50) * 50,
    slideSeconds: Math.round(bounded(saved.slideSeconds, 1.5, 0.5, 3) * 2) / 2,
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
  activeVideoId: number | null
  activeAnimationId: number | null
  animationPhase: 'loading' | 'playing' | null
  animationAttempt: number
  completedAnimationIds: readonly number[]
  stoppedAnimationIds: readonly number[]
  finishAnimation: (id: number) => void
  stopAnimation: (id: number) => void
  replayAnimation: (id: number) => void
  animationReady: (id: number) => void
  setActiveAnimation: (id: number | null) => void
  // 跨虚拟列表卸载保留手动暂停意图，仅在作品会话结束时清空，不写入持久化偏好。
  pausedVideoIds: number[]
  setActiveVideo: (id: number | null) => void
  setVideoPaused: (id: number, paused: boolean) => void
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
  skippedIds: [],
  activeVideoId: null,
  activeAnimationId: null,
  animationPhase: null,
  completedAnimationIds: [],
  stoppedAnimationIds: [],
  pausedVideoIds: []
} as const

export const useArtworkAutoBrowseStore = create<AutoBrowseState>()(
  persist(
    (set, get) => ({
      ...preferences(null),
      ...runtimeDefaults,
      skippedIds: [],
      pausedVideoIds: [],
      animationAttempt: 0,
      // 每次激活/重播都递增尝试号，供播放器拒绝上一轮迟到的事件。
      setActiveAnimation: (id) => {
        if (get().activeAnimationId !== id) {
          set({
            activeAnimationId: id,
            animationPhase: id === null ? null : 'loading',
            animationAttempt: get().animationAttempt + 1,
            ...(id !== null ? { activeVideoId: null, currentMediaId: id } : {})
          })
        }
      },
      animationReady: (id) => {
        if (get().activeAnimationId === id) set({ animationPhase: 'playing', status: 'running' })
      },
      // 仅当前激活动图 ID 可以登记完成；尝试号和会话校验由调用方负责。
      finishAnimation: (id) => {
        if (get().activeAnimationId !== id) return
        set({
          activeAnimationId: null,
          animationPhase: null,
          completedAnimationIds: [...new Set([...get().completedAnimationIds, id])]
        })
      },
      stopAnimation: (id) =>
        set({
          activeAnimationId: null,
          animationPhase: null,
          completedAnimationIds: get().completedAnimationIds.filter((value) => value !== id),
          stoppedAnimationIds: [...new Set([...get().stoppedAnimationIds, id])]
        }),
      replayAnimation: (id) => {
        set({
          activeAnimationId: id,
          activeVideoId: null,
          currentMediaId: id,
          animationPhase: 'loading',
          animationAttempt: get().animationAttempt + 1,
          completedAnimationIds: get().completedAnimationIds.filter((value) => value !== id),
          stoppedAnimationIds: get().stoppedAnimationIds.filter((value) => value !== id),
          skippedIds: get().skippedIds.filter((value) => value !== id)
        })
      },
      setActiveVideo: (id) => {
        if (get().activeVideoId !== id) set({ activeVideoId: id })
      },
      setVideoPaused: (id, paused) =>
        set((state) => ({
          pausedVideoIds: paused
            ? [...new Set([...state.pausedVideoIds, id])]
            : state.pausedVideoIds.filter((value) => value !== id)
        })),
      session: 0,
      revision: 0,
      initialize: (artworkId) => {
        const session = get().session + 1
        set({
          ...runtimeDefaults,
          skippedIds: [],
          pausedVideoIds: [],
          artworkId,
          session,
          revision: get().revision + 1
        })
        return session
      },
      release: (session) => {
        if (get().session !== session) return
        set({
          ...runtimeDefaults,
          skippedIds: [],
          pausedVideoIds: [],
          session: session + 1,
          revision: get().revision + 1
        })
      },
      start: (mode) => {
        if (get().artworkId === null) return
        set({
          mode,
          completedAnimationIds: [],
          stoppedAnimationIds: [],
          animationPhase: null,
          activeAnimationId: null,
          status: 'running',
          reason: null,
          controlsCollapsed: false,
          skippedIds: [],
          revision: get().revision + 1
        })
      },
      pause: (reason = 'manual') => {
        if (!['running', 'waiting'].includes(get().status)) return
        set({
          status: 'paused',
          animationPhase: null,
          reason,
          activeAnimationId: null,
          controlsCollapsed: false,
          revision: get().revision + 1
        })
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
          animationPhase: null,
          completedAnimationIds: [],
          stoppedAnimationIds: [],
          status: 'idle',
          activeAnimationId: null,
          reason: null,
          controlsCollapsed: false,
          skippedIds: [],
          revision: get().revision + 1
        }),
      end: () =>
        set({
          status: 'ended',
          animationPhase: null,
          reason: null,
          activeAnimationId: null,
          controlsCollapsed: false,
          revision: get().revision + 1
        }),
      wait: () => {
        if (get().status === 'running') set({ status: 'waiting' })
      },
      ready: () => {
        if (get().status === 'waiting') set({ status: 'running' })
      },
      setCurrentMedia: (id) => {
        if (get().currentMediaId !== id) set({ currentMediaId: id })
      },
      setPreviewOpen: (previewOpen) =>
        set({ previewOpen, ...(previewOpen ? { activeAnimationId: null, animationPhase: null } : {}) }),
      setControlsCollapsed: (controlsCollapsed) => {
        if (controlsCollapsed && !['running', 'waiting'].includes(get().status)) return
        set({ controlsCollapsed })
      },
      closePreview: () =>
        set({
          previewOpen: false,
          activeAnimationId: null,
          animationPhase: null,
          controlsCollapsed: false,
          ...(get().mode === 'scroll'
            ? { status: 'paused' as const, reason: 'overlay' as const }
            : { mode: null, status: 'idle' as const, reason: null }),
          revision: get().revision + 1
        }),
      clearPauseReason: () => set({ reason: null }),
      skip: (id) => set({ skippedIds: [...get().skippedIds, id], reason: null }),
      resetCycle: () => set({ skippedIds: [], completedAnimationIds: [], stoppedAnimationIds: [] }),
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
