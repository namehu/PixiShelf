'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type KeyboardCoordinateGetter
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  MoreHorizontal,
  ArrowUpToLine,
  ArrowDownToLine,
  MoveVertical,
  Trash2,
  ImageIcon
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import type { SeriesArtworkRow } from '@/schemas/series-management'
import { moveDraft } from './series-draft'

interface Props {
  rows: SeriesArtworkRow[]
  fullIds: number[]
  selected: Set<number>
  disabled: boolean
  sortingDisabled: boolean
  searchKey?: string
  fill?: boolean
  onSelect: (id: number, selected: boolean) => void
  onOrder: (ids: number[]) => void
  onRemove: (id: number) => void
  onPosition: (id: number) => void
}

export function SeriesArtworkList(props: Props) {
  const { rows, fullIds, sortingDisabled, disabled, onOrder } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [focusId, setFocusId] = useState<number | null>(null)
  const desktop = useMediaQuery('(min-width: 768px)')
  const getItemKey = useCallback((index: number) => rows[index]!.id, [rows])
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 80,
    overscan: 6,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      for (const id of [activeId, focusId]) {
        const index = rows.findIndex((row) => row.id === id)
        if (index >= 0) indices.push(index)
      }
      return [...new Set(indices)].sort((a, b) => a - b)
    }
  })
  const keyboardTarget = useRef<number | null>(null)
  const coordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.code)) return undefined
    event.preventDefault()
    const current = keyboardTarget.current ?? rows.findIndex((row) => row.id === context.active?.id)
    const target = Math.max(0, Math.min(rows.length - 1, current + (event.code === 'ArrowDown' ? 1 : -1)))
    keyboardTarget.current = target
    const before = scrollRef.current?.scrollTop ?? 0
    virtual.scrollToIndex(target, { align: 'auto' })
    // Resolve keyboard moves against the full list, including unmounted destinations.
    return {
      x: currentCoordinates.x,
      y: currentCoordinates.y + (target - current) * 80 - ((scrollRef.current?.scrollTop ?? 0) - before)
    }
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordinates })
  )
  useEffect(() => {
    virtual.scrollToOffset(0)
  }, [props.searchKey, sortingDisabled]) // Search starts at the first matching row.
  const active = rows.find((row) => row.id === activeId)
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => {
        setActiveId(Number(active.id))
        keyboardTarget.current = null
      }}
      onDragCancel={() => {
        setActiveId(null)
        keyboardTarget.current = null
      }}
      onDragEnd={({ active, over }) => {
        const index = keyboardTarget.current ?? rows.findIndex((row) => row.id === over?.id)
        if (!sortingDisabled && !disabled && index >= 0) onOrder(moveDraft(fullIds, Number(active.id), index + 1))
        setActiveId(null)
        keyboardTarget.current = null
      }}
    >
      <div
        ref={scrollRef}
        className={cn(
          props.fill ? 'min-h-0 flex-1' : 'h-[min(62dvh,640px)] min-h-64',
          'overflow-y-auto overscroll-contain'
        )}
        aria-label="系列作品列表"
        tabIndex={-1}
      >
        <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          <div role="list" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]!
              return (
                <div
                  key={row.id}
                  style={{ position: 'absolute', width: '100%', height: 80, transform: `translateY(${item.start}px)` }}
                >
                  <ArtworkRow
                    {...props}
                    row={row}
                    position={fullIds.indexOf(row.id) + 1}
                    size={fullIds.length}
                    canDrag={desktop && !sortingDisabled && !disabled}
                    onFocus={() => setFocusId(row.id)}
                    onBlur={() => setFocusId(null)}
                  />
                </div>
              )
            })}
          </div>
        </SortableContext>
      </div>
      <DragOverlay>
        {active ? (
          <div className="flex h-20 items-center gap-3 rounded-lg border bg-popover px-4 shadow-lg">
            <GripVertical />
            <PrivacySensitiveText className="truncate font-medium">{active.title}</PrivacySensitiveText>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export function Cover({ row }: { row: Pick<SeriesArtworkRow, 'thumbnailUrl' | 'title'> }) {
  return (
    <Avatar className="size-14 rounded-md">
      <AvatarImage src={row.thumbnailUrl || ''} alt={row.title} className="object-cover" />
      <AvatarFallback>
        <ImageIcon className="size-5 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  )
}

function ArtworkRow({
  row,
  position,
  size,
  canDrag,
  onFocus,
  onBlur,
  ...props
}: Props & {
  row: SeriesArtworkRow
  position: number
  size: number
  canDrag: boolean
  onFocus: () => void
  onBlur: () => void
}) {
  const sortable = useSortable({ id: row.id, disabled: !canDrag })
  return (
    <div
      ref={sortable.setNodeRef}
      role="listitem"
      aria-posinset={position}
      aria-setsize={size}
      data-artwork-row={row.id}
      onFocusCapture={onFocus}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur()
      }}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        'flex h-20 items-center gap-2 border-b border-border/60 px-3 transition-colors sm:gap-3',
        props.selected.has(row.id) ? 'bg-accent' : 'bg-background hover:bg-surface-muted',
        sortable.isDragging && 'opacity-30'
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        disabled={!canDrag}
        className="hidden touch-none md:inline-flex"
        aria-label={`拖动 ${row.title} 调整顺序`}
      >
        <GripVertical aria-hidden="true" />
      </Button>
      <Checkbox
        checked={props.selected.has(row.id)}
        disabled={props.disabled}
        onCheckedChange={(value) => props.onSelect(row.id, value === true)}
        aria-label={`选择 ${row.title}`}
      />
      <span className="font-utility w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {position}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <PrivacySensitiveText className="truncate text-sm font-medium">
          <Link href={`/artworks/${row.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {row.title}
          </Link>
        </PrivacySensitiveText>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <PrivacySensitiveText className="truncate">{row.author || '未标注作者'}</PrivacySensitiveText>
          <span className="shrink-0">
            {row.mediaCount} 张 · #{row.id}
          </span>
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 lg:flex">
        <Badge variant={row.provenance === 'SOURCE' ? 'secondary' : 'outline'}>
          {row.provenance === 'SOURCE' ? 'Pixiv 来源' : row.provenance === 'MANUAL' ? '手工添加' : '历史关系'}
        </Badge>
        {row.orderOverridden ? <Badge variant="outline">本地排序</Badge> : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={props.disabled} aria-label={`${row.title} 的操作`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={props.sortingDisabled} onSelect={() => props.onPosition(row.id)}>
              <MoveVertical />
              移动到第 N 位
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={props.sortingDisabled || position === 1}
              onSelect={() => props.onOrder(moveDraft(props.fullIds, row.id, 1))}
            >
              <ArrowUpToLine />
              置顶
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={props.sortingDisabled || position === size}
              onSelect={() => props.onOrder(moveDraft(props.fullIds, row.id, size))}
            >
              <ArrowDownToLine />
              置底
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onRemove(row.id)}>
              <Trash2 />
              从系列移除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
