'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRightIcon, ArrowDownWideNarrowIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
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
  const creator = creators.find((item) => String(item.id) === selected) ?? creators[0]
  if (!creator) return null
  return (
    <section aria-labelledby="related-artworks-heading" className="my-8 border-t border-border py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 id="related-artworks-heading" className="text-lg font-semibold text-foreground">
            创作者的其他作品
          </h2>
          {creators.length > 1 ? (
            <Select value={String(creator.id)} onValueChange={setSelected}>
              <SelectTrigger aria-label="切换创作者" size="sm" className="max-w-full sm:max-w-64">
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
          ) : (
            <PrivacySensitiveText className="min-w-0 truncate text-sm text-muted-foreground">
              {creator.kind === 'GROUP' ? '社团：' : ''}
              {creator.name}
            </PrivacySensitiveText>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`作品排序：${dateMode === 'source' ? '来源发布时间' : '入库时间'}`}
              >
                <ArrowDownWideNarrowIcon data-icon="inline-start" aria-hidden="true" />
                {dateMode === 'source' ? '排序' : '按入库时间'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>作品排序</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={dateMode}
                  onValueChange={(value) => {
                    if (value === 'source' || value === 'created') setDateMode(value)
                  }}
                >
                  <DropdownMenuRadioItem value="source">来源发布时间</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="created">入库时间</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
                {dateMode === 'source'
                  ? '按原站发布时间排列，日期未知时使用入库时间。画廊作品采用画廊发布时间。'
                  : '按作品加入 PixiShelf 的时间排列。'}
                左侧较新，右侧较旧。
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/artists/${creator.id}`}>
              查看全部
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      <RelatedArtworks
        key={creator.id + ':' + dateMode}
        artistId={creator.id}
        currentArtworkId={artworkId}
        dateMode={dateMode}
      />
    </section>
  )
}
