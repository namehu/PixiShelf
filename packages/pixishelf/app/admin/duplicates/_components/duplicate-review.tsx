'use client'

import type { ArtworkDedupGroupDto, ArtworkDedupOperationDto, ArtworkDedupReviewDto } from '@pixishelf/job-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useTRPC } from '@/lib/trpc'
import { DuplicateGroupRow } from './duplicate-group-row'
import { DuplicateMembersSheet } from './duplicate-members-sheet'
import { DuplicateComparisonSheet } from './duplicate-comparison-sheet'
import { DuplicateVisualRow } from './duplicate-visual-row'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'
import {
  duplicateSelectionSummary,
  emptyDuplicateSelection,
  isDuplicateGroupSelected,
  toggleDuplicateGroup
} from './duplicate-selection'
import { useDuplicateIntent } from './use-duplicate-intent'
import { canKeepDuplicateMember, duplicatePairLabel, isDuplicateManualPair } from './duplicate-relation'

type Draft = { group: ArtworkDedupGroupDto; keeperId: number }
export function DuplicateReview(props: {
  userId: string
  runId: string
  onOperation: (operation: ArtworkDedupOperationDto) => void
}) {
  return <AccountDuplicateReview key={`${props.userId}:${props.runId}`} {...props} />
}
function AccountDuplicateReview({
  userId,
  runId,
  onOperation
}: {
  userId: string
  runId: string
  onOperation: (operation: ArtworkDedupOperationDto) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const intent = useDuplicateIntent()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [selection, setSelection] = useState(emptyDuplicateSelection)
  const [selectionError, setSelectionError] = useState('')
  const [detailGroup, setDetailGroup] = useState<ArtworkDedupGroupDto | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saved, setSaved] = useState<Record<string, ArtworkDedupReviewDto>>({})
  const [savedRevision, setSavedRevision] = useState(0)
  const query = useQuery({
    ...trpc.artworkDedup.listGroups.queryOptions({ runId, expectedUserId: userId, cursor: cursors.at(-1), limit: 20 }),
    retry: false,
    gcTime: 0
  })
  const page = query.data?.kind === 'GROUPS' ? query.data : null
  const save = useMutation(trpc.artworkDedup.saveReview.mutationOptions())
  const prepare = useMutation(trpc.artworkDedup.prepareCleanup.mutationOptions())
  const canSave = Boolean(page?.allowedActions.includes('SAVE_REVIEW')) && !query.isError
  const summary = duplicateSelectionSummary(selection, page?.recommendedGroupCount ?? 0)
  const hasSelection = summary.groups === null || summary.groups > 0
  const preparing = intent.pending.has('prepare')
  const unsettledSelection = Object.values(drafts).some(
    (draft) => !isDuplicateManualPair(draft.group) && isDuplicateGroupSelected(selection, draft.group.groupId, true)
  )
  function refreshReview(groupId: string) {
    setCursors([undefined])
    // Review revisions invalidate every opaque cursor. Mark old pages stale without refetching them.
    void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.listGroups.queryKey(), refetchType: 'none' })
    void queryClient.refetchQueries({
      queryKey: trpc.artworkDedup.listGroups.queryOptions({ runId, expectedUserId: userId, limit: 20 }).queryKey,
      exact: true
    })
    void queryClient.refetchQueries({
      queryKey: trpc.artworkDedup.listGroups.queryOptions({ runId, groupId, expectedUserId: userId, limit: 20 })
        .queryKey,
      exact: true
    })
  }
  function effectiveGroup(group: ArtworkDedupGroupDto) {
    const review = saved[group.groupId]
    return review && review.reviewVersion > group.reviewVersion
      ? { ...group, reviewVersion: review.reviewVersion, savedReview: review }
      : group
  }
  function chooseKeeper(rawGroup: ArtworkDedupGroupDto, keeperId: number) {
    if (!page || !canSave || preparing) return
    const group = effectiveGroup(rawGroup)
    if (!canKeepDuplicateMember(group, keeperId)) return
    const input = {
      runId,
      groupId: group.groupId,
      keeperArtworkId: keeperId,
      expectedRunVersion: page.runVersion,
      expectedReviewVersion: group.reviewVersion,
      expectedUserId: userId
    }
    setDrafts((current) => ({ ...current, [group.groupId]: { group, keeperId } }))
    void intent.execute(
      `review:${group.groupId}`,
      JSON.stringify(input),
      (key) => save.mutateAsync({ ...input, idempotencyKey: key }),
      (result) => {
        setSaved((current) =>
          (current[group.groupId]?.reviewVersion ?? 0) > result.review.reviewVersion
            ? current
            : { ...current, [group.groupId]: result.review }
        )
        setSavedRevision((current) => Math.max(current, result.reviewRevision))
        setDrafts((current) => {
          const next = { ...current }
          delete next[group.groupId]
          return next
        })
        refreshReview(group.groupId)
      },
      () => {
        refreshReview(group.groupId)
      }
    )
  }
  function prepareSelection(pairGroup?: ArtworkDedupGroupDto) {
    const pair = pairGroup && isDuplicateManualPair(pairGroup) ? effectiveGroup(pairGroup) : null
    if (pair && (!pair.savedReview || drafts[pair.groupId])) return
    if (
      !page?.allowedActions.includes('PREPARE_CLEANUP') ||
      query.isError ||
      query.isFetching ||
      (!pair && unsettledSelection) ||
      (!pair && summary.groups === 0) ||
      preparing
    ) {
      return
    }
    const input = {
      runId,
      purpose: 'DIRECT_DELETE' as const,
      protocolVersion: 1 as const,
      expectedRunVersion: page.runVersion,
      expectedReviewRevision: Math.max(page.reviewRevision, savedRevision),
      selection: pair ? { kind: 'EXPLICIT' as const, groupIds: [pair.groupId] } : selection.input,
      expectedUserId: userId
    }
    void intent.execute(
      'prepare',
      JSON.stringify(input),
      (key) => prepare.mutateAsync({ ...input, idempotencyKey: key }),
      onOperation
    )
  }
  function retryGroup(groupId: string) {
    const draft = drafts[groupId]
    if (draft) chooseKeeper(page?.items.find((group) => group.groupId === groupId) ?? draft.group, draft.keeperId)
  }
  return (
    <div className={hasSelection ? 'pb-[calc(var(--app-mobile-navigation-offset)+1.5rem)] lg:pb-6' : 'pb-6'}>
      {query.isError ? (
        <DuplicateQueryError
          onRetry={() => {
            if (cursors.length > 1) setCursors([undefined])
            else void query.refetch()
          }}
          busy={query.isFetching}
        />
      ) : null}
      {query.isPending ? (
        <DuplicateLoading />
      ) : page ? (
        <>
          <header className="flex flex-wrap items-center justify-between gap-2 py-2">
            <h2 className="text-sm font-medium">选择保留作品</h2>
            {page.allowedActions.includes('PREPARE_CLEANUP') && page.recommendedGroupCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={preparing || query.isFetching}
                onClick={() => {
                  setSelection({ input: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }, copies: {} })
                  setSelectionError('')
                }}
              >
                按推荐全选（{page.recommendedGroupCount} 组）
              </Button>
            ) : null}
          </header>
          {!page.allowedActions.includes('PREPARE_CLEANUP') ? (
            <p role="status" className="pb-4 text-sm text-muted-foreground">
              可检查和保存保留选择。直接删除尚未开放。
            </p>
          ) : null}
          {page.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有需要处理的重复作品</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            page.items
              .filter((group) => !isDuplicateManualPair(group))
              .map((raw) => {
                const group = effectiveGroup(raw)
                const keeperId =
                  drafts[group.groupId]?.keeperId ??
                  group.savedReview?.keeperArtworkId ??
                  group.recommendedKeeperArtworkId
                const eligible =
                  group.eligibility === 'ELIGIBLE' ||
                  (group.eligibility === 'NEEDS_CHOICE' && Boolean(group.savedReview))
                return (
                  <DuplicateGroupRow
                    key={group.groupId}
                    group={group}
                    keeperId={keeperId}
                    selected={isDuplicateGroupSelected(selection, group.groupId, eligible)}
                    selectable={
                      eligible && keeperId !== null && Boolean(page.allowedActions.includes('PREPARE_CLEANUP'))
                    }
                    saving={intent.pending.has(`review:${group.groupId}`)}
                    failed={Boolean(drafts[group.groupId]) && intent.failed.has(`review:${group.groupId}`)}
                    errorMessage={
                      save.variables?.groupId === group.groupId && save.error?.data?.code === 'CONFLICT'
                        ? save.error.message
                        : undefined
                    }
                    disabled={!canSave || preparing}
                    onSelect={(checked) => {
                      try {
                        setSelection(toggleDuplicateGroup(selection, group.groupId, checked, group.memberCount - 1))
                        setSelectionError('')
                      } catch (error) {
                        setSelectionError((error as Error).message)
                      }
                    }}
                    onKeep={(id) => chooseKeeper(group, id)}
                    onDetails={() => setDetailGroup(group)}
                    onRetry={() => retryGroup(group.groupId)}
                  />
                )
              })
          )}
          {(['PARTIAL', 'VISUAL'] as const).map((relationKind) => {
            const pairs = page.items.filter((group) => group.relationKind === relationKind)
            const label = duplicatePairLabel({ relationKind })
            return pairs.length > 0 ? (
              <section key={relationKind} aria-label={`${label}结果`}>
                <h2 className="pt-3 text-sm font-medium">{label}</h2>
                {pairs.map((raw) => {
                  const group = effectiveGroup(raw)
                  return (
                    <DuplicateVisualRow
                      key={group.groupId}
                      group={group}
                      disabled={preparing}
                      onDetails={() => setDetailGroup(group)}
                    />
                  )
                })}
              </section>
            ) : null
          })}
          {cursors.length > 1 || page.nextCursor ? (
            <DuplicatePagination
              page={cursors.length - 1}
              hasNext={Boolean(page.nextCursor)}
              busy={query.isFetching || preparing}
              onPrevious={() => setCursors((value) => value.slice(0, -1))}
              onNext={() => {
                if (page.nextCursor) setCursors((value) => [...value, page.nextCursor!])
              }}
            />
          ) : null}
          {selectionError ? (
            <p role="alert" className="py-2 text-sm text-destructive">
              {selectionError}
            </p>
          ) : null}
          {intent.failed.has('prepare') ? (
            <Alert>
              <AlertTitle>预览尚未确认</AlertTitle>
              <AlertDescription>
                {prepare.error?.data?.code === 'CONFLICT'
                  ? prepare.error.message
                  : '请重试，已提交的操作不会重复创建。'}
              </AlertDescription>
            </Alert>
          ) : null}
          {hasSelection ? (
            <div
              className="sticky bottom-[var(--app-mobile-navigation-offset)] z-20 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-sm lg:bottom-0"
              aria-label="跨页选择范围"
            >
              <div className="text-sm">
                <p>
                  {summary.groups === null
                    ? `全部推荐 · 当前 ${summary.recommendedGroups} 组推荐，已排除 ${summary.excludedGroups} 组`
                    : `已选 ${summary.groups} 组 · ${summary.copies} 部待删除`}
                </p>
                {summary.groups === null ? (
                  <p className="mt-1 text-xs text-muted-foreground">包括其他页的推荐组，下一步核对要删除的作品。</p>
                ) : null}
                {unsettledSelection ? <p className="mt-1 text-xs text-warning">请先保存所选组的保留作品。</p> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={preparing}
                  onClick={() => setSelection(emptyDuplicateSelection())}
                >
                  取消选择
                </Button>
                {page.allowedActions.includes('PREPARE_CLEANUP') ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={preparing || unsettledSelection || query.isFetching || query.isError}
                    onClick={() => prepareSelection()}
                  >
                    {preparing ? '正在准备' : '核对并删除'}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {detailGroup && isDuplicateManualPair(detailGroup) ? (
        <DuplicateComparisonSheet
          key={`${userId}:${runId}:${detailGroup.groupId}`}
          userId={userId}
          runId={runId}
          group={effectiveGroup(detailGroup)}
          keeperId={
            drafts[detailGroup.groupId]?.keeperId ?? effectiveGroup(detailGroup).savedReview?.keeperArtworkId ?? null
          }
          savedKeeperId={effectiveGroup(detailGroup).savedReview?.keeperArtworkId ?? null}
          saving={intent.pending.has(`review:${detailGroup.groupId}`)}
          failed={Boolean(drafts[detailGroup.groupId]) && intent.failed.has(`review:${detailGroup.groupId}`)}
          preparing={preparing}
          canPrepare={Boolean(page?.allowedActions.includes('PREPARE_CLEANUP')) && !query.isError && !query.isFetching}
          errorMessage={
            save.variables?.groupId === detailGroup.groupId && save.error?.data?.code === 'CONFLICT'
              ? save.error.message
              : undefined
          }
          prepareError={
            intent.failed.has('prepare')
              ? prepare.error?.data?.code === 'CONFLICT'
                ? prepare.error.message
                : '预览尚未确认，请重试同一次处理。'
              : undefined
          }
          onClose={() => setDetailGroup(null)}
          onKeep={chooseKeeper}
          onRetry={() => retryGroup(detailGroup.groupId)}
          onPrepare={() => prepareSelection(effectiveGroup(detailGroup))}
        />
      ) : detailGroup ? (
        <DuplicateMembersSheet
          key={detailGroup.groupId}
          userId={userId}
          runId={runId}
          groupId={detailGroup.groupId}
          reviewRevision={Math.max(page?.reviewRevision ?? 0, savedRevision)}
          keeperId={
            drafts[detailGroup.groupId]?.keeperId ??
            effectiveGroup(detailGroup).savedReview?.keeperArtworkId ??
            detailGroup.recommendedKeeperArtworkId
          }
          saving={intent.pending.has(`review:${detailGroup.groupId}`)}
          failed={Boolean(drafts[detailGroup.groupId]) && intent.failed.has(`review:${detailGroup.groupId}`)}
          errorMessage={
            save.variables?.groupId === detailGroup.groupId && save.error?.data?.code === 'CONFLICT'
              ? save.error.message
              : undefined
          }
          onClose={() => setDetailGroup(null)}
          onKeep={chooseKeeper}
          onRetry={() => retryGroup(detailGroup.groupId)}
        />
      ) : null}
    </div>
  )
}
