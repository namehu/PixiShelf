'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthUser } from '@/components/auth'
import { useTRPCClient } from '@/lib/trpc'
import {
  GLOBAL_QUICK_FILTER_SCOPE,
  type QuickFilterScope,
  type ArtworkQuerySnapshot
} from '@/schemas/artwork-quick-filter.dto'

export function useArtworkQuickFilters(open: boolean, scope: QuickFilterScope = GLOBAL_QUICK_FILTER_SCOPE) {
  const userId = useAuthUser()?.id ?? ''
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const scopeKey = scope.kind === 'artist' ? `artist:${scope.artistId}` : 'global'
  const identity = `${userId}:${scopeKey}`
  const owner = useRef(identity)
  owner.current = identity
  const client = useTRPCClient()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = ['artwork-quick-filters', userId, scopeKey]
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && open,
    queryFn: ({ signal }) => client.artworkQuickFilter.list.query({ expectedUserId: userId, scope }, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: true
  })
  useEffect(() => {
    setError('')
    setBusy(false)
  }, [identity])
  async function run(action: () => Promise<unknown>) {
    if (!userId || busy) return false
    setBusy(true)
    setError('')
    try {
      await action()
      await cache.invalidateQueries({ queryKey: key })
      return mounted.current && owner.current === identity
    } catch (cause) {
      if (mounted.current && owner.current === identity) {
        setError(cause instanceof Error ? cause.message : '操作失败，请重试')
      }
      await cache.invalidateQueries({ queryKey: key })
      return false
    } finally {
      if (mounted.current && owner.current === identity) setBusy(false)
    }
  }
  return {
    userId,
    items: query.data?.items ?? [],
    navigation: query.data?.navigation ?? { revision: 0, ids: [] },
    loading: query.isPending,
    error: error || (query.error ? '快捷筛选加载失败，请重试' : ''),
    busy,
    refresh: () => {
      setError('')
      void query.refetch()
    },
    create: (input: { name: string; query: ArtworkQuerySnapshot; pin: boolean }) =>
      run(() => client.artworkQuickFilter.create.mutate({ ...input, expectedUserId: userId, scope })),
    update: (input: { id: string; revision: number; name: string; query: ArtworkQuerySnapshot }) =>
      run(() => client.artworkQuickFilter.update.mutate({ ...input, expectedUserId: userId, scope })),
    remove: (id: string, revision: number) =>
      run(() => client.artworkQuickFilter.delete.mutate({ id, revision, expectedUserId: userId, scope })),
    setNavigation: (ids: string[]) =>
      run(() =>
        client.artworkQuickFilter.setNavigation.mutate({
          expectedUserId: userId,
          scope,
          navigation: { revision: query.data?.navigation.revision ?? 0, ids }
        })
      )
  }
}
