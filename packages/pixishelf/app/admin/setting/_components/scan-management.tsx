'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { confirm } from '@/components/shared/global-confirm'
import { ClientScanCard } from './client-scan-card'
import { ServerScanCard } from './server-scan-card'
import { ScanResultCard } from './scan-result-card'
import { ScanHistorySummaryCard } from './scan-history-summary-card'
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

  // 启动服务端扫描 (GET)
  const startServerStream = (force: boolean) => {
    actions.startScan({ force })
  }

  const handleScan = () => {
    confirm({
      title: '确认强制扫描？',
      description:
        '强制全量扫描只会删除并重建 Pixiv 导入作品；自建作品、本地目录导入、作者映射和共享标签库会保留。Pixiv 作品上的点赞、手工标签及系列关联会随重建而重置。此操作不可撤销，确定要继续吗？',
      variant: 'destructive',
      confirmText: '确认重建 Pixiv 数据',
      onConfirm: () => {
        startServerStream(true)
      }
    })
  }

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
          onScanIncremental={() => startServerStream(false)}
          onScanForce={handleScan} // 你的强制扫描逻辑
        />

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
