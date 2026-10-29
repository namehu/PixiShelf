'use client'

import type { ArtworkDedupGroupDto, ArtworkDedupListComparisonsDto } from '@pixishelf/job-contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Check, ImageOff } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { DuplicateOrganization } from './duplicate-organization'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'
import { duplicateBlockReason } from './duplicate-operation-state'
import { duplicatePairCounts, duplicateVisualSideCounts } from './duplicate-relation'

type Comparison = ArtworkDedupListComparisonsDto['items'][number]
type Filter = 'ALL' | 'DIFFERENT' | 'PAIRED' | 'UNMATCHED' | 'UNCHECKED'

function ComparisonImage({ media, title, unchecked }: { media: Comparison['left']; title: string; unchecked: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!media) {
    return (
      <p className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
        {unchecked ? '本行未列出此版本的对应项' : '此版本没有对应图片'}
      </p>
    )
  }
  if (unchecked) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <ImageOff className="size-5" aria-hidden="true" />
        <Badge variant="outline">未核对</Badge>
        <p>此项未参与图片比较，请打开作品核对原件。</p>
      </div>
    )
  }
  if (!media.thumbnailUrl || failed) {
    return (
      <div
        className="flex min-h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <ImageOff className="size-5" aria-hidden="true" />
        <p>图片暂不可用</p>
        {media.thumbnailUrl ? (
          <Button variant="ghost" className="min-h-11" onClick={() => setFailed(false)}>
            重试图片
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <img
      src={media.thumbnailUrl}
      alt={`${title}，第 ${media.index + 1} 张`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="mx-auto max-h-[45dvh] min-h-40 w-full object-contain"
      data-privacy-sensitive=""
    />
  )
}

export function DuplicateComparisonSheet({
  userId,
  runId,
  group,
  keeperId,
  savedKeeperId,
  saving,
  failed,
  preparing,
  canPrepare,
  errorMessage,
  prepareError,
  onClose,
  onKeep,
  onRetry,
  onPrepare
}: {
  userId: string
  runId: string
  group: ArtworkDedupGroupDto
  keeperId: number | null
  savedKeeperId: number | null
  saving: boolean
  failed: boolean
  preparing: boolean
  canPrepare: boolean
  errorMessage?: string
  prepareError?: string
  onClose: () => void
  onKeep: (group: ArtworkDedupGroupDto, artworkId: number) => void
  onRetry: () => void
  onPrepare: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const returnFocus = useRef(typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null)
  const partial = group.relationKind === 'PARTIAL'
  const [filter, setFilter] = useState<Filter>(partial ? 'UNMATCHED' : 'DIFFERENT')
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const options = trpc.artworkDedup.listComparisons.queryOptions({
    expectedUserId: userId,
    runId,
    groupId: group.groupId,
    filter,
    cursor: cursors.at(-1),
    limit: 1
  })
  const comparisons = useQuery({ ...options, retry: false, gcTime: 0 })
  const members = useQuery({
    ...trpc.artworkDedup.listGroups.queryOptions({ runId, groupId: group.groupId, expectedUserId: userId, limit: 20 }),
    retry: false,
    gcTime: 0
  })
  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
    }
  }, [queryClient, options.queryKey])
  const page = comparisons.data
  const memberPage = members.data?.kind === 'MEMBERS' ? members.data : null
  const visual = page?.visual ?? group.visual
  const pair = page?.items[0]
  const canSave =
    Boolean(memberPage?.allowedActions.includes('SAVE_REVIEW')) &&
    memberPage?.group.eligibility !== 'STALE' &&
    memberPage?.group.eligibility !== 'BLOCKED' &&
    !members.isError &&
    !comparisons.isError &&
    !saving &&
    !preparing
  const canDelete =
    canPrepare &&
    Boolean(savedKeeperId) &&
    savedKeeperId === keeperId &&
    !saving &&
    !failed &&
    !preparing &&
    !comparisons.isError &&
    !members.isError &&
    !comparisons.isFetching &&
    !members.isFetching &&
    Boolean(page && memberPage && memberPage.group.eligibility === 'ELIGIBLE')
  function refresh() {
    void comparisons.refetch()
    void members.refetch()
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !preparing) onClose()
      }}
    >
      <SheetContent
        className="w-full overflow-hidden pt-[env(safe-area-inset-top)] sm:max-w-[940px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <SheetHeader className="shrink-0 gap-1 border-b px-4 py-3 pr-14">
          <SheetTitle className="text-lg">{partial ? '部分重复 · 图片对照' : '查看差异'}</SheetTitle>
          <SheetDescription className="text-xs">
            {visual ? duplicatePairCounts({ relationKind: group.relationKind, visual }) : '请核对原件后选择保留作品。'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ToggleGroup
            type="single"
            variant="outline"
            value={filter}
            aria-label="图片筛选"
            className="flex-wrap justify-start"
            disabled={comparisons.isFetching || preparing}
            onValueChange={(value) => {
              if (['ALL', 'DIFFERENT', 'PAIRED', 'UNMATCHED', 'UNCHECKED'].includes(value)) {
                setFilter(value as Filter)
                setCursors([undefined])
              }
            }}
          >
            {!partial ? (
              <ToggleGroupItem value="DIFFERENT" className="min-h-11 px-3">
                差异与未核对
              </ToggleGroupItem>
            ) : null}
            <ToggleGroupItem value="PAIRED" className="min-h-11 px-3">
              {partial ? '相同图片' : '已配对'}
            </ToggleGroupItem>
            <ToggleGroupItem value="UNMATCHED" className="min-h-11 px-3">
              未配对
            </ToggleGroupItem>
            {!partial ? (
              <ToggleGroupItem value="UNCHECKED" className="min-h-11 px-3">
                未核对
              </ToggleGroupItem>
            ) : null}
            <ToggleGroupItem value="ALL" className="min-h-11 px-3">
              全部
            </ToggleGroupItem>
          </ToggleGroup>
          {partial ? (
            <p className="text-xs leading-5 text-muted-foreground">
              未配对不代表内容独有。动画和视频请打开作品核对完整原件。
            </p>
          ) : null}
          {comparisons.isError || members.isError ? (
            <DuplicateQueryError busy={comparisons.isFetching || members.isFetching} onRetry={refresh} />
          ) : null}
          {comparisons.isPending || members.isPending ? (
            <DuplicateLoading label="正在加载图片对照" />
          ) : page && visual ? (
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                value={side}
                onValueChange={(value) => {
                  if (value === 'left' || value === 'right') setSide(value)
                }}
                aria-label="切换对照版本"
                className="w-full sm:hidden"
              >
                <ToggleGroupItem value="left" className="min-h-11 flex-1">
                  左侧版本
                </ToggleGroupItem>
                <ToggleGroupItem value="right" className="min-h-11 flex-1">
                  右侧版本
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {(['left', 'right'] as const).map((currentSide) => {
                  const artworkId = currentSide === 'left' ? visual.leftArtworkId : visual.rightArtworkId
                  const member =
                    memberPage?.items.find((item) => item.artworkId === artworkId) ??
                    group.previewMembers.find((item) => item.artworkId === artworkId)
                  const media = pair?.[currentSide] ?? null
                  const title = member?.title ?? `作品 #${artworkId}`
                  const coverage = duplicateVisualSideCounts(visual, artworkId)
                  const unchecked = pair?.kind === 'UNCHECKED'
                  const mediaLabel = media
                    ? `第 ${media.index + 1} ${unchecked ? '项' : '张'}`
                    : pair
                      ? unchecked ? '本行未列出对应项' : '无对应图片'
                      : '本筛选无图片'
                  return (
                    <section
                      key={currentSide}
                      aria-label={currentSide === 'left' ? '左侧版本对照' : '右侧版本对照'}
                      className={cn('min-w-0 rounded-lg border p-3', side !== currentSide && 'hidden sm:block')}
                    >
                      <div className="mb-3 flex min-h-11 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <a
                            href={`/artworks/${artworkId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <PrivacySensitiveText className="line-clamp-2 break-words">{title}</PrivacySensitiveText>
                            <span className="sr-only">（新标签页）</span>
                          </a>
                          <p className="text-xs text-muted-foreground">
                            {currentSide === 'left' ? '左侧版本' : '右侧版本'} ·{' '}
                            {coverage.total.toLocaleString('zh-CN')} 项原媒体
                            {!partial ? `（已核对 ${coverage.checked.toLocaleString('zh-CN')} · 未核对 ${coverage.unchecked.toLocaleString('zh-CN')}）` : ''}
                            {' · '}
                            {mediaLabel}
                          </p>
                        </div>
                        <Button
                          variant={keeperId === artworkId ? 'secondary' : 'outline'}
                          className="min-h-11 shrink-0"
                          disabled={!canSave || !member}
                          aria-pressed={keeperId === artworkId}
                          aria-label={`保留此版本：${title}`}
                          onClick={() => onKeep(memberPage?.group ?? group, artworkId)}
                        >
                          {keeperId === artworkId ? <Check data-icon="inline-start" aria-hidden="true" /> : null}
                          {keeperId === artworkId ? '已选保留' : '保留此版本'}
                        </Button>
                      </div>
                      {pair ? (
                        <ComparisonImage
                          key={`${pair.id}:${currentSide}:${media?.imageId}:${media?.thumbnailUrl}`}
                          media={media}
                          title={title}
                          unchecked={unchecked}
                        />
                      ) : null}
                      {member ? (
                        <details className="mt-2">
                          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted-foreground">
                            我的整理记录
                          </summary>
                          <DuplicateOrganization member={member} />
                        </details>
                      ) : null}
                    </section>
                  )
                })}
              </div>
              {!pair ? (
                <Empty className="py-4">
                  <EmptyHeader>
                    <EmptyTitle>此筛选没有图片</EmptyTitle>
                    <EmptyDescription>可以切换筛选，继续核对其他图片。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {pair ? (
                <p className="text-center text-xs text-muted-foreground">
                  {pair.kind === 'EXACT'
                    ? '原文件相同'
                    : pair.kind === 'SIMILAR'
                      ? '图片相似，请核对差异'
                      : pair.kind === 'UNCHECKED'
                        ? '未核对项目，不能据此判断两个版本的内容是否相同'
                        : '未配对图片'}
                </p>
              ) : null}
              {cursors.length > 1 || page.nextCursor ? (
                <DuplicatePagination
                  page={cursors.length - 1}
                  hasNext={Boolean(page.nextCursor)}
                  busy={comparisons.isFetching || preparing}
                  label="图片对照分页"
                  onPrevious={() => setCursors((value) => value.slice(0, -1))}
                  onNext={() => {
                    if (page.nextCursor) setCursors((value) => [...value, page.nextCursor!])
                  }}
                />
              ) : null}
            </>
          ) : null}
          {memberPage?.group.reasons
            .filter((reason) => reason !== 'EXPLICIT_CHOICE_REQUIRED')
            .map((reason) => (
              <p key={reason} className="text-sm text-warning">
                {duplicateBlockReason(reason)}
              </p>
            ))}
          {prepareError ? (
            <p role="alert" className="text-sm text-destructive">
              {prepareError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="text-sm text-muted-foreground" aria-live="polite">
              {saving ? (
                '正在保存保留选择…'
              ) : failed ? (
                <>
                  <span className="text-destructive">{errorMessage ?? '保留选择未保存'}</span>
                  <Button variant="ghost" className="min-h-11" onClick={onRetry}>
                    重试保存
                  </Button>
                </>
              ) : keeperId ? (
                '将只处理这一对，下一步确认删除范围。'
              ) : (
                '请明确选择保留哪一个版本。'
              )}
            </div>
            <Button className="min-h-11" disabled={!canDelete} onClick={onPrepare}>
              {preparing ? '正在打开确认' : '确认删除'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
