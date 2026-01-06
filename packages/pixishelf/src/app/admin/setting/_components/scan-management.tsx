'use client'

import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSseScan } from '../_hooks/use-sse-scan'
import { confirm } from '@/components/shared/global-confirm' // 直接引入函数
import { ClientScanCard } from './scan/client-scan-card'
import { ServerScanCard } from './scan/server-scan-card'
import { ScanResultCard } from './scan/scan-result-card'
import { useTRPC } from '@/lib/trpc'

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
 * 扫描管理主组件 (已重构)
 */
function ScanManagement() {
  const trpc = useTRPC()
  const { data: health } = useQuery(trpc.setting.health.queryOptions())

  const scanPath = useScanPath()

  // 统一的状态和动作 Hook
  const { state, actions } = useSseScan()
  const { streaming } = state

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
        '强制全量扫描将会清空数据库中的所有艺术品、艺术家、图片和标签数据（用户和设置数据不受影响），然后重新扫描所有文件。此操作不可撤销，确定要继续吗？',
      variant: 'destructive',
      confirmText: '确认清空并扫描',
      onConfirm: () => {
        startServerStream(true)
      }
    })
  }

  const handleUpdatePath = (newPath: string) => {
    scanPath.update.mutate(newPath)
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">扫描管理</h1>
          <p className="text-neutral-600">管理艺术品扫描路径、监控扫描进度和查看详细日志</p>
        </div>

        <ServerScanCard
          scanPathData={scanPath.query.data?.data || ''}
          isUpdatingPath={scanPath.update.isPending}
          isScanning={streaming}
          healthStatus={health?.status}
          onUpdatePath={handleUpdatePath}
          onScanIncremental={() => startServerStream(false)}
          onScanForce={handleScan} // 你的强制扫描逻辑
        />

        <ClientScanCard hasScanPath={!!scanPath.query.data?.data} isScanning={streaming} onScan={handleClientScan} />

        {/*  统一的状态、结果和日志区域 (新) */}
        {/* 仅在有任何活动或结果时显示此卡片 */}
        <ScanResultCard
          onCancel={actions.cancelScan}
          elapsed={state.elapsed}
          autoScroll={actions.autoScroll}
          setAutoScroll={actions.setAutoScroll}
        />
      </div>
    </div>
  )
}

export default ScanManagement
