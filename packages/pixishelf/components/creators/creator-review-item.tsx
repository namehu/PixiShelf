import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { CreatorReviewSummary } from '@/lib/creator-review-summary'

export function CreatorReviewItem({
  title,
  artworkId,
  command,
  status,
  planStatus,
  review,
  reason
}: {
  title: string
  artworkId: number | null
  command: string
  status: string
  planStatus: string
  review: CreatorReviewSummary
  reason: string
}) {
  const waiting = status === 'PENDING' && ['PREPARING', 'READY'].includes(planStatus)
  const statusLabel = waiting
    ? '等待你确认'
    : status === 'PENDING'
      ? '等待保存'
      : status === 'SUCCESS'
        ? '已处理'
        : status === 'STALE'
          ? '信息已变，未修改'
          : status === 'UNKNOWN'
            ? '缺少作者信息，未修改'
            : '请查看处理结果'
  const message = reason
    .replace('映射或关联已变化，请重新预览', '作者对应的作品已改变，请重新检查后再保存。')
    .replace('作品、来源依据或人工整理已变化', '检查后作品信息发生了变化，请重新检查。')
    .replace('缺少可验证作者标签，请人工整理', '请打开作品，手动填写作者。')
  const arrow = command === 'BACKFILL' || command === 'REMAP'
  return (
    <article className="flex flex-col gap-4 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PrivacySensitiveText as="h3" className="min-w-0 flex-1 break-words font-medium">
          {title}
        </PrivacySensitiveText>
        <Badge variant="outline">{statusLabel}</Badge>
      </div>
      <PrivacySensitiveText as="div" className="flex flex-col gap-2">
        {arrow ? (
          <p className="break-words text-base">
            <span className="text-muted-foreground">{review.label}：</span>
            <span>{review.before}</span>
            {review.after && (
              <>
                <span className="mx-2" aria-label="改为">
                  →
                </span>
                <strong>{review.after}</strong>
              </>
            )}
          </p>
        ) : (
          <>
            {review.before && <p className="text-sm text-muted-foreground">当前作者／社团：{review.before}</p>}
            <p className="break-words text-base">
              {review.label}：<strong>{review.after ?? '请重新检查'}</strong>
            </p>
          </>
        )}
        <p className="text-sm text-muted-foreground">根据：{review.basis}</p>
        {review.note && <p className="text-sm text-muted-foreground">{review.note}</p>}
        {message && <p className="text-sm">{message}</p>}
      </PrivacySensitiveText>
      {!!artworkId && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={'/artworks/' + artworkId} target="_blank" rel="noopener noreferrer">
            打开作品核对（新标签页）
          </Link>
        </Button>
      )}
    </article>
  )
}
