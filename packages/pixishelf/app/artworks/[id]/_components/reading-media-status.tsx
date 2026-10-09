'use client'

import { Button } from '@/components/ui/button'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'

export function readingMediaPosition(reading: ArtworkReadingHandle | undefined, mediaId: number) {
  return reading?.context?.media.find((item) => item.memberMediaIds.includes(mediaId))
}

export function ReadingMediaStatus({ reading, mediaId, loadFailed = false }: { reading?: ArtworkReadingHandle; mediaId: number; loadFailed?: boolean }) {
  const item = readingMediaPosition(reading, mediaId)
  if (!reading?.context || !item) return null
  const seen = reading.context.seenMediaIds.includes(item.mediaId)
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 text-xs">
      <span className="tabular-nums text-muted-foreground">第 {item.index + 1} 张</span>
      {loadFailed && !seen && (
        <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={reading.marking || reading.invalidated}
          aria-label={`标记第 ${item.index + 1} 张已读`}
          onClick={() => void reading.markRead({ kind: 'MEDIA', mediaId: item.mediaId })}>
          标记已读
        </Button>
      )}
    </div>
  )
}
