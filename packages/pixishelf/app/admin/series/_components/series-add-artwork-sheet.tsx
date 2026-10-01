'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useDebounce } from '@/hooks/use-debounce'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PageState } from '@/components/layout/page-state'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import type { SeriesArtworkRow } from '@/schemas/series-management'

export function SeriesAddArtworkSheet({
  open,
  onOpenChange,
  existingIds,
  onAdd
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingIds: number[]
  onAdd: (rows: SeriesArtworkRow[]) => void
}) {
  const trpc = useTRPC()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creators, setCreators] = useState<CreatorOption[]>([])
  const [selected, setSelected] = useState<Map<number, SeriesArtworkRow>>(new Map())
  const debounced = useDebounce(search, 300)
  const query = useQuery(
    trpc.artwork.list.queryOptions(
      { search: debounced, cursor: page, pageSize: 25, artistId: creators[0]?.id },
      { enabled: open }
    )
  )
  useEffect(() => {
    if (open) {
      setSelected(new Map())
      setPage(1)
    }
  }, [open])
  const existing = new Set(existingIds)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>添加作品</SheetTitle>
          <SheetDescription>选择作品加入整理草稿，保存更改后生效。</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4">
          <Input
            aria-label="搜索要添加的作品"
            placeholder="搜索作品标题…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          <CreatorPicker
            value={creators}
            maxSelected={1}
            onChange={(value) => {
              setCreators(value)
              setPage(1)
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {query.isLoading ? (
            <PageState variant="loading" title="正在查找作品" compact />
          ) : query.isError ? (
            <PageState variant="error" title="作品加载失败" compact />
          ) : !query.data?.items.length ? (
            <PageState variant="empty" title="未找到作品" compact />
          ) : (
            <div className="flex flex-col gap-1">
              {query.data.items.map((item) => {
                const first = item.images?.[0]
                const row: SeriesArtworkRow = {
                  id: item.id,
                  title: item.title,
                  thumbnailUrl: first?.mediaType === 'video' ? null : first?.path || null,
                  author: item.artist?.name || '',
                  mediaCount: item.imageCount,
                  sortOrder: 0,
                  provenance: 'MANUAL',
                  orderOverridden: false
                }
                const added = existing.has(item.id)
                return (
                  <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted">
                    <Checkbox
                      aria-label={`添加 ${item.title}`}
                      disabled={added}
                      checked={added || selected.has(item.id)}
                      onCheckedChange={(checked) =>
                        setSelected((previous) => {
                          const next = new Map(previous)
                          if (checked) next.set(item.id, row)
                          else next.delete(item.id)
                          return next
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <PrivacySensitiveText className="block truncate text-sm font-medium">
                        {item.title}
                      </PrivacySensitiveText>
                      <PrivacySensitiveText className="block truncate text-xs text-muted-foreground">
                        {row.author || '未标注作者'}
                      </PrivacySensitiveText>
                    </div>
                    {added ? <Check className="size-4 text-muted-foreground" aria-label="已在草稿中" /> : null}
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1 || query.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft data-icon="inline-start" />
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">第 {page} 页</span>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching || (query.data?.items.length ?? 0) < 25}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
        <SheetFooter>
          <Button
            disabled={!selected.size}
            onClick={() => {
              onAdd([...selected.values()])
              onOpenChange(false)
            }}
          >
            加入草稿{selected.size ? ` · ${selected.size} 件` : ''}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
