'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { ArrowLeft, Info, Image as ImageIcon, ExternalLink, Copy } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { ArtworkInfoForm } from './artwork-info-form'
import type { ArtworkInfoFormInitialData } from './artwork-info-form'
import { ImageManagerContent } from './image-manager/content'

interface ArtworkUnifiedEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  initialTab?: 'info' | 'media'
  initialData?: ArtworkInfoFormInitialData | null
  onSuccess?: (data?: ArtworkResponseDto) => void
  returnTo?: string | null
}

export function ArtworkUnifiedEditor({
  open,
  onOpenChange,
  artworkId,
  initialTab = 'info',
  initialData,
  onSuccess,
  returnTo
}: ArtworkUnifiedEditorProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [currentArtworkId, setCurrentArtworkId] = useState<number | null>(artworkId)

  const {
    data: artwork,
    isLoading,
    refetch
  } = useQuery(
    trpc.artwork.getById.queryOptions(currentArtworkId!, {
      enabled: !!currentArtworkId && open,
      staleTime: 0
    })
  )
  const artworkDirectory = getArtworkDirectory(artwork || null)
  const safeReturnTo = currentArtworkId && returnTo === `/artworks/${currentArtworkId}` ? returnTo : null

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    setCurrentArtworkId(artworkId)
  }, [open, initialTab, artworkId])

  return (
    <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex h-full flex-col">
      <ProDrawer
        open={open}
        onOpenChange={onOpenChange}
        width="85%"
        footer={null}
        bodyClassName="flex min-h-0 flex-col px-4 pt-3 pb-2"
        title={
          <div className="flex min-w-0 flex-col gap-2.5 pr-4">
            <div className="flex min-w-0 items-center gap-3">
              <TabsList className="grid h-10 w-full max-w-[320px] shrink-0 grid-cols-2 rounded-lg bg-muted p-1">
                <TabsTrigger value="info" className="flex items-center gap-2 rounded-md text-sm">
                  <Info data-icon="inline-start" aria-hidden="true" /> 基础信息
                </TabsTrigger>
                <TabsTrigger
                  value="media"
                  className="flex items-center gap-2 rounded-md text-sm"
                  disabled={!currentArtworkId}
                >
                  <ImageIcon data-icon="inline-start" aria-hidden="true" /> 媒体管理
                </TabsTrigger>
              </TabsList>

              {!currentArtworkId && (
                <span className="truncate text-xs text-muted-foreground">先保存基础信息，再继续管理媒体。</span>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              {safeReturnTo && (
                <Button
                  type="button"
                  onClick={() => window.location.assign(`${safeReturnTo}?mediaRefresh=${Date.now()}`)}
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                >
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  返回并刷新
                </Button>
              )}
              <span className="min-w-0 flex-1 truncate text-lg font-bold text-foreground">
                {currentArtworkId ? artwork?.title || '加载中…' : '新增作品'}
              </span>
              {currentArtworkId && (
                <Link
                  href={`/artworks/${currentArtworkId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                  aria-label="在新标签页打开作品"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                </Link>
              )}
            </div>

            {currentArtworkId && (
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <CopyMetaItem label="外部ID" value={artwork?.externalId || '-'} />
                <CopyMetaItem label="内部ID" value={String(currentArtworkId)} />
                <CopyMetaItem label="作者ID" value={artwork?.artist?.userId || '-'} />
                <CopyMetaItem label="来源" value={artwork?.metaSource || '-'} className="min-w-0 flex-1" />
                <CopyMetaItem label="路径" value={artworkDirectory || '-'} className="min-w-0 flex-1" />
                <span className="shrink-0 truncate">艺术家: {artwork?.artist?.name || '未知'}</span>
              </div>
            )}
          </div>
        }
      >
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Spinner className="size-10 text-muted-foreground" aria-label="正在加载作品" />
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <TabsContent value="info" className="absolute inset-0 m-0 data-[state=inactive]:hidden pr-2">
              <ArtworkInfoForm
                data={artwork || null}
                initialData={currentArtworkId ? null : initialData}
                onSuccess={(savedArtwork) => {
                  onSuccess?.(savedArtwork)
                  if (savedArtwork?.id && !currentArtworkId) {
                    setCurrentArtworkId(savedArtwork.id)
                    setActiveTab('media')
                    queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
                    queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
                    return
                  }
                  if (currentArtworkId) {
                    refetch()
                    queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
                    queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
                  }
                }}
              />
            </TabsContent>

            <TabsContent value="media" className="absolute inset-0 m-0 data-[state=inactive]:hidden">
              <ImageManagerContent
                data={artwork}
                onSuccess={() => {
                  onSuccess?.(artwork || undefined)
                  refetch()
                  queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
                  queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
                }}
              />
            </TabsContent>
          </div>
        )}
      </ProDrawer>
    </Tabs>
  )
}

function CopyMetaItem({ label, value, className }: { label: string; value: string; className?: string }) {
  const canCopy = value !== '-'

  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] text-muted-foreground',
        className
      )}
      title={value}
    >
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="min-w-0 truncate select-text">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-1 size-5 shrink-0 text-muted-foreground"
        aria-label={`复制${label}`}
        disabled={!canCopy}
        onClick={() => copyText(value, label)}
      >
        <Copy aria-hidden="true" />
      </Button>
    </span>
  )
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`已复制${label}`)
  } catch {
    toast.error(`复制${label}失败，可直接框选文本复制`)
  }
}

function getArtworkDirectory(artwork: ArtworkResponseDto | null): string {
  const firstImagePath = artwork?.images?.[0]?.path
  if (firstImagePath) {
    const normalizedPath = firstImagePath.replace(/\\/g, '/')
    const index = normalizedPath.lastIndexOf('/')

    if (index > 0) {
      return normalizedPath.slice(0, index)
    }
  }

  const storageIdentity = artwork?.storageKey ?? artwork?.externalId
  if (artwork?.artist?.userId && storageIdentity) {
    return `/${artwork.artist.userId}/${storageIdentity}`
  }

  return ''
}
