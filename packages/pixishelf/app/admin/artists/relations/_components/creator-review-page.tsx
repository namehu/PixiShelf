'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CreatorMaintenancePanel } from '@/components/creators/creator-maintenance-panel'
import { readCreatorReviewSelection } from '@/lib/creator-review-navigation'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function CreatorReviewPage() {
  const params = useSearchParams()
  const selection = params.get('selection')
  const artwork = params.get('artwork')
  const scopeKey = JSON.stringify([selection, artwork])
  const [scope, setScope] = useState<{ key: string; ids: number[]; error?: string } | null>(null)
  useEffect(() => {
    try {
      if (selection !== null) setScope({ key: scopeKey, ids: readCreatorReviewSelection(selection) })
      else if (artwork !== null) {
        const id = Number(artwork)
        if (!/^\d+$/.test(artwork) || !Number.isSafeInteger(id) || id <= 0) {
          throw new Error('作品编号无效，请返回作品管理重新选择。')
        }
        setScope({ key: scopeKey, ids: [id] })
      } else setScope({ key: scopeKey, ids: [] })
    } catch (error) {
      setScope({
        key: scopeKey,
        ids: [],
        error: error instanceof Error ? error.message : '无法读取所选作品，请重新选择。'
      })
    }
  }, [selection, artwork, scopeKey])
  if (!scope || scope.key !== scopeKey) return <p>正在读取所选作品…</p>
  if (scope.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {scope.error} <Link href="/admin/artworks">返回作品管理</Link>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <CreatorMaintenancePanel
      key={selection ?? artwork ?? 'all'}
      artworkIds={scope.ids}
      initialPlanId={params.get('plan') ?? ''}
      onPlanChange={(planId) => {
        const url = new URL(window.location.href)
        url.searchParams.set('plan', planId)
        window.history.replaceState(null, '', url.pathname + url.search)
      }}
    />
  )
}
