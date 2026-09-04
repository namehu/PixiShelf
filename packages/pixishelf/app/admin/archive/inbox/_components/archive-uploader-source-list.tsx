'use client'

import { ARCHIVE_TITLE_MATCH_LABELS } from '@pixishelf/job-contracts'
import type { inferRouterOutputs } from '@trpc/server'
import { CopyIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { historyCoverageLabel } from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type UploaderSource = RouterOutputs['archiveSearch']['listSources'][number]

export function ArchiveUploaderSourceList({
  sources,
  selectedSourceId,
  onSelect,
  onCopyUid
}: {
  sources: UploaderSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string) => void
  onCopyUid: (uploaderUid: string) => void
}) {
  return (
    <Card className="h-fit gap-2 py-3">
      <CardHeader className="px-3">
        <CardTitle className="text-sm">已保存来源</CardTitle>
        <CardDescription>{sources.length} 个来源，包含已停用项</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-2">
        {sources.map((source) => (
          <div key={source.id} className="flex items-center gap-1">
            <Button
              variant={selectedSourceId === source.id ? 'secondary' : 'ghost'}
              className="h-auto min-h-14 min-w-0 flex-1 justify-start px-3 py-2 text-left"
              onClick={() => onSelect(source.id)}
            >
              <span className="min-w-0 flex-1">
                <PrivacySensitiveText className="block truncate font-medium">{source.displayName}</PrivacySensitiveText>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {source.titleQuery
                    ? (
                        <>
                          标题{ARCHIVE_TITLE_MATCH_LABELS[source.titleQuery.matchMode]}「
                          <PrivacySensitiveText>{source.titleQuery.keyword}</PrivacySensitiveText>」
                        </>
                      )
                    : source.uploaderUid
                      ? `UID ${source.uploaderUid}`
                      : (
                          <>
                            按名称：<PrivacySensitiveText>{source.identityValue}</PrivacySensitiveText>
                          </>
                        )}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  待处理 {source.catalogCounts.actionable} ·{' '}
                  {source.uidBindingState === 'REVALIDATION_REQUIRED'
                    ? 'UID 覆盖待校验'
                    : historyCoverageLabel(source.historyCoverage)}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {source.titleQuery ? <Badge variant="secondary">关键词</Badge> : null}
                {!source.titleQuery && source.uidBindingState === 'UNBOUND' ? (
                  <Badge variant="warning">未绑定 UID</Badge>
                ) : null}
                {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
                  <Badge variant="warning">UID 待校验</Badge>
                ) : null}
                {source.catalogCounts.attention > 0 ? (
                  <Badge variant="warning">异常 {source.catalogCounts.attention}</Badge>
                ) : null}
                {source.status === 'ARCHIVED' ? <Badge variant="muted">已停用</Badge> : null}
              </span>
            </Button>
            {source.uploaderUid ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`复制 ${source.displayName} 的 UID`}
                onClick={() => onCopyUid(source.uploaderUid!)}
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
