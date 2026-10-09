'use client'

import { usePathname } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Globe2Icon, ImagesIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/page-container'
import { SourcePreviewReader } from '@/components/source-preview/source-preview-reader'
import { Empty, EmptyHeader, EmptyTitle, EmptyContent, EmptyDescription } from '@/components/ui/empty'
import { ReadingResumeToast } from './reading-resume-toast'
import { ReadingProgressControls } from './reading-progress-controls'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTRPC } from '@/lib/trpc'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { OpenArchivePreviewDto } from '@/services/archive-preview/archive-preview-types'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkReading } from '@/lib/reading/reading-provider'
import ArtworkImages from './artwork-images'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'
import { type ArtworkMediaView, useArtworkMediaView } from './artwork-media-view-context'

export function ArtworkMediaSection({ images, artworkId }: { images: ArtworkImageResponseDto[]; artworkId: number }) {
  const reading = useArtworkReading(artworkId)
  const [continueRequest, setContinueRequest] = useState<{ index: number; nonce: number } | null>(null)
  const [filter, setFilter] = useState<{ owner: string | null; artworkId: number; ids: number[]; nonce: number } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setFilter(null); setContinueRequest(null) }, [artworkId, reading.ownerUserId])
  const unreadOnly = filter !== null && filter.owner === reading.ownerUserId && filter.artworkId === artworkId
  const filteredImages = useMemo(() => unreadOnly
    ? images.filter((image) => filter.ids.includes(image.id)) : images, [filter, images, unreadOnly])
  const changeFilter = (enabled: boolean) => {
    useArtworkAutoBrowseStore.getState().pause('manual')
    setContinueRequest(null)
    const seen = new Set(reading.context?.seenMediaIds ?? [])
    const ids = reading.context?.media.filter((item) => !seen.has(item.mediaId)).flatMap((item) => item.memberMediaIds) ?? []
    setFilter(enabled ? { owner: reading.ownerUserId, artworkId, ids, nonce: (filter?.nonce ?? 0) + 1 } : null)
    requestAnimationFrame(() => {
      if (!topRef.current) return
      window.scrollTo({
        top: Math.max(0, topRef.current.getBoundingClientRect().top + window.scrollY - getAutoBrowseViewport().top - 16),
        behavior: 'instant'
      })
    })
  }
  const continueReading = (resume = reading.resume) => {
    if (!resume) return
    useArtworkAutoBrowseStore.getState().pause('manual')
    setFilter(null)
    const logical = reading.context?.media.find((item) => item.memberMediaIds.includes(resume.mediaId))
    const index = images.findIndex((media) => logical?.memberMediaIds.includes(media.id) || media.id === resume.mediaId)
    setContinueRequest((previous) => ({ index: index >= 0 ? index : resume.index, nonce: (previous?.nonce ?? 0) + 1 }))
  }
  const emptyUnread = unreadOnly && filteredImages.length === 0
  const trpc = useTRPC()
  const mediaView = useArtworkMediaView()
  const actionRef = useRef({ changeFilter, continueReading, reading, unreadOnly })
  actionRef.current = { changeFilter, continueReading, reading, unreadOnly }
  const setReadingMenu = mediaView?.setReadingMenu
  const readingRequest = mediaView?.readingRequest
  const remaining = reading.summary ? Math.max(0, reading.summary.totalCount - reading.summary.seenCount) : 0
  const available = Boolean(reading.context)
  useEffect(() => {
    setReadingMenu?.(available ? { unreadOnly, remaining, disabled: reading.marking || reading.invalidated } : null)
  }, [setReadingMenu, available, unreadOnly, remaining, reading.marking, reading.invalidated])
  useEffect(() => () => setReadingMenu?.(null), [setReadingMenu])
  useEffect(() => {
    if (!readingRequest) return
    const current = actionRef.current
    if (readingRequest.action === 'mark-all') void current.reading.markRead({ kind: 'ALL' })
    else current.changeFilter(readingRequest.action === 'refresh' || !current.unreadOnly)
  }, [readingRequest])

  const pathname = usePathname()
  const detailActive = pathname === `/artworks/${artworkId}`
  const resumeShown = useRef(false)
  const resumeToastId = useRef<string | null>(null)
  useEffect(() => {
    resumeShown.current = false
    // Each route entry needs its own toast identity: an old dismissal must not remove a new prompt.
    const id = detailActive ? `reading-resume-${crypto.randomUUID()}` : null
    resumeToastId.current = id
    return () => { if (id) toast.dismiss(id) }
  }, [detailActive, artworkId, reading.ownerUserId])
  useEffect(() => {
    const id = resumeToastId.current
    if (!detailActive || !id) return
    if (reading.invalidated) { toast.dismiss(id); return }
    if (!reading.context || resumeShown.current) return
    resumeShown.current = true
    const resume = reading.resume
    if (!resume || resume.index === 0 || (reading.context.summary.lastMediaId === null && reading.context.summary.lastMediaIndex === null)) return
    const dismiss = () => toast.dismiss(id)
    toast.custom(() => <ReadingResumeToast index={resume.index} onDismiss={dismiss}
      onJump={() => { dismiss(); actionRef.current.continueReading(resume) }}
      onStart={() => {
        dismiss()
        useArtworkAutoBrowseStore.getState().pause('manual')
        setFilter(null)
        setContinueRequest((previous) => ({ index: 0, nonce: (previous?.nonce ?? 0) + 1 }))
      }} />, { id, position: 'bottom-center', duration: Infinity, className: 'reading-resume-toast' })
  }, [reading.context, reading.resume, reading.invalidated, detailActive, artworkId, reading.ownerUserId])
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
        {view === 'local' ? (
          <>
            <PageContainer size="reading"><div ref={topRef} className="scroll-mt-20"><ReadingProgressControls reading={reading} empty={emptyUnread} /></div></PageContainer>
            {emptyUnread ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyTitle>没有未读内容</EmptyTitle>
                  <EmptyDescription>这部作品的 {reading.summary?.totalCount ?? 0} 张图片都已读完。</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button variant="secondary" onClick={() => changeFilter(false)}>查看全部</Button></EmptyContent>
              </Empty>
            ) : (
              <ArtworkImages key={`${artworkId}:${reading.ownerUserId}:${unreadOnly ? filter.nonce : 'all'}`}
                images={filteredImages} artworkId={artworkId} reading={reading}
                trackingActive={!mediaView?.readerBlocked} continueRequest={continueRequest} />
            )}
          </>
        ) : null}
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
