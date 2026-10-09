'use client'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { z } from 'zod'

export const PRIVACY_MEMORY_KEY = 'pixishelf-privacy-memory-v1'
export const PRIVACY_MEMORY_DURATION = 30 * 24 * 60 * 60 * 1000
export const privacyModeSchema = z.enum(['privacy', 'direct'])
export const privacyMemorySchema = z.object({
  mode: privacyModeSchema,
  expiresAt: z.number().finite().positive()
})
export const privacyVisitSchema = z.object({
  visitId: z.string().min(1),
  revision: z.string().min(1),
  mode: privacyModeSchema,
  remembered: privacyMemorySchema.nullable()
})
export type PrivacyMode = z.infer<typeof privacyModeSchema>
export type PrivacyMemory = z.infer<typeof privacyMemorySchema>
export type PrivacyVisit = z.infer<typeof privacyVisitSchema>
export interface PrivacyState {
  status: 'initializing' | 'pending' | PrivacyMode
  visit: PrivacyVisit | null
  remembered: PrivacyMemory | null
  storageError: boolean
}

export function createPrivacyStore(storage: StateStorage) {
  return createStore<PrivacyState>()(
    persist((): PrivacyState => ({ status: 'initializing', visit: null, remembered: null, storageError: false }), {
      name: PRIVACY_MEMORY_KEY,
      storage: createJSONStorage(() => storage),
      skipHydration: true,
      partialize: ({ remembered }) => ({ remembered }),
      merge: (persisted, current) => {
        const parsed = z.object({ remembered: privacyMemorySchema.nullable() }).safeParse(persisted)
        return { ...current, remembered: parsed.success ? parsed.data.remembered : null }
      }
    })
  )
}

// Access storage lazily: server rendering must never read a browser preference.
export const privacyStore = createPrivacyStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key)
})

export function usePrivacyStore<T>(selector: (state: PrivacyState) => T): T {
  return useStore(privacyStore, selector)
}
