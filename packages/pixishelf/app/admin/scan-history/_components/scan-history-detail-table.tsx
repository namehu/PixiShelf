'use client'

import Link from 'next/link'
import { ExternalLink, Loader2, SearchX } from 'lucide-react'
import { TableVirtuoso, Virtuoso } from 'react-virtuoso'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { formatAction, formatMediaCount, ItemStatusBadge, ScanRunItemStatus } from './scan-history-format'

interface ScanHistoryDetailItem {
  id: string
  resultArtworkId: number | null
  status: string
  action: string
  inventoryDecision: string | null
  title: string | null
  externalId: string | null
  artistName: string | null
  relativeDirectory: string | null
  metadataRelativePath: string | null
  mediaCount: number
  errorMessage: string | null
}

export function ScanHistoryDetailTable({ items, isFetching }: { items: ScanHistoryDetailItem[]; isFetching: boolean }) {
  const isDesktop = useMediaQuery('(min-width: 640px)')

  if (isFetching && items.length === 0) {
    return (
      <div
        className="flex min-h-72 items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        正在加载明细…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
        <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">没有匹配的作品记录</p>
        <p className="mt-1 text-sm text-muted-foreground">尝试选择其他处理状态。</p>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card" aria-busy={isFetching}>
      {isDesktop ? (
        <TableVirtuoso
          className="h-[clamp(18rem,calc(100vh-26rem),42rem)] min-h-72 overscroll-contain [scrollbar-gutter:stable]"
          data={items}
          defaultItemHeight={68}
          overscan={320}
          computeItemKey={(_, item) => item.id}
          components={{
            Table: ({ children, ...props }) => (
              <table {...props} className="w-full min-w-[860px] table-fixed text-sm">
                <ScanHistoryDetailColGroup />
                {children}
              </table>
            ),
            TableRow: (props) => <tr {...props} className="border-b transition-colors hover:bg-muted/35" />
          }}
          fixedHeaderContent={() => (
            <tr className="border-b bg-muted/95 text-xs text-muted-foreground backdrop-blur-sm">
              <th scope="col" className="w-24 px-3 py-2.5 text-left font-medium">
                状态
              </th>
              <th scope="col" className="w-32 px-3 py-2.5 text-left font-medium">
                动作
              </th>
              <th scope="col" className="w-72 px-3 py-2.5 text-left font-medium">
                作品
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">
                路径
              </th>
              <th scope="col" className="w-28 px-3 py-2.5 text-right font-medium">
                本次媒体
              </th>
            </tr>
          )}
          itemContent={(_, item) => (
            <>
              <td className="w-24 px-3 py-3 align-top">
                <ItemStatusBadge status={item.status as ScanRunItemStatus} />
              </td>
              <td className="w-32 px-3 py-3 align-top text-muted-foreground">
                {formatAction(item.action, item.inventoryDecision)}
              </td>
              <td className="w-72 min-w-0 whitespace-normal px-3 py-3 align-top">
                <ArtworkDetailLink item={item} />
                <div
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={item.artistName || item.externalId || undefined}
                >
                  {item.artistName || item.externalId || '—'}
                </div>
                {item.errorMessage ? (
                  <div className="mt-1 break-words text-xs text-destructive">{item.errorMessage}</div>
                ) : null}
              </td>
              <td className="min-w-0 whitespace-normal px-3 py-3 align-top text-xs text-muted-foreground">
                <div className="truncate" title={item.relativeDirectory || undefined}>
                  {item.relativeDirectory || '—'}
                </div>
                <div className="mt-1 truncate" title={item.metadataRelativePath || undefined}>
                  {item.metadataRelativePath || '—'}
                </div>
              </td>
              <td className="w-28 px-3 py-3 text-right align-top font-medium tabular-nums">
                {formatMediaCount(item.mediaCount, item.inventoryDecision)}
              </td>
            </>
          )}
        />
      ) : (
        <Virtuoso
          className="h-[clamp(22rem,calc(100vh-24rem),42rem)] min-h-88 overscroll-contain [scrollbar-gutter:stable]"
          data={items}
          defaultItemHeight={142}
          overscan={280}
          computeItemKey={(_, item) => item.id}
          itemContent={(_, item) => (
            <article className="border-b px-3 py-3.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <ItemStatusBadge status={item.status as ScanRunItemStatus} />
                <span className="text-xs text-muted-foreground">
                  {formatAction(item.action, item.inventoryDecision)}
                </span>
                <span className="ml-auto text-xs font-medium tabular-nums text-foreground">
                  本次媒体 {formatMediaCount(item.mediaCount, item.inventoryDecision)}
                </span>
              </div>
              <h3 className="mt-2 min-w-0 text-sm font-medium text-foreground">
                <ArtworkDetailLink item={item} />
              </h3>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={item.artistName || undefined}>
                {item.artistName || item.externalId || '—'}
              </p>
              <p
                className="mt-2 line-clamp-2 break-all text-xs leading-5 text-muted-foreground"
                title={item.relativeDirectory || item.metadataRelativePath || undefined}
              >
                {item.relativeDirectory || item.metadataRelativePath || '未记录路径'}
              </p>
              {item.errorMessage ? (
                <p className="mt-2 break-words text-xs leading-5 text-destructive">{item.errorMessage}</p>
              ) : null}
            </article>
          )}
        />
      )}
      {isFetching ? (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          正在更新…
        </div>
      ) : null}
    </div>
  )
}

function ScanHistoryDetailColGroup() {
  return (
    <colgroup>
      <col className="w-24" />
      <col className="w-32" />
      <col className="w-72" />
      <col />
      <col className="w-28" />
    </colgroup>
  )
}

function ArtworkDetailLink({ item, className }: { item: ScanHistoryDetailItem; className?: string }) {
  const label = item.title || item.externalId || '未命名作品'
  const title = item.artistName ? `${label} - ${item.artistName}` : label

  if (!item.resultArtworkId) {
    return (
      <span className={cn('block min-w-0 truncate font-medium text-foreground', className)} title={title}>
        {label}
      </span>
    )
  }

  return (
    <Link
      href={`/artworks/${item.resultArtworkId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      title={title}
      aria-label={`在新标签页打开作品 ${label}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </Link>
  )
}
