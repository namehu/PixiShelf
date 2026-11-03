import { formatFileSize } from '@/utils/media'

export function ArtworkMediaSummary({
  count,
  totalBytes,
  unknownSizeCount = 0
}: {
  count: number
  totalBytes: number
  unknownSizeCount?: number
}) {
  return (
    <div aria-label="作品媒体信息" className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm leading-6 text-muted-foreground">
      <span className="whitespace-nowrap"><span className="font-utility font-medium text-foreground tabular-nums">{count.toLocaleString()}</span> 项</span>
      <span className="whitespace-nowrap">
        {unknownSizeCount > 0 ? '已知原文件' : '原文件'}{' '}
        <span className="font-utility font-medium text-foreground tabular-nums">{formatFileSize(totalBytes)}</span>
      </span>
      {count > 0 && (
        <span className="whitespace-nowrap">
          {count < 60 ? '预计阅读不到 1 分钟' : <>预计阅读约 <span className="font-utility font-medium text-foreground tabular-nums">{Math.ceil(count / 60).toLocaleString()}</span> 分钟</>}
        </span>
      )}
      {unknownSizeCount > 0 && <span className="w-full text-xs">另有 {unknownSizeCount.toLocaleString()} 个文件大小未知</span>}
    </div>
  )
}
