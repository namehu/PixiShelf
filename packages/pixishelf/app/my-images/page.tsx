'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkIcon, HeartIcon, ImageOffIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore, useAuthUser } from '@/components/auth'
import { PageContainer } from '@/components/layout/page-container'
import PageToolbar from '@/components/layout/page-toolbar'
import { PageState } from '@/components/layout/page-state'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { useMediaMark } from '@/hooks/use-media-mark'
import { mediaMarkListKey } from '@/lib/media-mark-state'
import { useTRPCClient } from '@/lib/trpc'
import type { MediaMarkKind, MediaMarkListItemDto } from '@/schemas/media-mark.dto'

function LinkedMarkCard({ item, kind }: { item: MediaMarkListItemDto; kind: MediaMarkKind }) {
  const mark = useMediaMark(item.artworkId, item.mediaId, {
    markId: item.id, artworkId: item.artworkId, mediaId: item.mediaId!, bookmarkedAt: item.bookmarkedAt, likedAt: item.likedAt, available: !item.unavailableReason
  })
  return <MarkCard item={item} kind={kind} saving={mark.isSaving} onRemove={() => mark.remove(kind, item.id)} />
}

function UnavailableMarkCard({ item, kind }: { item: MediaMarkListItemDto; kind: MediaMarkKind }) {
  const owner = useAuthUser()?.id ?? ''
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const removal = useMutation({
    mutationFn: () => client.mediaMark.remove.mutate({ markId: item.id, kind, expectedUserId: owner }),
    onSuccess: async () => {
      if (useAuthStore.getState().user?.id !== owner) return
      await queryClient.invalidateQueries({ queryKey: mediaMarkListKey(owner) })
    },
    onError: () => toast.error('移除失败，请重试。')
  })
  return <MarkCard item={item} kind={kind} saving={removal.isPending} onRemove={() => removal.mutate()} />
}

function MarkCard({ item, kind, saving, onRemove }: {
  item: MediaMarkListItemDto; kind: MediaMarkKind; saving: boolean; onRemove: () => void
}) {
  const available = !item.unavailableReason && item.mediaId !== null && item.media !== null
  const Icon = kind === 'bookmark' ? BookmarkIcon : HeartIcon
  const label = kind === 'bookmark' ? '移除书签' : '取消喜欢'
  return (
    <article className="min-w-0">
      <div className="relative">
        {available ? (
          <Link href={`/artworks/${item.artworkId}?mediaId=${item.mediaId}`}
            aria-label={`查看${item.artworkTitle}的第 ${item.mediaPosition} 张图片`}
            className="block aspect-[3/4] overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <MediaThumbnail media={item.media} alt={item.artworkTitle} width={400} height={533}
              className="h-full w-full object-cover" loading="lazy" />
          </Link>
        ) : (
          <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-md bg-muted px-3 text-center text-muted-foreground">
            <ImageOffIcon className="size-7" aria-hidden="true" />
            <span className="text-sm">{item.unavailableReason === 'writing' ? '媒体更新中，暂不可查看' : '原媒体已失效'}</span>
          </div>
        )}
        <div className="absolute right-1 top-1 size-11">
          <Button type="button" variant="ghost" size="icon"
            className="group/mark size-11 rounded-full p-0 hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            disabled={saving || item.unavailableReason === 'writing'}
            title={item.unavailableReason === 'writing' ? '媒体更新中，暂不可操作' : label}
            aria-label={`${label}：${item.artworkTitle}，第 ${item.mediaPosition} 张`}
            aria-pressed={true} aria-busy={saving} onClick={onRemove}>
            <span className="flex size-8 items-center justify-center rounded-full bg-black/65 text-white shadow-sm transition-colors group-hover/mark:bg-black/85 group-focus-visible/mark:bg-black/85">
              {saving ? <Spinner /> : <Icon className="fill-current" aria-hidden="true" />}
            </span>
          </Button>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-col gap-1">
        <PrivacySensitiveText as="h2" className="line-clamp-2 break-words text-sm font-semibold leading-5">{item.artworkTitle || '未命名作品'}</PrivacySensitiveText>
        <p className="text-xs text-muted-foreground">第 {item.mediaPosition} 张 · {item.mediaType === 'video' ? '视频' : item.mediaType === 'animation' ? '动图' : '图片'}</p>
      </div>
    </article>
  )
}

function MediaMarkList({ kind }: { kind: MediaMarkKind }) {
  const owner = useAuthUser()?.id ?? ''
  const client = useTRPCClient()
  const [page, setPage] = useState(1)
  const result = useQuery({
    queryKey: [...mediaMarkListKey(owner), kind, page],
    enabled: Boolean(owner),
    queryFn: ({ signal }) => client.mediaMark.list.query({ kind, page, expectedUserId: owner }, { signal })
  })
  const items = result.data?.items ?? []
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / 24))

  return (
    <>
      {result.isError ? (
        <PageState variant="error" title="图片标记加载失败" description="请稍后重试。"
          action={<Button type="button" variant="outline" onClick={() => void result.refetch()}>重试</Button>} />
      ) : result.isLoading || !owner ? (
        <PageState variant="loading" title="正在加载图片" />
      ) : items.length === 0 ? (
        <PageState variant="empty" title={kind === 'bookmark' ? '还没有图片书签' : '还没有喜欢的图片'}
          description="浏览作品时，在图片菜单或预览顶部添加标记。"
          icon={kind === 'bookmark' ? <BookmarkIcon /> : <HeartIcon />}
          action={page > 1 ? <Button variant="outline" onClick={() => setPage(1)}>返回第一页</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item) => !item.mediaId
            ? <UnavailableMarkCard key={item.id} item={item} kind={kind} />
            : <LinkedMarkCard key={item.id} item={item} kind={kind} />)}
        </div>
      )}
      {!result.isLoading && !result.isError && (pages > 1 || page > 1) ? (
        <nav aria-label="图片标记分页" className="mt-8 flex items-center justify-center gap-4">
          <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm tabular-nums text-muted-foreground">{page} / {Math.max(page, pages)}</span>
          <Button type="button" variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
        </nav>
      ) : null}
    </>
  )
}

export default function MyImagesPage() {
  const owner = useAuthUser()?.id
  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar containerSize="gallery" title="我的图片" />
      <PageContainer as="main" size="gallery" className="py-6">
        <Tabs key={owner} defaultValue="bookmark" className="gap-6">
          <TabsList className="h-12" aria-label="图片标记类型">
            <TabsTrigger value="bookmark" className="min-h-11 px-4"><BookmarkIcon aria-hidden="true" />书签</TabsTrigger>
            <TabsTrigger value="like" className="min-h-11 px-4"><HeartIcon aria-hidden="true" />喜欢的图片</TabsTrigger>
          </TabsList>
          <TabsContent value="bookmark"><MediaMarkList kind="bookmark" /></TabsContent>
          <TabsContent value="like"><MediaMarkList kind="like" /></TabsContent>
        </Tabs>
      </PageContainer>
    </div>
  )
}
