'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type PreviewControlsDock = 'bottom' | 'left' | 'right'
export type PreviewControlsViewport = 'mobile' | 'desktop'
export const PREVIEW_CONTROLS_STORAGE_KEY = 'pixishelf-preview-controls-settings'
const normalizeDock = (value: unknown): PreviewControlsDock =>
  value === 'left' || value === 'right' ? value : 'bottom'

export const usePreviewControlsPreferences = create<{
  mobile: PreviewControlsDock
  desktop: PreviewControlsDock
  setDock: (viewport: PreviewControlsViewport, dock: PreviewControlsDock) => void
}>()(
  persist((set) => ({ mobile: 'bottom', desktop: 'bottom', setDock: (viewport, dock) => set({ [viewport]: dock }) }), {
    name: PREVIEW_CONTROLS_STORAGE_KEY,
    storage: createJSONStorage(() => ({
      getItem: (name) => {
        try {
          return localStorage.getItem(name)
        } catch {
          return null
        }
      },
      setItem: (name, value) => {
        try {
          localStorage.setItem(name, value)
        } catch {
          /* Keep this session's dock in memory. */
        }
      },
      removeItem: (name) => {
        try {
          localStorage.removeItem(name)
        } catch {
          /* Storage is optional. */
        }
      }
    })),
    skipHydration: true,
    partialize: ({ mobile, desktop }) => ({ mobile, desktop }),
    merge: (saved, current) => {
      const data = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
      return { ...current, mobile: normalizeDock(data.mobile), desktop: normalizeDock(data.desktop) }
    }
  })
)
