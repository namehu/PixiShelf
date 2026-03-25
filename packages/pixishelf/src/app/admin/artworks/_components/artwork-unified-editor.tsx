'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { Badge } from '@/components/ui/badge'
import { Loader2, Info, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'

import { ArtworkInfoForm } from './artwork-info-form'
import { ImageManagerContent } from './image-manager-content'

interface ArtworkUnifiedEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  initialTab?: 'info' | 'media'
}

export function ArtworkUnifiedEditor({
  open,
  onOpenChange,
  artworkId,
  initialTab = 'info'
}: ArtworkUnifiedEditorProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState(initialTab)

  const {
    data: artwork,
    isLoading,
    refetch
  } = useQuery(
    trpc.artwork.getById.queryOptions(artworkId!, {
      enabled: !!artworkId && open,
      staleTime: 0
    })
  )

  useEffect(() => {
    if (open) setActiveTab(initialTab)
  }, [open, initialTab])

  if (!artworkId) return null

  return (
    <ProDrawer
      open={open}
      onOpenChange={onOpenChange}
      width="85%"
      footer={null}
      title={
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold truncate max-w-[400px]">{artwork?.title || '加载中...'}</span>
            <Link href={`/artworks/${artworkId}`} target="_blank">
              <ExternalLink className="w-4 h-4 text-neutral-400 hover:text-primary" />
            </Link>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant="secondary" className="font-mono text-xs">
              ID: {artwork?.externalId || '-'}
            </Badge>
            <span className="text-xs text-neutral-500">艺术家: {artwork?.artist?.name || '未知'}</span>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <div className="h-full flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-neutral-300" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex flex-col h-full">
          <TabsList className="grid w-[400px] grid-cols-2 mb-4 shrink-0">
            <TabsTrigger value="info" className="flex items-center gap-2">
              <Info className="w-4 h-4" /> 基础信息
            </TabsTrigger>
            <TabsTrigger value="media" className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> 媒体管理
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 relative">
            <TabsContent value="info" className="absolute inset-0 m-0 data-[state=inactive]:hidden pr-2">
              <ArtworkInfoForm
                data={artwork}
                onSuccess={() => {
                  refetch()
                }}
              />
            </TabsContent>

            <TabsContent value="media" className="absolute inset-0 m-0 data-[state=inactive]:hidden">
              <ImageManagerContent
                data={artwork}
                onSuccess={() => {
                  refetch()
                  queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </ProDrawer>
  )
}
