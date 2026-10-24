'use client'

import Link from 'next/link'
import { ChevronDown, ExternalLink, Plus } from 'lucide-react'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { archiveDiscoverySourceHref, archiveTitleSearchHref } from '@/lib/archive-source-links'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type Source = ArtistResponseDto['discoverySources'][number]

function SourceLink({ source }: { source: Source }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Link
        href={archiveDiscoverySourceHref(source.id)}
        className="min-w-0 max-w-56 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-ring focus-visible:outline-2"
      >
        <PrivacySensitiveText className="block truncate">{source.displayName}</PrivacySensitiveText>
      </Link>
      <Badge variant="outline">{source.sourceKind === 'TITLE_QUERY' ? '关键词' : '上传者'}</Badge>
      {source.status === 'ARCHIVED' ? <Badge variant="secondary">已停用</Badge> : null}
    </div>
  )
}

export function ArtistDiscoverySources({ sources, onCreate }: { sources: Source[]; onCreate: () => void }) {
  if (!sources.length) {
    return (
      <Button variant="ghost" size="sm" onClick={onCreate} aria-label="未关联归档来源，创建关键词来源">
        未关联
      </Button>
    )
  }
  if (sources.length === 1) return <SourceLink source={sources[0]!} />
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          已关联 {sources.length} 个<ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>归档来源</PopoverTitle>
        </PopoverHeader>
        <ul className="mt-3 grid max-h-72 gap-3 overflow-y-auto" aria-label="已关联归档来源">
          {sources.map((source) => (
            <li key={source.id}>
              <SourceLink source={source} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function ArtistDiscoveryActions({ name, onCreate }: { name: string; onCreate: () => void }) {
  const href = archiveTitleSearchHref({ keyword: name })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="归档来源操作">
          归档来源
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {href ? (
            <DropdownMenuItem asChild>
              <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                <ExternalLink />在 E-Hentai 搜索
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <ExternalLink />在 E-Hentai 搜索
            </DropdownMenuItem>
          )}
          {!href ? (
            <DropdownMenuLabel className="max-w-60 whitespace-normal">
              名称包含不支持的搜索字符，请在创建表单中修改关键词。
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuItem onSelect={onCreate}>
            <Plus />
            创建关键词来源
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
