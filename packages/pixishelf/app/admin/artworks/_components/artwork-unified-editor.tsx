'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { Loader2, Info, Image as ImageIcon, ExternalLink, Copy } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { toast } from 'sonner'

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
}

export function ArtworkUnifiedEditor({
  open,
  onOpenChange,
  artworkId,
  initialTab = 'info',
  initialData,
  onSuccess
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
              <TabsList className="grid h-10 w-full max-w-[320px] shrink-0 grid-cols-2 rounded-lg bg-neutral-100 p-1">
                <TabsTrigger value="info" className="flex items-center gap-2 rounded-md text-sm">
                  <Info className="w-4 h-4" /> 基础信息
                </TabsTrigger>
                <TabsTrigger
                  value="media"
                  className="flex items-center gap-2 rounded-md text-sm"
                  disabled={!currentArtworkId}
                >
                  <ImageIcon className="w-4 h-4" /> 媒体管理
                </TabsTrigger>
              </TabsList>

              {!currentArtworkId && (
                <span className="truncate text-xs text-neutral-500">先保存基础信息，再继续管理媒体。</span>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-lg font-bold text-neutral-900">
                {currentArtworkId ? artwork?.title || '加载中...' : '新增作品'}
              </span>
              {currentArtworkId && (
                <Link href={`/artworks/${currentArtworkId}`} target="_blank" className="shrink-0" title="打开作品页">
                  <ExternalLink className="h-4 w-4 text-neutral-400 transition-colors hover:text-primary" />
                </Link>
              )}
            </div>

            {currentArtworkId && (
              <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
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
            <Loader2 className="w-10 h-10 animate-spin text-neutral-300" />
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
                    return
                  }
                  if (currentArtworkId) {
                    refetch()
                    queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
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
      className={`inline-flex h-7 min-w-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 font-mono text-[11px] text-neutral-600 ${className || ''}`}
      title={value}
    >
      <span className="shrink-0 text-neutral-400">{label}:</span>
      <span className="min-w-0 truncate">{value}</span>
      <button
        type="button"
        className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        title={`复制${label}`}
        disabled={!canCopy}
        onClick={() => copyText(value, label)}
      >
        <Copy className="size-3.5" />
      </button>
    </span>
  )
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`已复制${label}`)
  } catch {
    toast.error(`复制${label}失败`)
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

  if (artwork?.artist?.userId && artwork.externalId) {
    return `/${artwork.artist.userId}/${artwork.externalId}`
  }

  return ''
}
