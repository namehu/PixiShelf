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
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth/client'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { useTRPC } from '@/lib/trpc'
import { DuplicateCheckStart } from './duplicate-check-start'
import { DuplicateWorkspace } from './duplicate-workspace'
import { DuplicateQueryError } from './duplicate-query-feedback'
import { DuplicateRunStatus, isDuplicateRunActive } from './duplicate-run-status'

type CheckLocation = { artistId: number | null; runId: string | null; operationId?: string | null }

function CheckShell({
  children,
  artistId,
  artistName,
  actions
}: {
  children: ReactNode
  artistId?: number | null
  artistName?: string
  actions?: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-5 lg:px-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <h1 className="col-start-1 row-start-1 text-[22px] leading-8 font-semibold tracking-tight">检查重复</h1>
        <Link
          href={artistId ? `/artists/${artistId}` : '/artists'}
          className="col-span-2 col-start-1 row-start-2 inline-flex min-h-11 max-w-full items-center gap-2 text-sm text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring sm:col-span-1"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {artistName ? <PrivacySensitiveText>{artistName}</PrivacySensitiveText> : '返回艺术家'}
          </span>
        </Link>
        {actions ? <div className="col-start-2 row-start-1 sm:row-span-2">{actions}</div> : null}
      </header>
      {children}
    </div>
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
            <EmptyTitle>先选择一位艺术家</EmptyTitle>
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
  const [includeSuspectedVersions, setIncludeSuspectedVersions] = useState(false)
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
          ? `${userId}:start:${selectedArtistId}:${mode}:${includeSuspectedVersions}`
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
              mode,
              includeSuspectedVersions
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
      includeSuspectedVersions={includeSuspectedVersions}
      onIncludeSuspectedVersionsChange={setIncludeSuspectedVersions}
      onStart={() => void submit('start')}
      pending={pending === 'start'}
      disabled={Boolean(pending) || !canStart}
      repeat={Boolean(run)}
    />
  )

  return (
    <CheckShell
      artistId={selectedArtistId}
      artistName={run?.artistName ?? artistQuery.data?.name}
      actions={!loading && canStart && (!runId || run) && (!run || !isDuplicateRunActive(run)) ? startForm : null}
    >
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
          <DuplicateRunStatus
            run={run}
            pending={pending}
            disabled={Boolean(pending) || runQuery.isError}
            onControl={(action) => void submit(action)}
          />
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
                      : '找出重复的作品'}
              </EmptyTitle>
              <EmptyDescription>
                {runId
                  ? '请从艺术家详情页查看最近的检查。'
                  : !artistQuery.data
                    ? '该艺术家可能已被合并或移除。'
                    : artistQuery.data.artworksCount === 0
                      ? '添加作品后，可以回来检查相同内容。'
                      : '找出内容完全相同的作品，由你决定保留哪一部。'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </DuplicateWorkspace>
    </CheckShell>
  )
}
