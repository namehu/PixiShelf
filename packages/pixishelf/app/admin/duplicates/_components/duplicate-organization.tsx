import type { ArtworkDedupMemberDto } from '@pixishelf/job-contracts'

export function DuplicateOrganization({ member }: { member: ArtworkDedupMemberDto }) {
  const { ownOrganization: own, ownReading: reading } = member
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <dt>我的评分</dt>
      <dd>{own.rating ? `${own.rating} 分` : '未评分'}</dd>
      <dt>我的书签</dt>
      <dd>
        {own.bookmarks.available} 个
        {own.bookmarks.unavailable > 0 ? `，另有 ${own.bookmarks.unavailable} 个失效记录` : ''}
      </dd>
      <dt>我的单图喜欢</dt>
      <dd>
        {own.likes.available} 个{own.likes.unavailable > 0 ? `，另有 ${own.likes.unavailable} 个失效记录` : ''}
      </dd>
      <dt>我的阅读</dt>
      <dd>
        {reading ? `已看 ${reading.seenCount} / ${reading.totalCount}` : '未阅读'}
        {reading?.lastViewedAt ? ` · ${new Date(reading.lastViewedAt).toLocaleDateString('zh-CN')}` : ''}
      </dd>
    </dl>
  )
}
