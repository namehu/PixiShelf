'use client'

import type { ArtworkDedupControlAction, ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth/client'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { useTRPC } from '@/lib/trpc'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { DuplicateCheckStart } from './duplicate-check-start'
import { DuplicateWorkspace } from './duplicate-workspace'
import { DuplicateQueryError } from './duplicate-query-feedback'
import { DuplicateRunStatus, isDuplicateRunActive } from './duplicate-run-status'

type CheckLocation = { artistId: number | null; runId: string | null; operationId?: string | null }

function CheckShell({
  children,
  artistId,
  artistName
}: {
  children: ReactNode
  artistId?: number | null
  artistName?: string
}) {
  return (
    <AdminWorkbench
      title="检查重复"
      eyebrow={null}
      description={
        <Link
          href={artistId ? `/artists/${artistId}` : '/artists'}
          className="inline-flex min-h-11 items-center gap-2 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {artistName ? <PrivacySensitiveText>{artistName}</PrivacySensitiveText> : '返回艺术家'}
        </Link>
      }
      className="mx-auto w-full max-w-[1040px] pb-[calc(2rem+env(safe-area-inset-bottom))]"
    >
      {children}
    </AdminWorkbench>
  )
}

function LoadingCheck() {
  return (
    <div className="flex flex-col gap-4 py-8" aria-busy="true" aria-label="正在加载检查状态">
      <p className="text-sm text-muted-foreground">正在加载检查状态…</p>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-2 w-full max-w-2xl" />
    </div>
  )
}

export function DuplicateCheckPage({ artistId, runId, operationId }: CheckLocation) {
  const { data: session, isPending } = useSession()
  const userId = session?.user.id
  if (!artistId && !runId && !operationId) {
    return (
      <CheckShell>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>选择要检查的艺术家</EmptyTitle>
            <EmptyDescription>从艺术家详情页进入，可以检查该艺术家作品中的相同内容。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild className="min-h-11">
              <Link href="/artists">查看艺术家</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </CheckShell>
    )
  }
  if (!userId) {
    return (
      <CheckShell artistId={artistId}>
        {isPending ? (
          <LoadingCheck />
        ) : (
          <p role="status" className="py-8 text-sm text-muted-foreground">
            登录状态已变化，请刷新页面后继续。
          </p>
        )}
      </CheckShell>
    )
  }
  if (operationId && !artistId && !runId) {
    return <OperationEntry key={`${userId}:${operationId}`} userId={userId} operationId={operationId} />
  }
  // Remount the entire intent scope when the account or selected run changes.
  return <AccountCheck key={`${userId}:${artistId}:${runId}`} userId={userId} artistId={artistId} runId={runId} />
}

function OperationEntry({ userId, operationId }: { userId: string; operationId: string }) {
  const trpc = useTRPC()
  const query = useQuery({
    ...trpc.artworkDedup.getOperation.queryOptions({ operationId, expectedUserId: userId }),
    retry: false,
    gcTime: 0
  })
  if (!query.data) {
    return (
      <CheckShell>
        {query.isError ? (
          <DuplicateQueryError busy={query.isFetching} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingCheck />
        )}
      </CheckShell>
    )
  }
  return (
    <AccountCheck
      key={`${userId}:${query.data.operation.runId}`}
      userId={userId}
      artistId={query.data.operation.artistId}
      runId={query.data.operation.runId}
    />
  )
}

function AccountCheck({ userId, artistId, runId }: CheckLocation & { userId: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ArtworkDedupRunDto['mode']>('INCREMENTAL')
  const [pending, setPending] = useState<ArtworkDedupControlAction | 'start' | null>(null)
  const [operationError, setOperationError] = useState(false)
  const active = useRef(true)
  const locked = useRef(false)
  const intent = useRef<{ signature: string; key: string } | null>(null)
  const queryOptions = useMemo(
    () =>
      trpc.artworkDedup.getRun.queryOptions(
        runId ? { runId, expectedUserId: userId } : { artistId: artistId!, expectedUserId: userId }
      ),
    [trpc, runId, artistId, userId]
  )
  const runQuery = useQuery({
    ...queryOptions,
    retry: false,
    refetchInterval: (query) => (query.state.data && isDuplicateRunActive(query.state.data) ? 5000 : false)
  })
  const run = runQuery.data
  const selectedArtistId = run?.artistId ?? artistId
  const artistQuery = useQuery({
    ...trpc.artist.getById.queryOptions(selectedArtistId ?? 0),
    enabled: Boolean(selectedArtistId),
    retry: false
  })
  const startMutation = useMutation(trpc.artworkDedup.start.mutationOptions())
  const controlMutation = useMutation(trpc.artworkDedup.control.mutationOptions())

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      intent.current = null
      // Strict Mode immediately reinstalls this effect; only clear a scope that stayed unmounted.
      queueMicrotask(() => {
        if (active.current) return
        void queryClient.cancelQueries({ queryKey: queryOptions.queryKey, exact: true })
        queryClient.removeQueries({ queryKey: queryOptions.queryKey, exact: true })
      })
    }
  }, [queryClient, queryOptions.queryKey])

  async function submit(action: ArtworkDedupControlAction | 'start') {
    if (!active.current || locked.current || runQuery.isError || runQuery.isPending) return
    if (
      action === 'start' &&
      (!selectedArtistId ||
        !artistQuery.data ||
        artistQuery.data.artworksCount === 0 ||
        (run && isDuplicateRunActive(run)))
    ) {
      return
    }
    if (action !== 'start' && (!run || !run.allowedControls.includes(action))) return
    locked.current = true
    setPending(action)
    setOperationError(false)
    try {
      const signature =
        action === 'start'
          ? `${userId}:start:${selectedArtistId}:${mode}`
          : `${userId}:${action}:${run!.runId}:${run!.version}`
      // Retain a key after an unconfirmed response so a deliberate retry replays the same intent.
      if (intent.current?.signature !== signature) intent.current = { signature, key: createBrowserUuid() }
      const idempotencyKey = intent.current.key
      const next =
        action === 'start'
          ? await startMutation.mutateAsync({
              artistId: selectedArtistId!,
              expectedUserId: userId,
              idempotencyKey,
              mode
            })
          : await controlMutation.mutateAsync({
              runId: run!.runId,
              expectedUserId: userId,
              expectedVersion: run!.version,
              idempotencyKey,
              action
            })
      if (!active.current) return
      await queryClient.cancelQueries({ queryKey: queryOptions.queryKey, exact: true })
      if (!active.current) return
      const accepted = queryClient.setQueryData(queryOptions.queryKey, (current) => {
        if (!current) return next
        if (current.runId === next.runId) return current.version >= next.version ? current : next
        // Only a new start may replace the run seen at submission; a later query may already point elsewhere.
        if (action !== 'start' || current.runId !== run?.runId) return current
        return next
      })
      intent.current = null
      if (action === 'start' && accepted) {
        router.replace(`/admin/duplicates?artistId=${accepted.artistId}&runId=${encodeURIComponent(accepted.runId)}`, {
          scroll: false
        })
      }
    } catch {
      if (!active.current) return
      setOperationError(true)
      await runQuery.refetch()
    } finally {
      if (active.current) {
        locked.current = false
        setPending(null)
      }
    }
  }

  const loading = runQuery.isPending || (!run && !runId && artistQuery.isPending)
  const canStart = Boolean(artistQuery.data && artistQuery.data.artworksCount > 0 && !runQuery.isError)
  const startForm = (
    <DuplicateCheckStart
      mode={mode}
      onModeChange={setMode}
      onStart={() => void submit('start')}
      pending={pending === 'start'}
      disabled={Boolean(pending) || !canStart}
      repeat={Boolean(run)}
    />
  )

  return (
    <CheckShell artistId={selectedArtistId} artistName={run?.artistName ?? artistQuery.data?.name}>
      <DuplicateWorkspace userId={userId} artistId={selectedArtistId} run={run}>
        {runQuery.isError || artistQuery.isError ? (
          <Alert className="mt-6">
            <AlertTitle>检查状态暂未同步</AlertTitle>
            <AlertDescription>
              {run ? '保留最近一次状态，刷新后可继续操作。' : '暂时无法加载，请重新尝试。'}
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11 w-fit"
                disabled={runQuery.isFetching || artistQuery.isFetching}
                onClick={() => {
                  void runQuery.refetch()
                  if (selectedArtistId) void artistQuery.refetch()
                }}
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                刷新状态
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {operationError ? (
          <Alert className="mt-6">
            <AlertTitle>操作尚未确认</AlertTitle>
            <AlertDescription>已重新读取检查状态，请确认当前状态后再试。</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <LoadingCheck />
        ) : run ? (
          <>
            <DuplicateRunStatus
              run={run}
              pending={pending}
              disabled={Boolean(pending) || runQuery.isError}
              onControl={(action) => void submit(action)}
            />
            {!isDuplicateRunActive(run) ? (
              <>
                <Separator />
                <details className="max-w-md py-4">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm text-primary">重新检查</summary>
                  <section aria-label="重新检查" className="py-4">
                    {canStart ? (
                      startForm
                    ) : !artistQuery.isPending && !artistQuery.isError ? (
                      <p className="text-sm text-muted-foreground">该艺术家当前没有可检查的作品。</p>
                    ) : null}
                  </section>
                </details>
              </>
            ) : null}
          </>
        ) : !runQuery.isError && !artistQuery.isError ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyTitle>
                {runId
                  ? '找不到这次检查'
                  : !artistQuery.data
                    ? '找不到这位艺术家'
                    : artistQuery.data.artworksCount === 0
                      ? '没有可检查的作品'
                      : '还未检查'}
              </EmptyTitle>
              <EmptyDescription>
                {runId
                  ? '请从艺术家详情页查看最近的检查。'
                  : !artistQuery.data
                    ? '该艺术家可能已被合并或移除。'
                    : artistQuery.data.artworksCount === 0
                      ? '添加作品后，可以回来检查相同内容。'
                      : '检查这位艺术家作品中的相同内容，原媒体会保持不变。'}
              </EmptyDescription>
            </EmptyHeader>
            {!runId && canStart ? <EmptyContent>{startForm}</EmptyContent> : null}
          </Empty>
        ) : null}
      </DuplicateWorkspace>
    </CheckShell>
  )
}
