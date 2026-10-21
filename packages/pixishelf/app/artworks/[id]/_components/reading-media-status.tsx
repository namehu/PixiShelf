'use client'

import { Button } from '@/components/ui/button'
import type { ReadingMediaItem } from '@pixishelf/db/reading-contract'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'

const mediaMaps = new WeakMap<ReadingMediaItem[], Map<number, ReadingMediaItem>>()

export function readingMediaPosition(reading: ArtworkReadingHandle | undefined, mediaId: number) {
  const media = reading?.context?.media
  if (!media) return undefined
  let byId = mediaMaps.get(media)
  if (!byId) {
    byId = new Map(media.flatMap((item) => item.memberMediaIds.map((id) => [id, item] as const)))
    mediaMaps.set(media, byId)
  }
  return byId.get(mediaId)
}

export function ReadingMediaStatus({ reading, mediaId, loadFailed = false }: { reading?: ArtworkReadingHandle; mediaId: number; loadFailed?: boolean }) {
  const item = readingMediaPosition(reading, mediaId)
  if (!reading?.context || !item) return <div className="flex min-h-10 items-center px-3 text-xs text-muted-foreground" aria-busy="true">正在加载阅读状态…</div>
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
