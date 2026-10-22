'use client'

import { useArtworkSummary } from './artwork-summary-context'
import { ArtworkSummaryControls } from './artwork-summary-controls'
import { projectArtworkStacks } from './artwork-stack-projection'
import { ARTWORK_STACK_RULE_VERSION } from '@/lib/reading/artwork-stacks'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/page-container'
import { Empty, EmptyHeader, EmptyTitle, EmptyContent, EmptyDescription } from '@/components/ui/empty'
import { ReadingResumeToast } from './reading-resume-toast'
import { ReadingProgressControls } from './reading-progress-controls'
import { Button } from '@/components/ui/button'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { useArtworkReading } from '@/lib/reading/reading-provider'
import ArtworkImages from './artwork-images'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'
import { useArtworkMediaView } from './artwork-media-view-context'
import { useArtworkDetailControls } from './artwork-detail-controls'

type MediaSectionProps = { images: ArtworkImageResponseDto[]; artworkId: number; resumeOnEntry?: boolean; mediaIdOnEntry?: number | null }

export function ArtworkMediaSection({ images, artworkId, resumeOnEntry = false, mediaIdOnEntry }: MediaSectionProps) {
  const reader = useArtworkReader()
  return reader ? <MediaSectionContent images={reader.images} artworkId={artworkId} reading={reader.reading} mediaInvalidated={reader.invalidated} resumeOnEntry={resumeOnEntry} mediaIdOnEntry={mediaIdOnEntry} entryContextLoading={reader.isFetching} entryContextError={reader.error} />
    : <LegacyMediaSection images={images} artworkId={artworkId} resumeOnEntry={resumeOnEntry} mediaIdOnEntry={mediaIdOnEntry} />
}
function LegacyMediaSection({ images, artworkId, resumeOnEntry, mediaIdOnEntry }: MediaSectionProps) {
  const reading = useArtworkReading(artworkId)
  return <MediaSectionContent images={images} artworkId={artworkId} reading={reading} resumeOnEntry={resumeOnEntry} mediaIdOnEntry={mediaIdOnEntry} />
}
function MediaSectionContent({ images, artworkId, reading: handle, mediaInvalidated = false, resumeOnEntry = false, mediaIdOnEntry, entryContextLoading = false, entryContextError }: {
  images: ArtworkImageResponseDto[]; artworkId: number; reading: ReturnType<typeof useArtworkReading>; mediaInvalidated?: boolean
  resumeOnEntry?: boolean
  mediaIdOnEntry?: number | null
  entryContextLoading?: boolean
  entryContextError?: unknown
}) {
  const reader = useArtworkReader()
  const summary = useArtworkSummary()
  const summaryMode = summary?.mode === 'stack'
  const reading = mediaInvalidated ? { ...handle, invalidated: true } : handle
  const [continueRequest, setContinueRequest] = useState<{ index: number; nonce: number } | null>(null)
  const [entryResumePending, setEntryResumePending] = useState(resumeOnEntry || mediaIdOnEntry !== undefined)
  const [entryMediaError, setEntryMediaError] = useState<'invalid' | 'missing' | 'reader' | 'page' | null>(null)
  const [filter, setFilter] = useState<{ owner: string | null; artworkId: number; ids: number[]; nonce: number } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const requestScope = useRef({ artworkId, owner: reading.ownerUserId })
  useEffect(() => {
    const previous = requestScope.current
    if (previous.artworkId === artworkId && previous.owner === reading.ownerUserId) return
    requestScope.current = { artworkId, owner: reading.ownerUserId }
    setFilter(null)
    setContinueRequest(null)
    if (previous.owner && previous.owner !== reading.ownerUserId) { setEntryResumePending(false); setEntryMediaError(null) }
  }, [artworkId, reading.ownerUserId])
  const unreadOnly = filter !== null && filter.owner === reading.ownerUserId && filter.artworkId === artworkId
  const filteredImages = useMemo(() => unreadOnly
    ? images.filter((image) => filter.ids.includes(image.id)) : images, [filter, images, unreadOnly])
  useLayoutEffect(() => { if (summary) summary.availableMediaIds.current = filteredImages.map((image) => image.id) }, [filteredImages, summary?.availableMediaIds])
  const projection = useMemo(() => summaryMode && summary
    ? projectArtworkStacks(filteredImages, summary.groups, summary.activeByGroup) : null,
  [filteredImages, summaryMode, summary?.groups, summary?.activeByGroup])
  const displayImages = projection?.images ?? filteredImages
  const observe: typeof handle.observe = useCallback((surfaceId, observation) => {
    const element = document.querySelector<HTMLElement>(`[data-summary-anchor="${observation.mediaId}"]`)
    const rect = element?.getBoundingClientRect()
    const viewport = getAutoBrowseViewport()
    // IO callbacks can retain a true flag from the layout before a summary collapse.
    const visible = observation.visible && (surfaceId !== `detail-${observation.mediaId}` || Boolean(rect && rect.bottom > viewport.top && rect.top < viewport.bottom))
    const group = summaryMode ? summary?.byMediaId.get(observation.mediaId) : undefined
    const grant = group && group.mediaIds.length > 1 && summary?.fingerprint
      ? { ruleVersion: ARTWORK_STACK_RULE_VERSION, fingerprint: summary.fingerprint, groupId: group.id, mediaIds: group.mediaIds } : undefined
    const active = observation.active !== false && !entryResumePending && !summary?.navigationRef.current.active && !summary?.navigating
    if (surfaceId === 'adaptive-preview' && observation.ready && visible && active) summary?.rememberPreviewMedia(observation.mediaId)
    handle.observe(surfaceId, { ...observation, visible, active, stack: grant })
  }, [handle.observe, entryResumePending, summaryMode, summary?.byMediaId, summary?.fingerprint, summary?.navigationRef, summary?.navigating, summary?.rememberPreviewMedia])
  const projectedReading = { ...reading, observe }
  const summaryAnchor = summary?.anchor
  const handledAnchor = useRef<number | null>(null)
  useEffect(() => {
    if (!summaryAnchor || handledAnchor.current === summaryAnchor.nonce) return
    const intent = entryResume.current
    // Index initialization can anchor the visible first image. Let the explicit target replace that anchor.
    if (entryResumePending && intent?.mediaId !== undefined && (!intent.started || summaryAnchor.mediaId !== entryTarget?.mediaId)) return
    const index = displayImages.findIndex((image) => image.id === summaryAnchor.mediaId)
    handledAnchor.current = summaryAnchor.nonce
    if (index >= 0) setContinueRequest({ index, nonce: summaryAnchor.nonce })
    else summary?.finishNavigation(summaryAnchor.nonce)
  }, [summaryAnchor, displayImages])
  const changeFilter = (enabled: boolean) => {
    useArtworkAutoBrowseStore.getState().pause('manual')
    const navigation = summary?.beginNavigation()
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
      if (navigation !== undefined) summary?.finishNavigation(navigation)
    })
  }
  const continueReading = (resume = reading.resume) => {
    if (!resume) return
    useArtworkAutoBrowseStore.getState().pause('manual')
    setFilter(null)
    if (summary) { summary.reveal(resume.mediaId); return }
    const logical = reading.context?.media.find((item) => item.memberMediaIds.includes(resume.mediaId))
    const index = images.findIndex((media) => logical?.memberMediaIds.includes(media.id) || media.id === resume.mediaId)
    setContinueRequest((previous) => ({ index: index >= 0 ? index : resume.index, nonce: (previous?.nonce ?? 0) + 1 }))
  }
  const emptyUnread = unreadOnly && filteredImages.length === 0
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
  const ratingOpen = useArtworkDetailControls()?.ratingOpen ?? false
  const detailActive = pathname === `/artworks/${artworkId}`
  const entryResume = useRef<{ key: string; owner: string | null; automatic: boolean; started: boolean; mediaId?: number | null; cancelled?: boolean } | null>(null)
  const resumeShown = useRef(false)
  const resumeVisible = useRef(false)
  const entryResumeSnapshot = useRef<typeof reading.resume | undefined>(undefined)
  const resumeToastId = useRef<string | null>(null)
  useEffect(() => {
    const key = `${artworkId}:${detailActive}:${resumeOnEntry}:${mediaIdOnEntry}`
    if (entryResume.current?.key === key) return
    const url = new URL(window.location.href)
    const mediaRequested = detailActive && mediaIdOnEntry !== undefined && url.searchParams.has('mediaId')
    const requested = !mediaRequested && detailActive && resumeOnEntry && url.searchParams.get('resume') === '1'
    entryResume.current = { key, owner: actionRef.current.reading.ownerUserId, automatic: requested, started: false,
      ...(mediaRequested ? { mediaId: mediaIdOnEntry } : {}) }
    setEntryResumePending(requested || mediaRequested)
    setEntryMediaError(null)
    if (requested || mediaRequested) {
      // Consume only the intent; the account-scoped reader resolves the current media identity.
      url.searchParams.delete('resume')
      if (mediaRequested) url.searchParams.delete('mediaId')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [detailActive, artworkId, resumeOnEntry, mediaIdOnEntry])
  useEffect(() => {
    resumeShown.current = false
    resumeVisible.current = false
    entryResumeSnapshot.current = undefined
    // Each route entry needs its own toast identity: an old dismissal must not remove a new prompt.
    const id = detailActive ? `reading-resume-${crypto.randomUUID()}` : null
    resumeToastId.current = id
    return () => { if (id) toast.dismiss(id) }
  }, [detailActive, artworkId, reading.ownerUserId, resumeOnEntry, mediaIdOnEntry])
  const entryTarget = (reader ? reader.initialization?.index.items : reading.context?.media)
    ?.find((item) => item.mediaId === mediaIdOnEntry || item.memberMediaIds.includes(mediaIdOnEntry ?? -1))
  const targetMedia = entryTarget ? images.find((image) => image.id === entryTarget.mediaId) : undefined
  const targetPageFailed = entryTarget ? reader?.store?.failed(entryTarget.index) : false
  useEffect(() => {
    const intent = entryResume.current
    if (!entryResumePending || intent?.mediaId == null || intent.cancelled || !entryTarget || !reader?.store) return
    const store = reader.store
    const owner = `entry-media-${artworkId}`
    store.request(owner, [entryTarget.index])
    return () => store.release(owner)
  }, [entryResumePending, entryTarget?.mediaId, entryTarget?.index, artworkId, reader?.store])
  useEffect(() => {
    const intent = entryResume.current
    if (!detailActive || intent?.mediaId === undefined || intent.cancelled) return
    if (reading.invalidated || (intent.owner && intent.owner !== reading.ownerUserId)) {
      intent.cancelled = true
      setEntryResumePending(false)
      setEntryMediaError(null)
      if (summary?.navigationRef.current.active) summary.finishNavigation(summary.navigationRef.current.nonce)
      return
    }
    if (intent.started) return
    if (intent.mediaId === null) { setEntryMediaError('invalid'); return }
    if (entryContextError) { setEntryMediaError('reader'); return }
    if (!reading.ownerUserId || reading.isLoading || entryContextLoading || !reading.context || (reader && !reader.initialization)) return
    intent.owner = reading.ownerUserId
    if (!entryTarget) { setEntryMediaError('missing'); return }
    if (targetPageFailed) { setEntryMediaError('page'); return }
    setEntryMediaError(null)
    if (!targetMedia || targetMedia.detailsPending || (summary && (!summary.ready || summary.fingerprint !== reader?.initialization?.index.fingerprint))) return
    intent.started = true
    useArtworkAutoBrowseStore.getState().pause('manual')
    setFilter(null)
    if (summary) summary.reveal(entryTarget.mediaId)
    else setContinueRequest((previous) => ({ index: images.findIndex((image) => image.id === entryTarget.mediaId), nonce: (previous?.nonce ?? 0) + 1 }))
  }, [detailActive, reading.invalidated, reading.ownerUserId, reading.isLoading, reading.context, entryContextError, entryContextLoading,
    reader?.initialization, entryTarget, targetMedia, targetPageFailed, summary?.ready, summary?.fingerprint, summary?.reveal, images])
  useEffect(() => {
    const id = resumeToastId.current
    if (!detailActive || !id) return
    const intent = entryResume.current
    // A media link owns this entry even after it finishes or fails; never replace it with a resume prompt.
    if (intent?.mediaId !== undefined) return
    if (reading.invalidated || (intent?.owner && intent.owner !== reading.ownerUserId)) {
      if (intent) intent.automatic = false
      setEntryResumePending(false)
      if (reading.invalidated) { resumeVisible.current = false; toast.dismiss(id); return }
    }
    // Capture the entry position once, even if rating temporarily hides the prompt.
    if (entryResumeSnapshot.current === undefined && reading.context && !intent?.automatic) {
      const resume = reading.resume
      entryResumeSnapshot.current = resume && resume.index > 0 &&
        (reading.context.summary.lastMediaId !== null || reading.context.summary.lastMediaIndex !== null) ? resume : null
    }
    if (ratingOpen) {
      if (resumeVisible.current) {
        resumeVisible.current = false
        resumeShown.current = false
        toast.dismiss(id)
      }
      return
    }
    if (!reading.context || resumeShown.current) return
    if (intent?.automatic && (!reading.ownerUserId || reading.isLoading || entryContextLoading || entryContextError)) return
    resumeShown.current = true
    if (intent?.automatic) {
      if (intent.started) return
      intent.owner = reading.ownerUserId
      intent.started = true
      if (reading.resume) actionRef.current.continueReading(reading.resume)
      else setEntryResumePending(false)
      return
    }
    const resume = entryResumeSnapshot.current
    if (!resume) return
    resumeVisible.current = true
    const dismiss = () => { resumeVisible.current = false; toast.dismiss(id) }
    toast.custom(() => <ReadingResumeToast index={resume.index} onDismiss={dismiss}
      onJump={() => { dismiss(); actionRef.current.continueReading(resume) }}
      onStart={() => {
        dismiss()
        useArtworkAutoBrowseStore.getState().pause('manual')
        setFilter(null)
        setContinueRequest((previous) => ({ index: 0, nonce: (previous?.nonce ?? 0) + 1 }))
      }} />, { id, position: 'bottom-center', duration: Infinity, className: 'reading-resume-toast',
        onDismiss: () => { resumeVisible.current = false } })
  }, [reading.context, reading.resume, reading.invalidated, reading.isLoading, entryContextError, entryContextLoading, detailActive, artworkId, reading.ownerUserId, ratingOpen, resumeOnEntry])
  return (
    <>
      <PageContainer size="reading"><div ref={topRef} className="scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-x-4"><ReadingProgressControls
          reading={summary ? { ...reading, reopen: summary.reopen } : reading} empty={emptyUnread}
          resumeError={mediaIdOnEntry === undefined && entryResumePending ? entryContextError : undefined}
          resumeLoading={mediaIdOnEntry === undefined && entryResumePending && entryContextLoading}
        /><ArtworkSummaryControls /></div>
        {mediaIdOnEntry !== undefined && entryResumePending && !reading.invalidated && <div className="flex min-h-14 flex-wrap items-center gap-3 pb-4 text-sm" role="status">
          <span>{entryMediaError === 'invalid' ? '图片链接无效。' : entryMediaError === 'missing' ? '这张图片已失效，无法定位。'
            : entryMediaError ? '图片定位加载失败。' : '正在定位图片…'}</span>
          {(entryMediaError === 'reader' || entryMediaError === 'page') && <Button variant="outline" className="min-h-11" disabled={entryContextLoading}
            onClick={() => { if (entryMediaError === 'page') reader?.store?.retry(); else void reading.retry?.() }}>重试定位</Button>}
          <Button variant="ghost" className="min-h-11" onClick={() => {
            if (entryResume.current) entryResume.current.cancelled = true
            setEntryMediaError(null)
            setEntryResumePending(false)
            if (summary?.navigationRef.current.active) summary.finishNavigation(summary.navigationRef.current.nonce)
          }}>查看全部图片</Button>
        </div>}
        {summaryMode && <p className="pb-5 text-xs text-muted-foreground">上下浏览各叠，左右翻看组内图片；浏览一张即将整叠标为已读。</p>}
      </div></PageContainer>
      {reading.invalidated || entryMediaError === 'invalid' || entryMediaError === 'missing' ? null : emptyUnread ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyTitle>没有未读内容</EmptyTitle>
            <EmptyDescription>这部作品的 {reading.summary?.totalCount ?? 0} 张图片都已读完。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button variant="secondary" onClick={() => changeFilter(false)}>查看全部</Button></EmptyContent>
        </Empty>
      ) : (
        <ArtworkImages key={`${artworkId}:${reading.ownerUserId}:${unreadOnly ? filter.nonce : 'all'}`}
          images={displayImages} allImages={filteredImages} artworkId={artworkId} reading={projectedReading}
          summaryMode={summaryMode} summaryDecorations={projection?.decorations}
          trackingActive={!entryResumePending && !mediaView?.readerBlocked && !summary?.navigating} continueRequest={continueRequest}
          onContinueHandled={() => {
            const intent = entryResume.current
            if (intent?.mediaId === undefined || (intent.started && (!summary || summaryAnchor?.mediaId === entryTarget?.mediaId))) setEntryResumePending(false)
            if (summaryAnchor) summary?.finishNavigation(summaryAnchor.nonce, undefined, summaryAnchor.mediaId)
          }} />
      )}
    </>
  )
}
