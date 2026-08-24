'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { ClientScanCard } from './client-scan-card'
import { ServerScanCard } from './server-scan-card'
import { ScanHistorySummaryCard, type PixivScanActivity } from './scan-history-summary-card'
import { SourceAuditCard } from './source-audit-card'
import { useSseScan } from '../_hooks/use-sse-scan'

function useScanPath() {
  const queryClient = useQueryClient()
  const trpc = useTRPC()

  const mutation = useMutation(
    trpc.setting.setScanPath.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.setting.getScanPath.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.setting.health.queryKey() })
      }
    })
  )

  return {
    query: useQuery(trpc.setting.getScanPath.queryOptions()),
    update: {
      mutate: (scanPath: string) => mutation.mutate({ value: scanPath }),
      isPending: mutation.isPending
    }
  }
}

/**
 * 扫描管理主组件
 */
function ScanManagement() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: health } = useQuery(trpc.setting.health.queryOptions())

  const scanPath = useScanPath()
  const mediaActivity = useQuery(
    trpc.localImport.status.queryOptions(undefined, {
      refetchInterval: (query) => (query.state.data?.activity.scan ? 3000 : 15000)
    })
  )

  const refreshActivity = useCallback(() => {
    void mediaActivity.refetch()
  }, [mediaActivity.refetch])

  const refreshScanStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: trpc.scanRun.list.queryKey() })
    refreshActivity()
  }, [queryClient, refreshActivity, trpc])

  const { state, actions } = useSseScan({ onQueued: refreshScanStatus })
  const { streaming } = state
  const activity = mediaActivity.data as MediaScanActivity | undefined
  const localImportRunning = Boolean(activity?.activity.localImport)
  const activeScan = activity?.activity.scan ?? null
  const scanBusy = streaming || localImportRunning || Boolean(activeScan)

  // // 启动客户端列表扫描 (POST)
  const handleClientScan = (metadataList: string[]) => {
    actions.startScan({ metadataList })
  }

  const startServerScan = () => actions.startScan({})

  const handleUpdatePath = (newPath: string) => {
    scanPath.update.mutate(newPath)
  }

  return (
    <div className="py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Pixiv 扫描</h2>
          <p className="mt-1 text-sm text-muted-foreground">先确认当前任务状态，再管理扫描路径与发起扫描。</p>
        </div>

        <ScanHistorySummaryCard
          activity={activeScan}
          onRefreshActivity={refreshActivity}
          isRefreshingActivity={mediaActivity.isFetching}
        />

        <ServerScanCard
          scanPathData={scanPath.query.data?.data || ''}
          isUpdatingPath={scanPath.update.isPending}
          isScanning={scanBusy}
          healthStatus={health?.status}
          onUpdatePath={handleUpdatePath}
          onScanNewArtworks={startServerScan}
        />

        <SourceAuditCard />

        <ClientScanCard hasScanPath={!!scanPath.query.data?.data} isScanning={scanBusy} onScan={handleClientScan} />
      </div>
    </div>
  )
}

interface MediaScanActivity {
  activity: {
    scan: PixivScanActivity | null
    localImport: unknown | null
  }
}

export default ScanManagement
