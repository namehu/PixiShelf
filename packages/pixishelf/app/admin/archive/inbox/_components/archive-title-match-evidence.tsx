'use client'

import {
  ARCHIVE_TITLE_REASON_LABELS,
  ARCHIVE_TITLE_RULE_OPERATORS,
  decodeArchiveTitle,
  type ArchiveTitleEvaluation,
  type ArchiveTitleEvidence,
  type ArchiveTitleReviewDecision
} from '@pixishelf/job-contracts'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'

export function ArchiveTitleMatchEvidence({
  evaluation,
  evidence,
  decision = 'AUTO'
}: {
  evaluation?: ArchiveTitleEvaluation | null
  evidence?: ArchiveTitleEvidence
  decision?: ArchiveTitleReviewDecision
}) {
  const titles = evaluation?.evidence ?? evidence
  return (
    <details className="pointer-events-auto mt-2 min-w-0 text-xs">
      <summary className="cursor-pointer leading-6 text-muted-foreground">
        {decision !== 'AUTO' ? (
          <Badge variant="secondary" className="mr-2">
            {decision === 'INCLUDE' ? '手动接纳' : '手动排除'}
          </Badge>
        ) : null}
        {evaluation ? ARCHIVE_TITLE_REASON_LABELS[evaluation.reason] : '历史判断，展开查看标题'}
        {evaluation?.condition ? (
          <PrivacySensitiveText>
            {' '}
            · {ARCHIVE_TITLE_RULE_OPERATORS[evaluation.condition.operator]}「{evaluation.condition.text}」
          </PrivacySensitiveText>
        ) : null}
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
