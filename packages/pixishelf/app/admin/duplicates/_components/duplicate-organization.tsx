import type { ArtworkDedupMemberDto } from '@pixishelf/job-contracts'

export function DuplicateOrganization({ member }: { member: ArtworkDedupMemberDto }) {
  const { ownOrganization: own, ownReading: reading } = member
  const notes = [
    own.rating ? `评分 ${own.rating}` : null,
    own.bookmarks.available > 0 ? `${own.bookmarks.available} 个书签` : null,
    own.bookmarks.unavailable > 0 ? `${own.bookmarks.unavailable} 个失效书签` : null,
    own.likes.available > 0 ? `喜欢 ${own.likes.available} 张图` : null,
    own.likes.unavailable > 0 ? `${own.likes.unavailable} 个失效喜欢` : null,
    reading ? `已看 ${reading.seenCount} / ${reading.totalCount}` : null
  ].filter(Boolean)
  return (
    <p className="text-xs leading-6 text-muted-foreground">
      {notes.length ? notes.join(' · ') : '暂无评分、收藏或阅读记录'}
    </p>
  )
}
