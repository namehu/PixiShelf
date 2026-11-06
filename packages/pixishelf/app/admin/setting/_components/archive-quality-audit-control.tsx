'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export function ArchiveQualityAuditControl() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const query = useQuery(
    trpc.setting.getArchiveQualityAuditStatus.queryOptions(undefined, {
      refetchInterval: (state) => (state.state.data?.activeJob ? 2_000 : 15_000)
    })
  )
  const mutation = useMutation(
    trpc.setting.startArchiveQualityAudit.mutationOptions({
      onSuccess: () => {
        toast.success('图片版本核验已提交')
        void queryClient.invalidateQueries({ queryKey: trpc.setting.getArchiveQualityAuditStatus.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const state = query.data
  const job = state?.activeJob ?? state?.latestJob
  const canContinue = job?.status === 'PAUSED' || job?.status === 'FAILED'
  const running = Boolean(state?.activeJob && !canContinue)
  return (
    <div className="flex w-full flex-col gap-3 sm:max-w-xl">
      <p className="text-sm text-muted-foreground">
        根据现有下载记录重新判断已保存图片的版本。记录不足的图片仍可能无法确认是否为原图。核验会分批保存进度。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={query.isPending || !state?.capabilityAvailable || running || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ScanLine data-icon="inline-start" aria-hidden="true" />
          )}
          {canContinue ? '继续画质核验' : running ? '正在核验' : '核验历史归档画质'}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/tasks">查看或控制后台任务</Link>
        </Button>
      </div>
      {state && !state.capabilityAvailable ? (
        <p className="text-xs text-muted-foreground">等待支持画质核验的 READY Worker。</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {job ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          {state?.activeJob ? <Progress value={job.progress} aria-label={`画质核验进度 ${job.progress}%`} /> : null}
          {job.checkpoint ? (
            <p className="text-xs text-muted-foreground">
              已核验 {job.checkpoint.processedArtworks} 部作品 · 原图 {job.checkpoint.originalPages} 张 · 网页阅读版{' '}
              {job.checkpoint.displayPages} 张 · 无法确认是否为原图 {job.checkpoint.unknownPages} 张
            </p>
          ) : null}
          {job.message || job.error ? (
            <PrivacySensitiveText as="p" className="text-xs text-muted-foreground">
              {job.error ?? job.message}
            </PrivacySensitiveText>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
