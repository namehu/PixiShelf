'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, useAuthUser } from '@/components/auth'
import { useTRPCClient } from '@/lib/trpc'
import { getArtworkRatingSession, type ArtworkRatingSnapshot } from '@/lib/artwork-rating-state'
import { refreshArtworkLikeCache } from '@/lib/artwork-like-cache'
import { useViewerStore } from '@/store/viewer-store'
import type { ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'

const empty: ArtworkRatingSnapshot = { level: null, confirmedLevel: null, isLoading: false, isSaving: false, error: null }
const emptySnapshot = () => empty
const noSubscribe = () => () => {}
const noop = () => {}

export function useArtworkRating(artworkId: number, initialLevel?: ArtworkRatingLevel) {
  const owner = useAuthUser()?.id
  const queryClient = useQueryClient()
  const client = useTRPCClient()
  const session = useMemo(() => {
    if (!owner || artworkId <= 0) return null
    const isCurrentAccount = () => useAuthStore.getState().user?.id === owner
    return getArtworkRatingSession(queryClient, owner, artworkId, {
      get: (signal) => client.artworkRating.get.query({ artworkId, expectedUserId: owner }, { signal }),
      set: (level) => client.artworkRating.set.mutate({ artworkId, expectedUserId: owner, level }),
      isCurrentAccount,
      onLoaded: (state) => useViewerStore.getState().syncImageRatingStatus(artworkId, state.level),
      onConfirmed: async (state) => {
        if (isCurrentAccount()) useViewerStore.getState().syncImageRatingStatus(artworkId, state.level)
        await refreshArtworkLikeCache(queryClient, owner, state)
      }
    }, initialLevel)
  }, [owner, artworkId, queryClient, client, initialLevel])
  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? emptySnapshot, session?.getSnapshot ?? emptySnapshot)
  useEffect(() => {
    void session?.load()
    return () => {
      if (useAuthStore.getState().user?.id !== owner) session?.deactivate()
    }
  }, [owner, session])
  return { ...snapshot, setLevel: session?.setLevel ?? noop, retry: session?.retry ?? noop }
}
