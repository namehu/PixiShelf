'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore, useAuthUser } from '@/components/auth'
import { useTRPCClient } from '@/lib/trpc'
import {
  getMediaMarkSession,
  mediaMarkListKey,
  type MediaMarkIdentity,
  type MediaMarkSnapshot
} from '@/lib/media-mark-state'
import { readMediaMarkBatch } from '@/lib/media-mark-batch'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

const empty: MediaMarkSnapshot = {
  markId: null,
  artworkId: 0,
  mediaId: 0,
  bookmarkedAt: null,
  likedAt: null,
  available: false,
  isLoading: false,
  isSaving: false,
  error: null
}
const emptySnapshot = () => empty
const noSubscribe = () => () => {}
const noop = () => {}

function sessionFor(
  client: ReturnType<typeof useTRPCClient>,
  queryClient: QueryClient,
  { owner, artworkId, mediaId }: MediaMarkIdentity,
  initial?: MediaMarkStateDto
) {
  return getMediaMarkSession(
    queryClient,
    { owner, artworkId, mediaId },
    {
      get: (signal) =>
        readMediaMarkBatch(queryClient, { owner, artworkId, mediaId }, signal, (mediaIds, batchSignal) =>
          client.mediaMark.getMany.query({ artworkId, mediaIds, expectedUserId: owner }, { signal: batchSignal })
        ),
      set: (kind, value) => client.mediaMark.set.mutate({ artworkId, mediaId, kind, value, expectedUserId: owner }),
      remove: (markId, kind) => client.mediaMark.remove.mutate({ markId, kind, expectedUserId: owner }),
      isCurrentAccount: () => useAuthStore.getState().user?.id === owner,
      onConfirmed: () => queryClient.invalidateQueries({ queryKey: mediaMarkListKey(owner) })
    },
    initial
  )
}

export function useLikedMediaIds(artworkId: number, enabled: boolean) {
  const owner = useAuthUser()?.id
  const client = useTRPCClient()
  return useQuery({
    queryKey: [...mediaMarkListKey(owner ?? ''), 'likedMediaIds', artworkId],
    queryFn: ({ signal }) => client.mediaMark.likedMediaIds.query({ artworkId, expectedUserId: owner! }, { signal }),
    enabled: enabled && Boolean(owner),
    refetchOnWindowFocus: false
  })
}

export function usePrefetchMediaMarks(artworkId: number, mediaIds: number[], enabled: boolean) {
  const owner = useAuthUser()?.id
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const idsKey = JSON.stringify(mediaIds)
  useEffect(() => {
    if (!enabled || !owner || artworkId <= 0) return
    const ids: number[] = JSON.parse(idsKey)
    const sessions = ids.map((id) => sessionFor(client, queryClient, { owner, artworkId, mediaId: id }))
    sessions.forEach((session) => {
      void session.load()
    })
    const deactivate = () => sessions.forEach((session) => session.deactivate())
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (previous.user?.id === owner && state.user?.id !== owner) deactivate()
    })
    return () => {
      unsubscribe()
      if (useAuthStore.getState().user?.id !== owner) deactivate()
    }
  }, [owner, client, queryClient, artworkId, idsKey, enabled])
}

export function useMediaMark(artworkId: number, mediaId: number | null, initial?: MediaMarkStateDto) {
  const owner = useAuthUser()?.id
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const session = useMemo(() => {
    if (!owner || artworkId <= 0 || !mediaId) return null
    return sessionFor(client, queryClient, { owner, artworkId, mediaId }, initial)
  }, [owner, artworkId, mediaId, queryClient, client, initial])
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? emptySnapshot,
    session?.getSnapshot ?? emptySnapshot
  )
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
