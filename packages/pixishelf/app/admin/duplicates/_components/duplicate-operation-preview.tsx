'use client'

import type { ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    <section className="flex flex-col gap-3" aria-label="批次清单">
      <h3 className="text-sm font-medium">服务器冻结的批次清单</h3>
      <p className="text-xs leading-5 text-muted-foreground">
        包含未加载页。作品、文件与来源均由服务器确定；不会仅删除当前页面的项目。
      </p>
      <Tabs
        value={kind}
        onValueChange={(value) => {
          setKind(value as 'ARTWORKS' | 'FILES')
          setCursors([undefined])
        }}
      >
        <TabsList className="h-auto">
          <TabsTrigger value="ARTWORKS" className="min-h-11">
            保留者与副本
          </TabsTrigger>
          <TabsTrigger value="FILES" className="min-h-11">
            原件与附属文件
          </TabsTrigger>
        </TabsList>
      </Tabs>
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
                <div key={item.itemId} className="border-b py-2">
                  <DuplicateMemberRow member={item} keeper={item.role === 'KEEPER'} />
                  <p className="px-3 pb-2 text-xs text-muted-foreground">
                    {item.role === 'KEEPER'
                      ? '保留作品，不删除、不合并整理记录'
                      : `删除副本 · ${duplicateFileStatus(item.status)}`}
                    <br />
                    {BigInt(item.mediaCount).toLocaleString()} 个登记原媒体 · {BigInt(item.fileCount).toLocaleString()}{' '}
                    个清单文件 · 创建于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                  {item.reasons.length > 0 ? (
                    <p className="px-3 pb-2 text-sm text-warning">
                      {item.reasons.map(duplicateBlockReason).join('；')}
                    </p>
                  ) : null}
                  <details className="px-3">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm text-primary">
                      我的整理记录
                    </summary>
                    {item.personalRecords === 'CURRENT' ? (
                      <>
                        <p className="pb-2 text-xs text-muted-foreground">
                          当前账户的实时记录，执行前会再次复核。副本记录随删除清理，不合并。
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
                  </details>
                  <div
                    className="flex flex-col gap-2 px-3 py-2 text-xs text-muted-foreground"
                    aria-label={`${item.title}的来源保护`}
                  >
                    {item.sources.length > 0 ? (
                      item.sources.map((source) => (
                        <p key={source.sourceId} className="flex flex-wrap items-center gap-2 break-all">
                          <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
                          <Badge variant="secondary">
                            {source.status === 'TOMBSTONE'
                              ? '已抑制重新导入'
                              : source.status === 'HOLD'
                                ? '处理中，来源受保护'
                                : item.role === 'KEEPER'
                                  ? '保留来源'
                                  : item.status === 'DELETED'
                                    ? '已允许新输入'
                                    : '删除后保留来源抑制'}
                          </Badge>
                        </p>
                      ))
                    ) : (
                      <p>未登记可重新发现的来源，不生成额外来源。</p>
                    )}
                  </div>
                </div>
              ))
            : preview.items.map((file) => (
                <div key={file.fileId} className="border-b py-4">
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
          <DuplicatePagination
            page={cursors.length - 1}
            hasNext={Boolean(preview.nextCursor)}
            busy={query.isFetching}
            onPrevious={() => setCursors((value) => value.slice(0, -1))}
            onNext={() => {
              if (preview.nextCursor) setCursors((value) => [...value, preview.nextCursor!])
            }}
          />
        </>
      ) : !query.isError && !query.isFetching ? (
        <Button variant="outline" className="min-h-11" onClick={onRefresh}>
          清单已更新，刷新批次状态
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
