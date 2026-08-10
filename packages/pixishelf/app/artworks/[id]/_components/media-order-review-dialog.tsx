'use client'

// oxlint-disable max-lines
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  List,
  ListRestart,
  Loader2,
  Redo2,
  Replace,
  RotateCcw,
  Save,
  Shuffle,
  Undo2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useTRPCClient } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import MediaThumbnail from '@/components/media/media-thumbnail'
import {
  countNaturalOrderMismatches,
  getNaturalOrderRanks,
  haveSameMediaOrder,
  moveMediaItem,
  sortMediaNaturally,
  swapMediaItems
} from './media-order-utils'

const MEDIA_ORDER_HISTORY_KEY = '__pixishelf_media_order_review__'
const MAX_HISTORY_ENTRIES = 50

interface MediaOrderReviewDialogProps {
  artworkId: number
  images: ArtworkImageResponseDto[]
  onClose: () => void
  onSaved?: (images: ArtworkImageResponseDto[]) => void
}

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {}
}

function createHistoryToken() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function getFileName(mediaPath: string) {
  return mediaPath.replace(/\\/g, '/').split('/').pop() || mediaPath
}

function isVideoMedia(media: ArtworkImageResponseDto) {
  return media.mediaType === 'video' || isVideoFile(media.path)
}

function isAnimatedMedia(media: ArtworkImageResponseDto) {
  return Boolean(media.isAnimated) || isApngFile(media.path) || isGifFile(media.path) || isWebpFile(media.path)
}

function getMediaLabel(media: ArtworkImageResponseDto) {
  if (isVideoMedia(media)) return '视频'
  if (isAnimatedMedia(media)) return '动图'
  return '图片'
}

function normalizeSortOrders(images: ArtworkImageResponseDto[]) {
  return images.map((image, sortOrder) => ({ ...image, sortOrder }))
}

function idsOf(images: ArtworkImageResponseDto[]) {
  return images.map((image) => image.id)
}

export default function MediaOrderReviewDialog({
  artworkId,
  images,
  onClose,
  onSaved
}: MediaOrderReviewDialogProps) {
  const router = useRouter()
  const trpcClient = useTRPCClient()
  const mediaById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images])
  const [baseline, setBaseline] = useState(() => normalizeSortOrders(images))
  const [draft, setDraft] = useState(() => normalizeSortOrders(images))
  const [past, setPast] = useState<number[][]>([])
  const [future, setFuture] = useState<number[][]>([])
  const [selectedId, setSelectedId] = useState(images[0]?.id ?? null)
  const [activeDragId, setActiveDragId] = useState<number | null>(null)
  const [collectionView, setCollectionView] = useState<'contact' | 'names'>('contact')
  const [mobilePanel, setMobilePanel] = useState<'collection' | 'compare'>('collection')
  const [targetPosition, setTargetPosition] = useState('1')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const openRef = useRef(true)
  const closePendingRef = useRef(false)
  const historyTokenRef = useRef(createHistoryToken())
  const dirtyRef = useRef(false)
  const onCloseRef = useRef(onClose)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const dirty = !haveSameMediaOrder(draft, baseline)
  dirtyRef.current = dirty
  onCloseRef.current = onClose

  const hydrateOrder = useCallback(
    (imageIds: number[]) => imageIds.map((id) => mediaById.get(id)).filter(Boolean) as ArtworkImageResponseDto[],
    [mediaById]
  )

  const applyDraft = useCallback(
    (nextImages: ArtworkImageResponseDto[]) => {
      if (haveSameMediaOrder(nextImages, draft)) return
      setPast((current) => [...current.slice(-(MAX_HISTORY_ENTRIES - 1)), idsOf(draft)])
      setFuture([])
      setDraft(normalizeSortOrders(nextImages))
    },
    [draft]
  )

  const finishClose = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    closePendingRef.current = false
    onCloseRef.current()
  }, [])

  const isCurrentHistoryEntry = useCallback((state: unknown = history.state) => {
    return asHistoryRecord(state)[MEDIA_ORDER_HISTORY_KEY] === historyTokenRef.current
  }, [])

  const consumeHistoryAndClose = useCallback(() => {
    if (!openRef.current || closePendingRef.current) return
    if (typeof window !== 'undefined' && isCurrentHistoryEntry()) {
      closePendingRef.current = true
      history.back()
      return
    }
    finishClose()
  }, [finishClose, isCurrentHistoryEntry])

  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setDiscardOpen(true)
      return
    }
    consumeHistoryAndClose()
  }, [consumeHistoryAndClose])

  useEffect(() => {
    history.pushState(
      {
        ...asHistoryRecord(history.state),
        [MEDIA_ORDER_HISTORY_KEY]: historyTokenRef.current
      },
      '',
      window.location.href
    )

    const handlePopState = (event: PopStateEvent) => {
      if (!openRef.current) return
      if (closePendingRef.current) {
        finishClose()
        return
      }
      if (isCurrentHistoryEntry(event.state)) return

      if (dirtyRef.current) {
        history.pushState(
          {
            ...asHistoryRecord(history.state),
            [MEDIA_ORDER_HISTORY_KEY]: historyTokenRef.current
          },
          '',
          window.location.href
        )
        setDiscardOpen(true)
        return
      }

      finishClose()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [finishClose, isCurrentHistoryEntry])

  const naturalRanks = useMemo(() => getNaturalOrderRanks(draft), [draft])
  const mismatchCount = useMemo(() => countNaturalOrderMismatches(draft), [draft])
  const selectedIndex = Math.max(
    0,
    selectedId === null ? 0 : draft.findIndex((image) => image.id === selectedId)
  )
  const pairStartIndex = Math.min(selectedIndex, Math.max(0, draft.length - 2))
  const selectedMedia = draft[selectedIndex]

  useEffect(() => {
    setTargetPosition(String(selectedIndex + 1))
  }, [selectedIndex])

  const handleUndo = () => {
    const previousIds = past[past.length - 1]
    if (!previousIds) return
    setPast((current) => current.slice(0, -1))
    setFuture((current) => [idsOf(draft), ...current].slice(0, MAX_HISTORY_ENTRIES))
    setDraft(normalizeSortOrders(hydrateOrder(previousIds)))
  }

  const handleRedo = () => {
    const nextIds = future[0]
    if (!nextIds) return
    setFuture((current) => current.slice(1))
    setPast((current) => [...current.slice(-(MAX_HISTORY_ENTRIES - 1)), idsOf(draft)])
    setDraft(normalizeSortOrders(hydrateOrder(nextIds)))
  }

  const moveSelectedTo = (targetIndex: number) => {
    if (!selectedMedia) return
    applyDraft(moveMediaItem(draft, selectedIndex, targetIndex))
  }

  const moveSelectedToPosition = () => {
    const position = Number(targetPosition)
    if (!Number.isInteger(position) || position < 1 || position > draft.length) {
      toast.error(`请输入 1–${draft.length} 之间的序号`)
      return
    }
    moveSelectedTo(position - 1)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const id = Number(event.active.id)
    setActiveDragId(id)
    setSelectedId(id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over || event.active.id === event.over.id) return
    const fromIndex = draft.findIndex((image) => image.id === Number(event.active.id))
    const toIndex = draft.findIndex((image) => image.id === Number(event.over!.id))
    applyDraft(moveMediaItem(draft, fromIndex, toIndex))
  }

  const handleSave = async () => {
    if (!dirty || isSaving) return
    setIsSaving(true)
    try {
      await trpcClient.artwork.reorderImages.mutate({
        artworkId,
        imageIds: idsOf(draft),
        expectedImageIds: idsOf(baseline)
      })
      const savedImages = normalizeSortOrders(draft)
      setBaseline(savedImages)
      setDraft(savedImages)
      setPast([])
      setFuture([])
      onSaved?.(savedImages)
      router.refresh()
      toast.success('媒体顺序已保存')
    } catch (error: any) {
      if (error?.data?.code === 'CONFLICT' || String(error?.message || '').includes('order has changed')) {
        toast.error('保存失败：媒体顺序已在其他页面变化，请刷新后重试')
      } else {
        toast.error(`保存顺序失败：${error?.message || '未知错误'}`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const activeDragMedia = activeDragId === null ? null : draft.find((image) => image.id === activeDragId)

  return (
    <>
      <Dialog open onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
        <DialogContent
          showCloseButton={false}
          className="fixed inset-0 left-0 top-0 z-[100] flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-neutral-950 p-0 text-white shadow-none sm:max-w-none"
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">作品媒体顺序校对台</DialogTitle>
          <DialogDescription className="sr-only">通过缩略图、名称列表或相邻媒体对比检查并调整作品媒体顺序。</DialogDescription>

          <header className="shrink-0 border-b border-white/10 bg-neutral-950/95 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl sm:px-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold sm:text-lg">顺序校对</h2>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                  <span>{draft.length} 个媒体</span>
                  <span aria-hidden="true">·</span>
                  {mismatchCount === 0 ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <Check className="size-3.5" /> 与文件名顺序一致
                    </span>
                  ) : (
                    <span className="text-amber-300">{mismatchCount} 项与文件名顺序不同</span>
                  )}
                  {dirty && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-200">未保存</span>}
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                className="bg-blue-600 text-white hover:bg-blue-500"
                disabled={!dirty || isSaving}
                onClick={() => void handleSave()}
              >
                {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                <span className="hidden sm:inline">保存</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-neutral-300 hover:bg-white/10 hover:text-white"
                aria-label="关闭顺序校对"
                onClick={requestClose}
              >
                <X className="size-5" />
              </Button>
            </div>

            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ToolButton label="撤销" disabled={past.length === 0} onClick={handleUndo}>
                <Undo2 />
              </ToolButton>
              <ToolButton label="重做" disabled={future.length === 0} onClick={handleRedo}>
                <Redo2 />
              </ToolButton>
              <div className="mx-1 h-5 w-px shrink-0 bg-white/15" />
              <ToolButton label="文件名排序" onClick={() => applyDraft(sortMediaNaturally(draft))}>
                <ListRestart />
              </ToolButton>
              <ToolButton label="反转" onClick={() => applyDraft([...draft].reverse())}>
                <Shuffle />
              </ToolButton>
              <ToolButton label="恢复已保存" disabled={!dirty} onClick={() => applyDraft(baseline)}>
                <RotateCcw />
              </ToolButton>
              <div className="mx-1 hidden h-5 w-px shrink-0 bg-white/15 md:block" />
              <div className="hidden shrink-0 items-center rounded-lg bg-white/[0.04] p-0.5 md:flex" aria-label="联系表展示模式">
                <CollectionViewButton
                  label="缩略图"
                  active={collectionView === 'contact'}
                  onClick={() => setCollectionView('contact')}
                >
                  <LayoutGrid />
                </CollectionViewButton>
                <CollectionViewButton
                  label="名称列表"
                  active={collectionView === 'names'}
                  onClick={() => setCollectionView('names')}
                >
                  <List />
                </CollectionViewButton>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 rounded-lg bg-white/5 p-1 md:hidden">
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  mobilePanel === 'collection' && collectionView === 'contact'
                    ? 'bg-white/12 text-white'
                    : 'text-neutral-400'
                )}
                onClick={() => {
                  setCollectionView('contact')
                  setMobilePanel('collection')
                }}
              >
                总览
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  mobilePanel === 'collection' && collectionView === 'names'
                    ? 'bg-white/12 text-white'
                    : 'text-neutral-400'
                )}
                onClick={() => {
                  setCollectionView('names')
                  setMobilePanel('collection')
                }}
              >
                名称
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  mobilePanel === 'compare' ? 'bg-white/12 text-white' : 'text-neutral-400'
                )}
                onClick={() => setMobilePanel('compare')}
              >
                相邻对比
              </button>
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col md:flex-row">
            <section
              className={cn(
                'min-h-0 flex-1 overflow-y-auto overscroll-contain bg-neutral-950 px-3 py-4 sm:px-5 md:block md:w-[58%] md:border-r md:border-white/10',
                mobilePanel === 'collection' ? 'block' : 'hidden'
              )}
              aria-label={collectionView === 'names' ? '媒体名称列表' : '媒体顺序联系表'}
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={() => setActiveDragId(null)}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={idsOf(draft)}
                  strategy={collectionView === 'names' ? verticalListSortingStrategy : rectSortingStrategy}
                >
                  {collectionView === 'names' ? (
                    <div className="space-y-1.5" data-testid="media-name-list">
                      {draft.map((media, index) => (
                        <SortableMediaNameRow
                          key={media.id}
                          media={media}
                          index={index}
                          selected={media.id === selectedId}
                          onSelect={() => setSelectedId(media.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                      data-testid="media-contact-grid"
                    >
                      {draft.map((media, index) => (
                        <SortableMediaCard
                          key={media.id}
                          media={media}
                          index={index}
                          naturalIndex={naturalRanks.get(media.id) ?? index}
                          selected={media.id === selectedId}
                          onSelect={() => setSelectedId(media.id)}
                        />
                      ))}
                    </div>
                  )}
                </SortableContext>

                <DragOverlay dropAnimation={null}>
                  {activeDragMedia ? (
                    collectionView === 'names' ? (
                      <MediaNameRowVisual
                        media={activeDragMedia}
                        index={draft.findIndex((image) => image.id === activeDragMedia.id)}
                        selected
                        dragging
                      />
                    ) : (
                      <MediaCardVisual
                        media={activeDragMedia}
                        index={draft.findIndex((image) => image.id === activeDragMedia.id)}
                        naturalIndex={naturalRanks.get(activeDragMedia.id) ?? 0}
                        selected
                        dragging
                      />
                    )
                  ) : null}
                </DragOverlay>
              </DndContext>
            </section>

            <section
              className={cn(
                'min-h-0 flex-1 flex-col bg-neutral-900 md:flex md:w-[42%] md:flex-none',
                mobilePanel === 'compare' ? 'flex' : 'hidden'
              )}
              aria-label="相邻媒体对比"
            >
              <AdjacentComparison
                images={draft}
                pairStartIndex={pairStartIndex}
                onPrevious={() => setSelectedId(draft[Math.max(0, pairStartIndex - 1)]!.id)}
                onNext={() => setSelectedId(draft[Math.min(draft.length - 2, pairStartIndex + 1)]!.id)}
                onSelect={(id) => setSelectedId(id)}
                onSwap={() => {
                  const nextDraft = swapMediaItems(draft, pairStartIndex, pairStartIndex + 1)
                  setSelectedId(nextDraft[pairStartIndex]!.id)
                  applyDraft(nextDraft)
                }}
              />
            </section>
          </main>

          <footer className="shrink-0 border-t border-white/10 bg-neutral-950 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5">
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="mr-1 min-w-24 shrink-0">
                <div className="truncate text-xs font-medium text-white">{selectedMedia ? getFileName(selectedMedia.path) : '-'}</div>
                <div className="text-[11px] text-neutral-500">当前第 {selectedIndex + 1} 项</div>
              </div>
              <MoveButton label="移到开头" disabled={selectedIndex === 0} onClick={() => moveSelectedTo(0)}>
                <ArrowUpToLine />
              </MoveButton>
              <MoveButton label="前移" disabled={selectedIndex === 0} onClick={() => moveSelectedTo(selectedIndex - 1)}>
                <ArrowLeft />
              </MoveButton>
              <MoveButton
                label="后移"
                disabled={selectedIndex === draft.length - 1}
                onClick={() => moveSelectedTo(selectedIndex + 1)}
              >
                <ArrowRight />
              </MoveButton>
              <MoveButton
                label="移到末尾"
                disabled={selectedIndex === draft.length - 1}
                onClick={() => moveSelectedTo(draft.length - 1)}
              >
                <ArrowDownToLine />
              </MoveButton>
              <div className="ml-1 flex shrink-0 items-center gap-1.5 border-l border-white/15 pl-3">
                <span className="text-xs text-neutral-400">移到</span>
                <Input
                  type="number"
                  min={1}
                  max={draft.length}
                  value={targetPosition}
                  onChange={(event) => setTargetPosition(event.target.value)}
                  className="h-8 w-16 border-white/15 bg-white/5 px-2 text-center text-white"
                  aria-label="目标序号"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') moveSelectedToPosition()
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 bg-white/10 text-white hover:bg-white/15"
                  onClick={moveSelectedToPosition}
                >
                  确定
                </Button>
              </div>
            </div>
          </footer>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent className="z-[130]" overlayClassName="z-[120] bg-black/75">
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的顺序？</AlertDialogTitle>
            <AlertDialogDescription>当前草稿包含尚未保存的改动，关闭后这些改动会丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                dirtyRef.current = false
                consumeHistoryAndClose()
              }}
            >
              放弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ToolButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-8 shrink-0 bg-white/[0.04] text-neutral-300 hover:bg-white/10 hover:text-white"
    >
      {children}
      {label}
    </Button>
  )
}

function CollectionViewButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
        active ? 'bg-white/12 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {label}
    </button>
  )
}

function MoveButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-8 shrink-0 bg-white/[0.04] text-neutral-300 hover:bg-white/10 hover:text-white"
      title={label}
      aria-label={label}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}

function SortableMediaCard({
  media,
  index,
  naturalIndex,
  selected,
  onSelect
}: {
  media: ArtworkImageResponseDto
  index: number
  naturalIndex: number
  selected: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: media.id
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-25')}
    >
      <MediaCardVisual
        media={media}
        index={index}
        naturalIndex={naturalIndex}
        selected={selected}
        onSelect={onSelect}
        dragHandleRef={setActivatorNodeRef}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function SortableMediaNameRow({
  media,
  index,
  selected,
  onSelect
}: {
  media: ArtworkImageResponseDto
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: media.id
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-25')}
    >
      <MediaNameRowVisual
        media={media}
        index={index}
        selected={selected}
        onSelect={onSelect}
        dragHandleRef={setActivatorNodeRef}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function MediaNameRowVisual({
  media,
  index,
  selected,
  dragging,
  onSelect,
  dragHandleRef,
  dragHandleProps
}: {
  media: ArtworkImageResponseDto
  index: number
  selected: boolean
  dragging?: boolean
  onSelect?: () => void
  dragHandleRef?: React.Ref<HTMLButtonElement>
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const fileName = getFileName(media.path)

  return (
    <div
      data-testid="media-name-row"
      className={cn(
        'group flex min-h-11 items-stretch overflow-hidden rounded-lg border bg-neutral-900 transition-colors',
        selected ? 'border-blue-400 bg-blue-400/10 ring-1 ring-blue-400/30' : 'border-white/10 hover:border-white/25',
        dragging && 'w-[min(34rem,calc(100vw-2rem))] shadow-2xl'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        onClick={onSelect}
        aria-label={`选择第 ${index + 1} 项 ${fileName}`}
      >
        <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-neutral-500">
          {index + 1}
        </span>
        <span className="min-w-0 break-all text-sm leading-5 text-neutral-100">{fileName}</span>
      </button>
      {dragHandleProps && (
        <button
          type="button"
          {...dragHandleProps}
          ref={dragHandleRef}
          className="flex w-11 shrink-0 touch-none items-center justify-center border-l border-white/10 text-neutral-500 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
          aria-label={`拖动第 ${index + 1} 项调整顺序`}
          title="拖动调整顺序"
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  )
}

function MediaCardVisual({
  media,
  index,
  naturalIndex,
  selected,
  dragging,
  onSelect,
  dragHandleRef,
  dragHandleProps
}: {
  media: ArtworkImageResponseDto
  index: number
  naturalIndex: number
  selected: boolean
  dragging?: boolean
  onSelect?: () => void
  dragHandleRef?: React.Ref<HTMLButtonElement>
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const fileName = getFileName(media.path)
  const naturalMismatch = index !== naturalIndex
  const mediaLabel = getMediaLabel(media)

  return (
    <div
      data-testid="media-order-card"
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-neutral-900 shadow-sm transition-colors',
        selected ? 'border-blue-400 ring-2 ring-blue-400/35' : 'border-white/10 hover:border-white/25',
        dragging && 'w-36 rotate-2 shadow-2xl sm:w-44'
      )}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect} aria-label={`选择第 ${index + 1} 项 ${fileName}`}>
        <div className="relative aspect-square bg-black/35">
          <MediaThumbnail
            media={media}
            alt={fileName}
            fill
            className="object-contain p-1.5"
            sizes="(max-width: 767px) 50vw, (max-width: 1023px) 20vw, 180px"
          />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-1.5">
            <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
              #{index + 1}
            </span>
            {mediaLabel !== '图片' && (
              <span className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">{mediaLabel}</span>
            )}
          </div>
        </div>
        <div className="space-y-0.5 px-2 pb-2 pt-1.5">
          <div className="truncate text-[11px] font-medium text-neutral-100" title={fileName}>{fileName}</div>
          <div className="flex items-center justify-between gap-1 text-[10px] text-neutral-500">
            <span>{media.width && media.height ? `${media.width}×${media.height}` : '未知尺寸'}</span>
            {naturalMismatch && <span className="text-amber-300">文件名 #{naturalIndex + 1}</span>}
          </div>
        </div>
      </button>
      {dragHandleProps && (
        <button
          type="button"
          {...dragHandleProps}
          ref={dragHandleRef}
          className="absolute right-1.5 top-8 z-10 flex size-8 touch-none items-center justify-center rounded-md bg-black/65 text-white/75 shadow-md backdrop-blur-sm hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label={`拖动第 ${index + 1} 项调整顺序`}
          title="拖动调整顺序"
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>
      )}
    </div>
  )
}

function AdjacentComparison({
  images,
  pairStartIndex,
  onPrevious,
  onNext,
  onSelect,
  onSwap
}: {
  images: ArtworkImageResponseDto[]
  pairStartIndex: number
  onPrevious: () => void
  onNext: () => void
  onSelect: (id: number) => void
  onSwap: () => void
}) {
  const left = images[pairStartIndex]
  const right = images[pairStartIndex + 1]
  if (!left || !right) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pairStartIndex === 0}
          className="text-neutral-300 hover:bg-white/10 hover:text-white"
          onClick={onPrevious}
        >
          <ChevronLeft /> 上一组
        </Button>
        <span className="text-xs tabular-nums text-neutral-400">
          {pairStartIndex + 1}–{pairStartIndex + 2} / {images.length}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pairStartIndex >= images.length - 2}
          className="text-neutral-300 hover:bg-white/10 hover:text-white"
          onClick={onNext}
        >
          下一组 <ChevronRight />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:gap-3">
        <ComparisonMedia media={left} index={pairStartIndex} onSelect={() => onSelect(left.id)} />
        <ComparisonMedia media={right} index={pairStartIndex + 1} onSelect={() => onSelect(right.id)} />
      </div>

      <Button
        type="button"
        variant="secondary"
        className="mt-3 bg-white/10 text-white hover:bg-white/15"
        onClick={onSwap}
      >
        <Replace /> 交换这两项
      </Button>
    </div>
  )
}

function ComparisonMedia({
  media,
  index,
  onSelect
}: {
  media: ArtworkImageResponseDto
  index: number
  onSelect: () => void
}) {
  const fileName = getFileName(media.path)

  return (
    <button
      type="button"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/30 text-left transition-colors hover:border-blue-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      onClick={onSelect}
    >
      <div className="relative min-h-0 flex-1 w-full">
        <MediaThumbnail
          media={media}
          alt={fileName}
          fill
          className="object-contain p-1"
          sizes="(max-width: 1024px) 50vw, 24vw"
          priority={index < 2}
        />
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 font-mono text-xs font-semibold text-white">
          #{index + 1}
        </span>
      </div>
      <div className="w-full shrink-0 border-t border-white/10 p-2.5">
        <div className="truncate text-xs font-medium text-white" title={fileName}>{fileName}</div>
        <div className="mt-1 text-[11px] text-neutral-500">
          {getMediaLabel(media)} · {media.width && media.height ? `${media.width} × ${media.height}` : '未知尺寸'}
        </div>
      </div>
    </button>
  )
}
