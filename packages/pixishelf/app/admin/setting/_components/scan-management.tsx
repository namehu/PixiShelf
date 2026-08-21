'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { ClientScanCard } from './client-scan-card'
import { ServerScanCard } from './server-scan-card'
import { ScanResultCard } from './scan-result-card'
import { ScanHistorySummaryCard } from './scan-history-summary-card'
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
  const { data: health } = useQuery(trpc.setting.health.queryOptions())

  const scanPath = useScanPath()
  const mediaActivity = useQuery(
    trpc.localImport.status.queryOptions(undefined, {
      refetchInterval: 3000
    })
  )

  // 统一的状态和动作 Hook
  const { state, actions } = useSseScan()
  const { streaming } = state
  const localImportRunning = Boolean(mediaActivity.data?.activity.localImport)
  const scanBusy = streaming || localImportRunning || Boolean(mediaActivity.data?.activity.scan)

  // // 启动客户端列表扫描 (POST)
  const handleClientScan = (metadataList: string[]) => {
    actions.startScan({ metadataList })
  }

  const startServerScan = () => actions.startScan({ force: false })

  const handleUpdatePath = (newPath: string) => {
    scanPath.update.mutate(newPath)
  }

  return (
    <div className="py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Pixiv 扫描</h2>
          <p className="mt-1 text-sm text-muted-foreground">管理作品扫描路径、监控扫描进度和查看详细日志。</p>
        </div>

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

        {/*  统一的状态、结果和日志区域 (新) */}
        {/* 仅在有任何活动或结果时显示此卡片 */}
        <ScanResultCard onCancel={actions.cancelScan} elapsed={state.elapsed} />

        <ScanHistorySummaryCard />
      </div>
    </div>
  )
}

export default ScanManagement
