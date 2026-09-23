'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const WEBP_PLAYER_SESSION_KEY = 'pixishelf-webp-player-session'

interface PlayerManifest {
  version: string
}

interface WebpPlayerState {
  ownerId: string | null
  manifest: PlayerManifest | null
  pending: Promise<PlayerManifest> | null
  controller: AbortController | null
  loadManifest: () => Promise<PlayerManifest>
  invalidateManifest: (version: string) => void
  setSessionOwner: (ownerId: string | null) => void
  reset: () => void
}

function parseManifest(value: unknown): PlayerManifest | null {
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    typeof value.version === 'string' &&
    /^[a-f0-9]{16}$/.test(value.version)
  ) {
    return { version: value.version }
  }
  return null
}

export const useWebpPlayerStore = create<WebpPlayerState>()(
  persist(
    (set, get) => ({
      ownerId: null,
      manifest: null,
      pending: null,
      controller: null,
      loadManifest: () => {
        const cached = get()
        if (cached.manifest) return Promise.resolve(cached.manifest)
        if (cached.pending) return cached.pending

        // The session owns this request; unmounting one consumer must not abort it.
        const controller = new AbortController()
        const pending: Promise<PlayerManifest> = (async () => {
          const response = await fetch('/webp-player/manifest.json', { cache: 'no-cache', signal: controller.signal })
          if (!response.ok) throw new Error('Player assets unavailable')
          const manifest = parseManifest(await response.json())
          if (!manifest) throw new Error('Invalid player manifest')
          if (get().controller !== controller) throw new DOMException('Playback session changed', 'AbortError')
          set({ manifest, pending: null, controller: null })
          return manifest
        })().catch((error: unknown) => {
          // A late failure from the previous session cannot clear a newer request.
          if (get().controller === controller) set({ pending: null, controller: null })
          throw error
        })
        set({ pending, controller })
        return pending
      },
      setSessionOwner: (ownerId) => {
        if (get().ownerId === ownerId) return
        get().reset()
        set({ ownerId })
      },
      invalidateManifest: (version) => {
        if (get().manifest?.version === version) set({ manifest: null })
      },
      reset: () => {
        get().controller?.abort()
        set({ ownerId: null, manifest: null, pending: null, controller: null })
      }
    }),
    {
      name: WEBP_PLAYER_SESSION_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return sessionStorage.getItem(name)
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          try {
            sessionStorage.setItem(name, value)
          } catch {
            /* Memory cache remains usable. */
          }
        },
        removeItem: (name) => {
          try {
            sessionStorage.removeItem(name)
          } catch {
            /* Storage may be disabled. */
          }
        }
      })),
      partialize: ({ ownerId, manifest }) => ({ ownerId, manifest }),
      merge: (saved, current) => {
        const value = saved && typeof saved === 'object' ? (saved as Partial<WebpPlayerState>) : {}
        return {
          ...current,
          ownerId: typeof value.ownerId === 'string' ? value.ownerId : null,
          manifest: parseManifest(value.manifest)
        }
      }
    }
  )
)
