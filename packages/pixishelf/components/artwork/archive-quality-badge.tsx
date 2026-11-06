import { Badge } from '@/components/ui/badge'
import type { ArchiveQualitySummary } from '@pixishelf/job-contracts'

export function ArchiveQualityBadge({
  quality,
  compact = false
}: {
  quality: ArchiveQualitySummary
  compact?: boolean
}) {
  const label = !quality.verifiedAt
    ? '尚未识别图片版本'
    : {
        ORIGINAL: compact ? '原图' : '已存原图',
        DISPLAY: compact ? '网页阅读版' : '已存网页阅读版',
        MIXED: '含原图和网页阅读版',
        UNKNOWN: quality.originalCount + quality.displayCount > 0 ? '部分版本无法确认' : '版本无法确认'
      }[quality.status]
  return (
    <Badge
      variant={compact ? 'muted' : 'outline'}
      title={
        compact
          ? undefined
          : quality.verifiedAt
            ? `原图 ${quality.originalCount} 张 · 网页阅读版 ${quality.displayCount} 张 · 无法确认是否为原图 ${quality.unknownCount} 张`
            : '现有记录无法确认已保存的图片是否为原图'
      }
    >
      {label}
    </Badge>
  )
}
