'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { Globe2Icon, ImagesIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/page-container'
import { SourcePreviewReader } from '@/components/source-preview/source-preview-reader'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTRPC } from '@/lib/trpc'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { OpenArchivePreviewDto } from '@/services/archive-preview/archive-preview-types'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import ArtworkImages from './artwork-images'
import { type ArtworkMediaView, useArtworkMediaView } from './artwork-media-view-context'

export function ArtworkMediaSection({ images, artworkId }: { images: ArtworkImageResponseDto[]; artworkId: number }) {
  const trpc = useTRPC()
  const mediaView = useArtworkMediaView()
  const view = mediaView?.view ?? 'local'
  const requestGeneration = useRef(0)
  const [openedPreview, setOpenedPreview] = useState<OpenArchivePreviewDto | null>(null)
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const sourcesQuery = useQuery(trpc.archivePreview.sources.queryOptions({ artworkId }, { retry: false }))
  const sources = sourcesQuery.data ?? []
  const openPreview = useMutation(trpc.archivePreview.open.mutationOptions())

  useEffect(
    () => () => {
      requestGeneration.current += 1
    },
    []
  )

  useEffect(() => {
    if (sourcesQuery.data === undefined || sources.length > 0 || view !== 'source') return
    requestGeneration.current += 1
    setOpenedPreview(null)
    setOpeningSourceId(null)
    setOpenFailed(false)
    mediaView?.setView('local')
  }, [mediaView, sources.length, sourcesQuery.data, view])

  const openSource = (externalRefId: string) => {
    const generation = ++requestGeneration.current
    setOpenedPreview(null)
    setOpeningSourceId(externalRefId)
    setOpenFailed(false)
    openPreview.mutate(
      { source: { kind: 'artwork', externalRefId } },
      {
        onSuccess: (result) => {
          if (generation !== requestGeneration.current) return
          setOpenedPreview(result)
        },
        onError: () => {
          if (generation !== requestGeneration.current) return
          setOpenFailed(true)
          toast.error('原站预览暂时无法打开，请稍后重试。')
        },
        onSettled: () => {
          if (generation === requestGeneration.current) setOpeningSourceId(null)
        }
      }
    )
  }

  const changeView = (nextValue: string) => {
    const nextView: ArtworkMediaView = nextValue === 'source' ? 'source' : 'local'
    requestGeneration.current += 1
    mediaView?.setView(nextView)
    setOpenedPreview(null)
    setOpeningSourceId(null)
    setOpenFailed(false)
    if (nextView === 'source') {
      useArtworkAutoBrowseStore.getState().pause('overlay')
      if (sources.length === 1) openSource(sources[0]!.externalRefId)
    }
  }

  return (
    <Tabs value={view} onValueChange={changeView} className="gap-4">
      {sources.length > 0 ? (
        <PageContainer key="source-tabs" size="reading">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto" aria-label="作品图片来源">
            <TabsTrigger value="local" className="min-w-0 px-4 sm:min-w-32">
              <ImagesIcon aria-hidden="true" />
              本地图片
            </TabsTrigger>
            <TabsTrigger value="source" className="min-w-0 px-4 sm:min-w-32">
              <Globe2Icon aria-hidden="true" />
              原站预览
            </TabsTrigger>
          </TabsList>
        </PageContainer>
      ) : null}

      <TabsContent key="local-images" value="local" className="mt-0">
        {view === 'local' ? <ArtworkImages images={images} artworkId={artworkId} /> : null}
      </TabsContent>
      {sources.length > 0 ? (
        <TabsContent key="source-images" value="source" className="mt-0">
          {openedPreview ? (
            <SourcePreviewReader
              key={openedPreview.previewId}
              previewId={openedPreview.previewId}
              initialPage={openedPreview}
            />
          ) : sources.length > 1 ? (
            <PageContainer size="reading">
              <section className="rounded-xl border bg-card p-5 shadow-xs" aria-labelledby="source-preview-heading">
                <h2 id="source-preview-heading" className="text-base font-semibold">
                  选择要预览的来源
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">本次选择只用于浏览，不会创建归档任务。</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {sources.map((source) => (
                    <Button
                      key={source.externalRefId}
                      type="button"
                      variant="outline"
                      disabled={openingSourceId === source.externalRefId}
                      onClick={() => openSource(source.externalRefId)}
                    >
                      {openingSourceId === source.externalRefId ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Globe2Icon aria-hidden="true" />
                      )}
                      {source.label}
                    </Button>
                  ))}
                </div>
                {openFailed ? (
                  <p className="mt-3 text-sm text-destructive">该来源暂时无法打开，可选择来源重试。</p>
                ) : null}
              </section>
            </PageContainer>
          ) : openFailed ? (
            <PageContainer size="reading">
              <section className="rounded-xl border bg-card p-5 text-center shadow-xs" role="status">
                <p className="text-sm text-muted-foreground">原站预览暂时无法打开。</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => openSource(sources[0]!.externalRefId)}
                >
                  重新打开
                </Button>
              </section>
            </PageContainer>
          ) : (
            <PageContainer size="reading">
              <div
                className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Spinner aria-hidden="true" />
                正在打开原站预览…
              </div>
            </PageContainer>
          )}
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
