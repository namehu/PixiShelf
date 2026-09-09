'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import RelatedArtworks from './related-artworks'

export default function CreatorTimeline({
  creators,
  artworkId
}: {
  creators: Array<{ id: number; name: string; kind?: string }>
  artworkId: number
}) {
  const [selected, setSelected] = useState(String(creators[0]?.id ?? ''))
  const [dateMode, setDateMode] = useState<'source' | 'created'>('source')
  if (!creators.length) return null
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger aria-label="时间线艺术家或社团" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {creators.map((creator) => (
                <SelectItem key={creator.id} value={String(creator.id)}>
                  <PrivacySensitiveText>
                    {creator.kind === 'GROUP' ? '社团：' : '艺术家：'}
                    {creator.name}
                  </PrivacySensitiveText>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={dateMode} onValueChange={(value) => setDateMode(value as 'source' | 'created')}>
          <SelectTrigger aria-label="时间线排序" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="source">来源发布时间</SelectItem>
              <SelectItem value="created">入库时间</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">归档使用画廊发布时间；来源日期未知时采用入库时间。</p>
      <RelatedArtworks
        key={selected + ':' + dateMode}
        artistId={Number(selected)}
        currentArtworkId={artworkId}
        dateMode={dateMode}
      />
    </section>
  )
}
