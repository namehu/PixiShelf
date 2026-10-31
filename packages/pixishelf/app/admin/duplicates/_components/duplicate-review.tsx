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
import { DuplicateBatchConfirmation, DuplicateBatchProgress, type DeleteBatch } from './duplicate-batch-delete'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'
import {
  duplicateSelectionSummary,
  emptyDuplicateSelection,
  isDuplicateGroupSelected,
  toggleDuplicateGroup
} from './duplicate-selection'
import { useDuplicateIntent } from './use-duplicate-intent'
import { canKeepDuplicateMember, isDuplicateManualPair } from './duplicate-relation'

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
  runId
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
  const [manualSelectedGroups, setManualSelectedGroups] = useState<string[]>([])
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
  const prepare = useMutation(trpc.artworkDedup.previewDeleteSelection.mutationOptions())
  const [confirmation, setConfirmation] = useState<DeleteBatch | null>(null)
  const canSave = Boolean(page?.allowedActions.includes('SAVE_REVIEW')) && !query.isError
  const summary = duplicateSelectionSummary(selection, page?.recommendedGroupCount ?? 0)
  const hasSelection = summary.groups === null || summary.groups > 0
  const preparing = intent.pending.has('prepare')
  const unsettledSelection = Object.values(drafts).some((draft) =>
    isDuplicateGroupSelected(selection, draft.group.groupId, !isDuplicateManualPair(draft.group))
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
  const selectionInput = {
    runId,
    expectedRunVersion: page?.runVersion ?? 0,
    expectedReviewRevision: Math.max(page?.reviewRevision ?? 0, savedRevision),
    selection: selection.input,
    expectedUserId: userId
  }
  const resolved = useQuery({
    ...trpc.artworkDedup.resolveDeleteSelection.queryOptions(selectionInput),
    enabled: Boolean(page && hasSelection && !unsettledSelection),
    retry: false
  })
  function selectGroup(group: ArtworkDedupGroupDto, checked: boolean) {
    try {
      if (isDuplicateManualPair(group)) {
        setManualSelectedGroups((ids) =>
          checked ? [...new Set([...ids, group.groupId])] : ids.filter((id) => id !== group.groupId)
        )
      }
      setSelection(
        toggleDuplicateGroup(selection, group.groupId, checked, group.memberCount - 1, isDuplicateManualPair(group))
      )
      setSelectionError('')
    } catch (error) {
      setSelectionError((error as Error).message)
    }
  }
  function prepareSelection() {
    if (!page || !hasSelection || unsettledSelection || preparing || resolved.isFetching || resolved.isError) return
    void intent.execute(
      'prepare',
      JSON.stringify(selectionInput),
      (key) => prepare.mutateAsync({ ...selectionInput, idempotencyKey: key }),
      setConfirmation
    )
  }
  function retryGroup(groupId: string) {
    const draft = drafts[groupId]
    if (draft) chooseKeeper(page?.items.find((group) => group.groupId === groupId) ?? draft.group, draft.keeperId)
  }
  return (
    <div className={hasSelection ? 'pb-[calc(var(--app-mobile-navigation-offset)+1.5rem)] lg:pb-6' : 'pb-6'}>
      <DuplicateBatchProgress userId={userId} runId={runId} onConfirm={setConfirmation} />
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
                  setSelection({
                    input: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [], manualGroupIds: manualSelectedGroups },
                    copies: selection.copies
                  })
                  setSelectionError('')
                }}
              >
                按推荐选择（全部页 · {page.recommendedGroupCount} 组）
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
            page.items.map((raw) => {
              const group = effectiveGroup(raw)
              const keeperId =
                drafts[group.groupId]?.keeperId ??
                group.savedReview?.keeperArtworkId ??
                group.recommendedKeeperArtworkId
              const eligible =
                group.eligibility === 'ELIGIBLE' || (group.eligibility === 'NEEDS_CHOICE' && Boolean(group.savedReview))
              return (
                <DuplicateGroupRow
                  key={group.groupId}
                  group={group}
                  keeperId={keeperId}
                  selected={isDuplicateGroupSelected(
                    selection,
                    group.groupId,
                    eligible && !isDuplicateManualPair(group)
                  )}
                  selectable={eligible && keeperId !== null && Boolean(page.allowedActions.includes('PREPARE_CLEANUP'))}
                  saving={intent.pending.has(`review:${group.groupId}`)}
                  failed={Boolean(drafts[group.groupId]) && intent.failed.has(`review:${group.groupId}`)}
                  errorMessage={
                    save.variables?.groupId === group.groupId && save.error?.data?.code === 'CONFLICT'
                      ? save.error.message
                      : undefined
                  }
                  disabled={!canSave || preparing}
                  onSelect={(checked) => selectGroup(group, checked)}
                  onKeep={(id) => chooseKeeper(group, id)}
                  onDetails={() => setDetailGroup(group)}
                  onRetry={() => retryGroup(group.groupId)}
                />
              )
            })
          )}
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
          {resolved.error ? (
            <p role="alert" className="py-2 text-sm text-destructive">
              {resolved.error.message}
            </p>
          ) : null}
          {selectionError ? (
            <p role="alert" className="py-2 text-sm text-destructive">
              {selectionError}
            </p>
          ) : null}
          {intent.failed.has('prepare') ? (
            <Alert>
              <AlertTitle>未能打开确认</AlertTitle>
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
                    ? `已选 ${resolved.data?.artworkIds.length ?? '…'} 部 · 全部页推荐，另含手动勾选的版本`
                    : `已选 ${resolved.data?.artworkIds.length ?? '…'} 部 · ${summary.groups} 组（跨页保留）`}
                </p>
                {summary.groups === null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    仅推荐内容相同与完整包含；部分重复、疑似版本需手动保留并勾选。
                  </p>
                ) : null}
                {unsettledSelection ? <p className="mt-1 text-xs text-warning">请先保存所选组的保留作品。</p> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={preparing}
                  onClick={() => {
                    setSelection(emptyDuplicateSelection())
                    setManualSelectedGroups([])
                  }}
                >
                  取消选择
                </Button>
                {page.allowedActions.includes('PREPARE_CLEANUP') ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={
                      preparing ||
                      unsettledSelection ||
                      query.isFetching ||
                      query.isError ||
                      resolved.isError ||
                      resolved.isFetching ||
                      !resolved.data?.artworkIds.length
                    }
                    onClick={() => prepareSelection()}
                  >
                    {preparing ? '正在读取删除范围…' : '删除所选'}
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
          selected={isDuplicateGroupSelected(selection, detailGroup.groupId, false)}
          onPrepare={() =>
            selectGroup(effectiveGroup(detailGroup), !isDuplicateGroupSelected(selection, detailGroup.groupId, false))
          }
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
          selected={isDuplicateGroupSelected(selection, detailGroup.groupId, true)}
          onSelect={(checked) => selectGroup(effectiveGroup(detailGroup), checked)}
        />
      ) : null}
      {confirmation ? (
        <DuplicateBatchConfirmation
          key={confirmation.jobId}
          userId={userId}
          batch={confirmation}
          onClose={() => {
            setConfirmation(null)
            void queryClient.invalidateQueries({ queryKey: trpc.artwork.batchDeleteList.queryKey() })
          }}
          onSubmitted={() => {
            setConfirmation(null)
            setSelection(emptyDuplicateSelection())
            setManualSelectedGroups([])
            void queryClient.invalidateQueries({ queryKey: trpc.artwork.batchDeleteList.queryKey() })
            void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.listGroups.queryKey() })
          }}
        />
      ) : null}
    </div>
  )
}
