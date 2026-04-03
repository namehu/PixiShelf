'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { Badge } from '@/components/ui/badge'
import { Loader2, Info, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'

import { ArtworkInfoForm } from './artwork-info-form'
import { ImageManagerContent } from './image-manager-content'

interface ArtworkUnifiedEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  initialTab?: 'info' | 'media'
  onSuccess?: (data?: ArtworkResponseDto) => void
}

export function ArtworkUnifiedEditor({
  open,
  onOpenChange,
  artworkId,
  initialTab = 'info',
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
          <div className="flex min-w-0 flex-col gap-3 pr-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-lg font-bold text-neutral-900">
                    {currentArtworkId ? artwork?.title || '加载中...' : '新增作品'}
                  </span>
                  {currentArtworkId && (
                    <Link href={`/artworks/${currentArtworkId}`} target="_blank" className="shrink-0">
                      <ExternalLink className="h-4 w-4 text-neutral-400 transition-colors hover:text-primary" />
                    </Link>
                  )}
                </div>

                {currentArtworkId ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      外部ID: {artwork?.externalId || '-'}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      内部ID: {currentArtworkId}
                    </Badge>
                    <span className="truncate">艺术家: {artwork?.artist?.name || '未知'}</span>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-neutral-500">先保存基础信息，再继续管理媒体。</div>
                )}
              </div>

              <TabsList className="grid h-10 w-full max-w-[320px] grid-cols-2 rounded-lg bg-neutral-100 p-1">
                <TabsTrigger value="info" className="flex items-center gap-2 rounded-md text-sm">
                  <Info className="w-4 h-4" /> 基础信息
                </TabsTrigger>
                <TabsTrigger value="media" className="flex items-center gap-2 rounded-md text-sm" disabled={!currentArtworkId}>
                  <ImageIcon className="w-4 h-4" /> 媒体管理
                </TabsTrigger>
              </TabsList>
            </div>
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
