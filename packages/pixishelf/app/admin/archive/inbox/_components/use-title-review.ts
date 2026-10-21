'use client'

import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ArchiveTitleReviewDecision } from '@pixishelf/job-contracts'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'

export function useTitleReview(sourceId: string, rulesVersion: number, onSaved?: () => void) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const attempt = useRef<{ key: string; requestId: string } | null>(null)
  const mutation = useMutation(
    trpc.archiveSearch.reviewItems.mutationOptions({
      onSuccess: async (result) => {
        attempt.current = null
        const problems = result?.items.filter((item) => item.result === 'CONFLICT' || item.result === 'FAILED') ?? []
        if (problems.length) {
          toast.warning('部分候选未更新', {
            description: problems
              .map((item) => item.message)
              .filter(Boolean)
              .join('；')
          })
        } else toast.success('复核决定已保存')
        onSaved?.()
        await client.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() })
      },
      onError: (error) =>
        toast.error('复核保存失败', { description: archiveClientErrorMessage(error, '请重试；重复提交不会重复执行。') })
    })
  )
  return {
    pending: mutation.isPending,
    review: (itemIds: string[], decision: ArchiveTitleReviewDecision) => {
      if (mutation.isPending || !itemIds.length) return
      const key = JSON.stringify([sourceId, rulesVersion, [...itemIds].sort(), decision])
      if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() }
      mutation.mutate({ sourceId, rulesVersion, itemIds, decision, requestId: attempt.current.requestId })
    }
  }
}
