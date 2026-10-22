'use client'

import {
  ARCHIVE_TITLE_REASON_LABELS,
  ARCHIVE_TITLE_RULE_OPERATORS,
  archiveTitleAccepted,
  decodeArchiveTitle,
  type ArchiveTitleEvaluation,
  type ArchiveTitleEvidence,
  type ArchiveTitleReviewDecision
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
  return (
    <details className="group/evidence pointer-events-auto mt-2 min-w-0 text-xs">
      <summary className="flex min-h-9 cursor-pointer list-none items-start gap-2 rounded-sm py-1.5 leading-6 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
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
              · {ARCHIVE_TITLE_RULE_OPERATORS[evaluation.condition.operator]}「{evaluation.condition.text}」
            </PrivacySensitiveText>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 group-open/evidence:rotate-90" />
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
          <PrivacySensitiveText key={index} as="p" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {decodeArchiveTitle(title)}
          </PrivacySensitiveText>
        ))}
      </div>
    </details>
  )
}
