'use client'

import { useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SCard } from '@/components/shared/s-card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'

type RouterOutputs = inferRouterOutputs<AppRouter>
type SourceAuditAvailability = RouterOutputs['sourceAudit']['availability']
type AvailabilityReason = SourceAuditAvailability['reason']

const unavailableCopy: Record<Exclude<AvailabilityReason, 'AUDIT_ACTIVE' | null>, string> = {
  CUTOVER_DISABLED: '中央任务调度尚未启用，暂时不能发起核对。',
  DISPATCH_DISABLED: 'Worker 任务调度尚未启用，暂时不能发起核对。',
  SCAN_ROOT_NOT_CONFIGURED: '请先配置服务端扫描目录。',
  SCAN_ROOT_UNAVAILABLE: '扫描目录当前不可访问，请检查目录挂载。',
  INVENTORY_NOT_READY: '请先运行“扫描新作品”，完成来源基线后再核对。',
  WORKER_NOT_READY: '通用 Worker 尚未就绪或版本不支持来源核对。',
  SCAN_BUSY: '另一个 Pixiv 扫描任务正在执行，请完成后再核对。'
}

export function SourceAuditCard() {
  const trpc = useTRPC()
  const router = useRouter()
  const requestIdRef = useRef<string | null>(null)
  const availabilityQuery = useQuery(
    trpc.sourceAudit.availability.queryOptions(undefined, {
      refetchInterval: 5000
    })
  )
  const startMutation = useMutation(
    trpc.sourceAudit.start.mutationOptions({
      onSuccess: (result) => {
        requestIdRef.current = null
        router.push(`/admin/scan-history/${result.auditRunId}/source-audit`)
      },
      onError: async (error) => {
        const path = await resolveActiveAuditPathAfterConflict(error.data?.code, () => availabilityQuery.refetch())
        if (!path) return

        requestIdRef.current = null
        router.push(path)
      }
    })
  )

  return (
    <SourceAuditCardView
      availability={availabilityQuery.data}
      isLoading={availabilityQuery.isPending}
      isRefreshing={availabilityQuery.isFetching}
      isStarting={startMutation.isPending}
      errorMessage={startMutation.error?.message ?? (availabilityQuery.isError ? '无法读取来源核对的可用状态。' : null)}
      onAction={() => {
        const activeAudit = availabilityQuery.data?.activeAudit
        if (activeAudit) {
          requestIdRef.current = null
          router.push(`/admin/scan-history/${activeAudit.auditRunId}/source-audit`)
          return
        }
        requestIdRef.current = ensureSourceAuditRequestId(requestIdRef.current)
        startMutation.mutate({ requestId: requestIdRef.current })
      }}
    />
  )
}

export function ensureSourceAuditRequestId(current: string | null, create = () => crypto.randomUUID()) {
  return current ?? create()
}

export async function resolveActiveAuditPathAfterConflict(
  errorCode: string | undefined,
  refresh: () => Promise<{ data?: SourceAuditAvailability }>
) {
  if (errorCode !== 'CONFLICT') return null

  const activeAudit = (await refresh()).data?.activeAudit
  return activeAudit ? `/admin/scan-history/${activeAudit.auditRunId}/source-audit` : null
}

export function SourceAuditCardView({
  availability,
  isLoading,
  isRefreshing,
  isStarting,
  errorMessage,
  onAction
}: {
  availability?: SourceAuditAvailability
  isLoading: boolean
  isRefreshing: boolean
  isStarting: boolean
  errorMessage: string | null
  onAction: () => void
}) {
  const activeAudit = availability?.activeAudit ?? null
  const unavailableReason =
    availability?.reason && availability.reason !== 'AUDIT_ACTIVE' ? unavailableCopy[availability.reason] : null
  const actionDisabled = isLoading || isStarting || (!activeAudit && availability?.available !== true)

  return (
    <SCard
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
          来源一致性核对
        </span>
      }
      description="只读取 Pixiv metadata 与来源清单，找出新增、变化、缺失和身份冲突；不会修改图库。"
      extra={
        <Badge variant={activeAudit ? 'info' : availability?.available ? 'success' : 'muted'}>
          {activeAudit ? '正在核对' : availability?.available ? '可以开始' : isLoading ? '检查中' : '暂不可用'}
        </Badge>
      }
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            核对任务按后台队列顺序执行；完成后可在扫描历史中随时查看。
          </p>
          <Button type="button" variant="outline" disabled={actionDisabled} onClick={onAction} className="shrink-0">
            {isStarting ? <Spinner data-icon="inline-start" /> : null}
            {isStarting ? '正在入队…' : activeAudit ? '查看核对进度' : '开始来源核对'}
            {!isStarting ? <ArrowRight data-icon="inline-end" aria-hidden="true" /> : null}
          </Button>
        </div>
      }
    >
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>无法开始来源核对</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : unavailableReason ? (
        <Alert variant="warning">
          <AlertTitle>当前不能开始核对</AlertTitle>
          <AlertDescription>{unavailableReason}</AlertDescription>
        </Alert>
      ) : activeAudit ? (
        <Alert variant="info" aria-live="polite">
          <AlertTitle>已有核对任务正在进行</AlertTitle>
          <AlertDescription>继续查看现有任务，不会重复创建队列项。</AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          适合在移动、替换或批量整理 metadata 后运行。核对结果只报告差异，不会删除作品或覆盖现有数据。
          {isRefreshing ? ' 正在更新可用状态…' : ''}
        </p>
      )}
    </SCard>
  )
}
