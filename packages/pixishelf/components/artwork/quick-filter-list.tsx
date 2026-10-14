'use client'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Pencil, Pin, PinOff, Trash2, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { describeSnapshot } from '@/lib/artwork-query-snapshot'
import type { ArtworkQuickFilter } from '@/schemas/artwork-quick-filter.dto'

type Props = {
  items: ArtworkQuickFilter[]
  ids: string[]
  busy: boolean
  onApply: (item: ArtworkQuickFilter) => void
  onEdit: (item: ArtworkQuickFilter, rename?: boolean) => void
  onDelete: (item: ArtworkQuickFilter) => void
  onOrder: (ids: string[]) => void
}
function Row({ item, pinned, index, ...props }: Props & { item: ArtworkQuickFilter; pinned: boolean; index: number }) {
  const sortable = useSortable({ id: item.id, disabled: !pinned || props.busy })
  const invalid = !!item.invalidReferences?.length
  const move = (delta: number) => props.onOrder(arrayMove(props.ids, index, index + delta))
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="flex items-center gap-1 border-b border-border bg-background py-1"
    >
      {pinned && (
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 shrink-0 touch-none"
          aria-label={`拖动排序：${item.name}`}
          disabled={props.busy}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical />
        </Button>
      )}
      <button
        type="button"
        disabled={props.busy || invalid}
        onClick={() => props.onApply(item)}
        className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 rounded-md px-2 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <PrivacySensitiveText className="w-full truncate text-sm font-medium">{item.name}</PrivacySensitiveText>
        <PrivacySensitiveText className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {describeSnapshot(item.query)}
        </PrivacySensitiveText>
        {invalid && <span className="text-xs text-destructive">条件已失效，请编辑修正</span>}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 shrink-0"
            disabled={props.busy}
            aria-label={`管理：${item.name}`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => props.onEdit(item)}>
              <Pencil />
              编辑条件
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onEdit(item, true)}>
              <Type />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!pinned && props.ids.length >= 10}
              onSelect={() =>
                props.onOrder(pinned ? props.ids.filter((id) => id !== item.id) : [...props.ids, item.id])
              }
            >
              {pinned ? <PinOff /> : <Pin />}
              {pinned ? '移出导航' : props.ids.length >= 10 ? '导航已满（10/10）' : '加入导航'}
            </DropdownMenuItem>
            {pinned && (
              <>
                <DropdownMenuItem disabled={index === 0} onSelect={() => move(-1)}>
                  <ArrowUp />
                  上移
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === props.ids.length - 1} onSelect={() => move(1)}>
                  <ArrowDown />
                  下移
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(item)}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
export function QuickFilterList(props: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const pinned = props.ids.flatMap((id) => props.items.filter((item) => item.id === id))
  const others = props.items.filter((item) => !props.ids.includes(item.id))
  if (!props.items.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>保存常用的浏览方式</EmptyTitle>
          <EmptyDescription>在筛选条件中组合标签、阅读状态和排序，再保存为快捷筛选。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="pb-4">
      <h3 className="pb-2 pt-1 text-sm font-medium">
        导航中 <span className="text-muted-foreground">· {pinned.length}/10</span>
      </h3>
      {!pinned.length && (
        <p className="py-3 text-sm text-muted-foreground">从下方菜单选择「加入导航」，即可快速访问。</p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id && !props.busy) {
            props.onOrder(
              arrayMove(props.ids, props.ids.indexOf(String(active.id)), props.ids.indexOf(String(over.id)))
            )
          }
        }}
      >
        <SortableContext items={props.ids} strategy={verticalListSortingStrategy}>
          {pinned.map((item, index) => (
            <Row key={item.id} {...props} item={item} pinned index={index} />
          ))}
        </SortableContext>
      </DndContext>
      {others.length > 0 && (
        <>
          <h3 className="pb-2 pt-7 text-sm font-medium">
            其他快捷筛选 <span className="text-muted-foreground">· {others.length}</span>
          </h3>
          {others.map((item) => (
            <Row key={item.id} {...props} item={item} pinned={false} index={-1} />
          ))}
        </>
      )}
    </div>
  )
}
