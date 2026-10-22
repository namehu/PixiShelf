'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore, useAuthUser } from '@/components/auth'
import { useTRPCClient } from '@/lib/trpc'
import { getMediaMarkSession, mediaMarkListKey, type MediaMarkSnapshot } from '@/lib/media-mark-state'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

const empty: MediaMarkSnapshot = { markId: null, artworkId: 0, mediaId: 0, bookmarkedAt: null, likedAt: null, available: false, isLoading: false, isSaving: false, error: null }
const emptySnapshot = () => empty
const noSubscribe = () => () => {}
const noop = () => {}

export function useMediaMark(artworkId: number, mediaId: number | null, initial?: MediaMarkStateDto) {
  const owner = useAuthUser()?.id
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const session = useMemo(() => {
    if (!owner || artworkId <= 0 || !mediaId) return null
    return getMediaMarkSession(queryClient, { owner, artworkId, mediaId }, {
      get: async (signal) => {
        const result = await client.mediaMark.getMany.query({ artworkId, mediaIds: [mediaId], expectedUserId: owner }, { signal })
        return result.items[0] ?? { ...empty, artworkId, mediaId }
      },
      set: (kind, value) => client.mediaMark.set.mutate({ artworkId, mediaId, kind, value, expectedUserId: owner }),
      remove: (markId, kind) => client.mediaMark.remove.mutate({ markId, kind, expectedUserId: owner }),
      isCurrentAccount: () => useAuthStore.getState().user?.id === owner,
      onConfirmed: () => queryClient.invalidateQueries({ queryKey: mediaMarkListKey(owner) })
    }, initial)
  }, [owner, artworkId, mediaId, queryClient, client, initial])
  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? emptySnapshot, session?.getSnapshot ?? emptySnapshot)
  useEffect(() => {
    void session?.load()
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (previous.user?.id === owner && state.user?.id !== owner) session?.deactivate()
    })
    return () => {
      unsubscribe()
      if (useAuthStore.getState().user?.id !== owner) session?.deactivate()
    }
  }, [owner, session])
  useEffect(() => {
    if (snapshot.error) toast.error('图片标记未更新，请重试。', { id: `media-mark-${owner}-${artworkId}-${mediaId}` })
  }, [owner, artworkId, mediaId, snapshot.error])
  return { ...snapshot, set: session?.set ?? noop, remove: session?.remove ?? noop, retry: session?.load ?? noop }
}
