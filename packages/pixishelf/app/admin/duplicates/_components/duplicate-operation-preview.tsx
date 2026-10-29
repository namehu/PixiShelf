'use client'

import type { ArtworkDedupArtworkPreviewDto, ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTRPC } from '@/lib/trpc'
import { DuplicateMemberRow } from './duplicate-member-row'
import { DuplicateOrganization } from './duplicate-organization'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'
import {
  duplicateBlockReason,
  duplicateBytes,
  duplicateDiagnosticCode,
  duplicateFileStatus
} from './duplicate-operation-state'
import { DuplicateReimport } from './duplicate-reimport'
import {
  duplicateContainmentCounts,
  duplicatePairCounts,
  duplicatePairLabel,
  duplicateVisualSideCounts,
  isDuplicateManualPair
} from './duplicate-relation'

const roleLabels = {
  MEDIA: '原媒体',
  CHAPTER: '章节文件',
  SOURCE_FILE: '来源文件',
  ATTACHMENT: '附件',
  UNKNOWN: '待确认文件'
}
export function DuplicateOperationPreview({
  operation,
  userId,
  disabled,
  onUpdate,
  onRefresh,
  onReady
}: {
  operation: ArtworkDedupOperationDto
  userId: string
  disabled: boolean
  onUpdate: (operation: ArtworkDedupOperationDto) => void
  onRefresh: () => void
  onReady: (version: number | null) => void
}) {
  const trpc = useTRPC()
  const [kind, setKind] = useState<'ARTWORKS' | 'FILES'>('ARTWORKS')
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const query = useQuery({
    ...trpc.artworkDedup.getOperation.queryOptions({
      operationId: operation.operationId,
      expectedUserId: userId,
      preview: { kind, cursor: cursors.at(-1), limit: 20 }
    }),
    retry: false,
    gcTime: 0
  })
  const preview = query.data?.operation.version === operation.version ? query.data.preview : null
  const ready = Boolean(preview && !query.isError && !query.isFetching && preview.items.length > 0)
  useEffect(() => {
    onReady(ready ? operation.version : null)
  }, [ready, operation.version, onReady])
  return (
    <section className="flex min-w-0 flex-col" aria-label="批次清单">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{kind === 'ARTWORKS' ? '作品' : '文件清单'}</h3>
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            setKind(kind === 'ARTWORKS' ? 'FILES' : 'ARTWORKS')
            setCursors([undefined])
          }}
        >
          {kind === 'ARTWORKS' ? '查看文件清单' : '返回作品'}
        </Button>
      </div>
      {operation.mode === 'PREPARE' && operation.counts.selectedGroups > 1 ? (
        <p className="text-xs text-muted-foreground">将处理全部已选作品，包括其他页的选择。</p>
      ) : null}
      {query.isError ? (
        <DuplicateQueryError
          busy={query.isFetching}
          onRetry={() => {
            onRefresh()
            void query.refetch()
          }}
        />
      ) : null}
      {query.isPending ? (
        <DuplicateLoading />
      ) : preview ? (
        <>
          {preview.items.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {operation.status === 'BUILDING' ? '清单正在生成。' : '本页没有项目。'}
            </p>
          ) : null}
          {preview.kind === 'ARTWORKS'
            ? preview.items.map((item) => (
                <div key={item.itemId} className="border-b py-1 last:border-b-0">
                  <DuplicateMemberRow
                    member={item}
                    keeper={item.role === 'KEEPER'}
                    metadata={`${BigInt(item.mediaCount).toLocaleString()} 项媒体`}
                    unavailable={item.status === 'DELETED' || item.status === 'PURGED'}
                    statusLabel={
                      item.role === 'KEEPER'
                        ? '保留'
                        : item.status === 'DELETED' || item.status === 'PURGED'
                          ? '已删除'
                          : operation.mode === 'PREPARE' && item.status !== 'BLOCKED'
                            ? '待删除'
                            : duplicateFileStatus(item.status)
                    }
                    actions={
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label={`查看${item.title}的详情`}
                          >
                            <Info className="text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          aria-label={`${item.title}的详情`}
                          className="max-h-[min(70dvh,480px)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
                        >
                          <PrivacySensitiveText as="p" className="mb-2 text-sm font-medium break-words">
                            {item.title}
                          </PrivacySensitiveText>
                          {item.personalRecords === 'CURRENT' ? (
                            <>
                              <p className="pb-2 text-xs text-muted-foreground">
                                {operation.mode === 'PREPARE' && item.role === 'COPY'
                                  ? '删除副本时，这些整理记录也会删除，不会转移到保留作品。'
                                  : '我的整理记录'}
                              </p>
                              <DuplicateOrganization member={item} />
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {item.personalRecords === 'REMOVED'
                                ? '整理记录已随副本删除，未保留历史个人明细。'
                                : '当前无法读取整理记录。'}
                            </p>
                          )}
                          <div
                            className="mt-3 flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground"
                            aria-label={`${item.title}的来源保护`}
                          >
                            {item.sources.length > 0 ? (
                              item.sources.map((source) => (
                                <p key={source.sourceId} className="flex flex-wrap items-center gap-2 break-all">
                                  <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
                                  <Badge variant="secondary">
                                    {source.status === 'TOMBSTONE'
                                      ? '防止重复导入'
                                      : source.status === 'HOLD'
                                        ? '正在处理'
                                        : item.role === 'KEEPER'
                                          ? '保留来源'
                                          : item.status === 'DELETED'
                                            ? '允许重新导入'
                                            : '删除后防止重复导入'}
                                  </Badge>
                                </p>
                              ))
                            ) : (
                              <p>无可重新导入的来源。</p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    }
                  />
                  {item.relationKind === 'CONTAINS' && item.role === 'COPY' ? (
                    <p className="pb-2 text-xs leading-6 text-muted-foreground">
                      已完整包含于保留作品{' '}
                      {item.containerArtworkId !== null ? (
                        <a
                          href={`/artworks/${item.containerArtworkId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                        >
                          <PrivacySensitiveText>
                            {preview.items.find((member) => member.artworkId === item.containerArtworkId)?.title ??
                              `#${item.containerArtworkId}`}
                          </PrivacySensitiveText>
                          <span className="sr-only">（新标签页）</span>
                        </a>
                      ) : (
                        '（信息暂不可用）'
                      )}
                      <span className="block">{duplicateContainmentCounts(item)}</span>
                    </p>
                  ) : null}
                  {isDuplicateManualPair(item) && item.visual && item.role === 'COPY' ? (
                    <DuplicatePairDeletionImpact item={item} />
                  ) : null}
                  {item.reasons.length > 0 ? (
                    <p className="pb-2 pl-14 text-sm text-warning">
                      {item.reasons.map(duplicateBlockReason).join('；')}
                    </p>
                  ) : null}
                </div>
              ))
            : preview.items.map((file) => (
                <div key={file.fileId} className="border-b py-4 last:border-b-0">
                  <PrivacySensitiveText as="p" className="break-all text-sm">
                    {file.relativeName}
                  </PrivacySensitiveText>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {file.artworkRole === 'KEEPER'
                      ? '保留作品的文件，不删除'
                      : file.artworkRole === 'COPY'
                        ? '删除副本的文件'
                        : '文件归属待核对'}
                    {file.artworkTitle ? (
                      <>
                        {' '}
                        · <PrivacySensitiveText>{file.artworkTitle}</PrivacySensitiveText>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {roleLabels[file.role]} · {duplicateBytes(file.sizeBytes)} · {duplicateFileStatus(file.status)}
                  </p>
                  {file.blockReason || file.requiresReview ? (
                    <p className="mt-2 text-sm text-warning">
                      {file.blockReason ? duplicateBlockReason(file.blockReason) : '需要确认归属，暂不自动处理。'}
                    </p>
                  ) : null}
                  {file.blockReason ? (
                    <details>
                      <summary className="flex min-h-11 cursor-pointer items-center text-xs text-primary">
                        诊断信息
                      </summary>
                      <p className="text-xs text-muted-foreground">{duplicateDiagnosticCode(file.blockReason)}</p>
                    </details>
                  ) : null}
                </div>
              ))}
          {cursors.length > 1 || preview.nextCursor ? (
            <DuplicatePagination
              page={cursors.length - 1}
              hasNext={Boolean(preview.nextCursor)}
              busy={query.isFetching}
              onPrevious={() => setCursors((value) => value.slice(0, -1))}
              onNext={() => {
                if (preview.nextCursor) setCursors((value) => [...value, preview.nextCursor!])
              }}
            />
          ) : null}
        </>
      ) : !query.isError && !query.isFetching ? (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            onRefresh()
            void query.refetch()
          }}
        >
          清单已更新，点击刷新
        </Button>
      ) : null}
      <DuplicateReimport
        operation={operation}
        userId={userId}
        items={preview?.kind === 'ARTWORKS' ? preview.items : []}
        disabled={disabled || query.isError || !preview}
        onUpdate={onUpdate}
        onRefresh={onRefresh}
      />
    </section>
  )
}

function DuplicatePairDeletionImpact({ item }: { item: ArtworkDedupArtworkPreviewDto }) {
  const visual = item.visual
  if (!visual) return null
  const copy = duplicateVisualSideCounts(visual, item.artworkId)
  const keeper = duplicateVisualSideCounts(
    visual,
    item.artworkId === visual.leftArtworkId ? visual.rightArtworkId : visual.leftArtworkId
  )
  const partial = item.relationKind === 'PARTIAL'
  const deleted = item.status === 'DELETED'
  const unit = partial ? '项原媒体' : '张'
  const unmatched = `保留版本未配对 ${keeper.unmatched.toLocaleString('zh-CN')} ${unit}；删除版本未配对 ${copy.unmatched.toLocaleString('zh-CN')} ${unit}`
  return (
    <p className="pb-2 text-xs leading-5 text-muted-foreground">
      <span className="block">{duplicatePairLabel(item)} · {duplicatePairCounts(item)}</span>
      <span className="block">
        {BigInt(visual.leftFileCount).toLocaleString('zh-CN')} /{' '}
        {BigInt(visual.rightFileCount).toLocaleString('zh-CN')} 项原媒体
      </span>
      {unmatched}
      {partial ? `，${deleted ? '已随该版本删除' : '将随该版本删除'}。` : '。'}
      {!partial ? (
        <span className="block">
          整部作品的全部 {copy.total.toLocaleString('zh-CN')} 项原媒体
          {copy.unchecked > 0n ? `（含 ${copy.unchecked.toLocaleString('zh-CN')} 项未核对）` : ''}
          和整理记录{deleted ? '已随该版本删除' : '将随该版本删除'}。
        </span>
      ) : null}
    </p>
  )
}
