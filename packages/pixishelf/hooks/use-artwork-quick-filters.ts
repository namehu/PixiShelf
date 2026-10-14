'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthUser } from '@/components/auth'
import { useTRPCClient } from '@/lib/trpc'
import type { ArtworkQuerySnapshot } from '@/schemas/artwork-quick-filter.dto'

export function useArtworkQuickFilters(open: boolean) {
  const userId = useAuthUser()?.id ?? ''
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const owner = useRef(userId)
  owner.current = userId
  const client = useTRPCClient()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = ['artwork-quick-filters', userId]
  const query = useQuery({
    queryKey: key,
    enabled: !!userId && open,
    queryFn: ({ signal }) => client.artworkQuickFilter.list.query({ expectedUserId: userId }, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: true
  })
  useEffect(() => {
    setError('')
    setBusy(false)
  }, [userId])
  async function run(action: () => Promise<unknown>) {
    if (!userId || busy) return false
    setBusy(true)
    setError('')
    try {
      await action()
      await cache.invalidateQueries({ queryKey: key })
      return mounted.current && owner.current === userId
    } catch (cause) {
      if (mounted.current && owner.current === userId)
        {setError(cause instanceof Error ? cause.message : '操作失败，请重试')}
      await cache.invalidateQueries({ queryKey: key })
      return false
    } finally {
      if (mounted.current && owner.current === userId) setBusy(false)
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
      run(() => client.artworkQuickFilter.create.mutate({ ...input, expectedUserId: userId })),
    update: (input: { id: string; revision: number; name: string; query: ArtworkQuerySnapshot }) =>
      run(() => client.artworkQuickFilter.update.mutate({ ...input, expectedUserId: userId })),
    remove: (id: string, revision: number) =>
      run(() => client.artworkQuickFilter.delete.mutate({ id, revision, expectedUserId: userId })),
    setNavigation: (ids: string[]) =>
      run(() =>
        client.artworkQuickFilter.setNavigation.mutate({
          expectedUserId: userId,
          navigation: { revision: query.data?.navigation.revision ?? 0, ids }
        })
      )
  }
}
