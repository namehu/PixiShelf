'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/page-container'
import { Empty, EmptyHeader, EmptyTitle, EmptyContent, EmptyDescription } from '@/components/ui/empty'
import { ReadingResumeToast } from './reading-resume-toast'
import { ReadingProgressControls } from './reading-progress-controls'
import { Button } from '@/components/ui/button'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkReading } from '@/lib/reading/reading-provider'
import ArtworkImages from './artwork-images'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'
import { useArtworkMediaView } from './artwork-media-view-context'

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
  return (
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
  )
}
