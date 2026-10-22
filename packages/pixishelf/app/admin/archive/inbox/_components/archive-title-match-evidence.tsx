'use client'

import {
  ARCHIVE_TITLE_REASON_LABELS,
  ARCHIVE_TITLE_RULE_OPERATORS,
  archiveTitleAccepted,
  archiveTitleConditionMatchRanges,
  decodeArchiveTitle,
  type ArchiveTitleEvaluation,
  type ArchiveTitleEvidence,
  type ArchiveTitleReviewDecision,
  type ArchiveTitleMatchRange
} from '@pixishelf/job-contracts'
import { Check, ChevronRight, CircleHelp, X } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function ArchiveTitleMatchEvidence({
  evaluation,
  evidence,
  decision = 'AUTO',
  showStatusMarker = true
}: {
  evaluation?: ArchiveTitleEvaluation | null
  evidence?: ArchiveTitleEvidence
  decision?: ArchiveTitleReviewDecision
  showStatusMarker?: boolean
}) {
  const titles = evaluation?.evidence ?? evidence
  const pending = !evaluation || (evaluation.reason === 'MISSING_TITLE' && decision === 'AUTO')
  const accepted = evaluation ? archiveTitleAccepted(evaluation, decision) : false
  const StatusIcon = pending ? CircleHelp : accepted ? Check : X
  const matchedRawTitle = evaluation?.titleIndex != null ? titles?.titles[evaluation.titleIndex] : undefined
  const matchedTitle = matchedRawTitle != null ? decodeArchiveTitle(matchedRawTitle) : null
  const excluded = evaluation?.reason === 'EXCLUDED'
  const ranges =
    evaluation?.matchRanges ??
    (matchedRawTitle != null && evaluation?.condition
      ? archiveTitleConditionMatchRanges(matchedRawTitle, evaluation.condition)
      : [])
  return (
    <div className="pointer-events-auto mt-2 flex min-w-0 flex-col gap-1 text-xs">
      <div className="flex min-h-9 items-start gap-2 py-1.5 leading-6 text-muted-foreground">
        {showStatusMarker ? (
          <StatusIcon
            aria-hidden="true"
            className={cn(
              'mt-1 size-4 shrink-0',
              pending ? 'text-warning' : accepted ? 'text-success' : 'text-destructive'
            )}
          />
        ) : null}
        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
          {decision !== 'AUTO' ? (
            <Badge variant="secondary" className="mr-2">
              {decision === 'INCLUDE' ? '手动接纳' : '手动排除'}
            </Badge>
          ) : null}
          {decision !== 'AUTO' && evaluation ? '规则判断：' : null}
          <span>{evaluation ? ARCHIVE_TITLE_REASON_LABELS[evaluation.reason] : '历史判断，展开查看标题'}</span>
          {evaluation?.condition ? (
            <PrivacySensitiveText>
              {' '}
              · {ARCHIVE_TITLE_RULE_OPERATORS[evaluation.condition.operator]}「{evaluation.condition.text}」{' · '}
              {evaluation.condition.ignoreCase === false ? '区分大小写' : '忽略大小写'}
            </PrivacySensitiveText>
          ) : null}
        </span>
      </div>
      {matchedTitle != null ? (
        <div className={cn('min-w-0 border-l-2 pl-3', excluded ? 'border-destructive/40' : 'border-success/40')}>
          <p className="mb-1 text-muted-foreground">
            {excluded ? '触发排除的标题' : '命中标题'}
            {titles?.origin === 'HISTORICAL' ? ' · 历史快照' : ''}
          </p>
          <PrivacySensitiveText
            as="p"
            className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]"
          >
            <HighlightedTitle title={matchedTitle} ranges={ranges} excluded={excluded} />
          </PrivacySensitiveText>
          {ranges.length > 0 && ranges.every(({ start, end }) => start === end) ? (
            <p className="mt-1 text-muted-foreground">正则命中了位置，没有可高亮的字符。</p>
          ) : null}
        </div>
      ) : null}
      <details className="group/evidence min-w-0">
        <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 group-open/evidence:rotate-90" />
          全部判断标题{titles?.titles.length ? `（${titles.titles.filter(Boolean).length}）` : ''}
        </summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-3">
          <p>
            {titles?.origin === 'REMOTE'
              ? '扫描保存的原始标题'
              : titles?.origin === 'HISTORICAL'
                ? '历史标题快照（旧空白格式可能已规范化）'
                : '没有可用的标题证据'}
          </p>
          {titles?.titles.filter(Boolean).map((title, index) => (
            <PrivacySensitiveText
              key={index}
              as="p"
              className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            >
              {decodeArchiveTitle(title)}
            </PrivacySensitiveText>
          ))}
        </div>
      </details>
    </div>
  )
}

function HighlightedTitle({
  title,
  ranges,
  excluded
}: {
  title: string
  ranges: ArchiveTitleMatchRange[]
  excluded: boolean
}) {
  const merged: ArchiveTitleMatchRange[] = []
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (range.start < 0 || range.end > title.length || range.start >= range.end) continue
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  let offset = 0
  const pieces = merged.map(({ start, end }) => {
    const prefix = title.slice(offset, start)
    offset = end
    return (
      <span key={`${start}-${end}`}>
        {prefix}
        <mark
          className={cn(
            'rounded-sm font-semibold',
            excluded ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'
          )}
        >
          {title.slice(start, end)}
        </mark>
      </span>
    )
  })
  return (
    <>
      {pieces}
      {title.slice(offset)}
    </>
  )
}
