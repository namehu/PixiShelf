'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@/components/ui/spinner'
import { useSafeBack } from '@/hooks/use-safe-back'
import { removeArtworkFromCache } from '@/lib/artwork-delete-cache'
import { useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import type { ArtworkDeleteInput, ArtworkDeleteReport } from '@/schemas/artwork-delete.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkMediaView } from './artwork-media-view-context'

const ArtworkDeletePreviewDrawer = dynamic(
  () =>
    import('@/app/admin/artworks/_components/artwork-delete-preview').then(
      (module) => module.ArtworkDeletePreviewDrawer
    ),
  { loading: () => <DeleteLoading label="正在打开删除预览…" /> }
)
const ArtworkDeleteReportDrawer = dynamic(
  () =>
    import('@/app/admin/artworks/_components/artwork-delete-report').then((module) => module.ArtworkDeleteReportDrawer),
  { loading: () => <DeleteLoading label="正在打开删除总结…" /> }
)

function DeleteLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-0 flex items-center justify-center gap-2 bg-background/90 text-sm text-muted-foreground"
    >
      <Spinner aria-hidden="true" />
      {label}
    </div>
  )
}

export default function ArtworkDetailDelete({
  artworkId,
  open,
  onOpenChange
}: {
  artworkId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const safeBack = useSafeBack('/artworks')
  const reader = useArtworkReader()
  const setReaderBlocked = useArtworkMediaView()?.setReaderBlocked
  const [report, setReport] = useState<ArtworkDeleteReport | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const inFlight = useRef(false)
  const mutation = useMutation(trpc.artwork.delete.mutationOptions({ retry: false }))
  const blocked = open || reportOpen || mutation.isPending

  useEffect(() => {
    setReaderBlocked?.(blocked, 'delete')
    return () => setReaderBlocked?.(false, 'delete')
  }, [blocked, setReaderBlocked])

  useEffect(() => {
    if (open || reportOpen) useArtworkAutoBrowseStore.getState().pause('overlay')
  }, [open, reportOpen])

  const loadPreview = useCallback((id: number) => client.artwork.previewDelete.query(id), [client])
  const submit = async (input: ArtworkDeleteInput) => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const result = await mutation.mutateAsync(input)
      const removed = result.outcome === 'COMPLETED' || result.outcome === 'QUEUED'
      const mediaChanged =
        result.outcome === 'PARTIAL' &&
        result.entries.some(
          (entry) => (entry.kind === 'MEDIA' || entry.kind === 'CHAPTER') && entry.status === 'DELETED'
        )
      if (removed || mediaChanged) reader?.reading.invalidate()
      if (removed) await removeArtworkFromCache(queryClient, artworkId)
      // Keep the current detail mounted until the user has reviewed the result.
      setReport(result)
      setReportOpen(true)
      onOpenChange(false)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <>
      {open && (
        <ArtworkDeletePreviewDrawer
          artworkId={artworkId}
          loadPreview={loadPreview}
          onDelete={submit}
          onClose={() => {
            if (!inFlight.current) onOpenChange(false)
          }}
        />
      )}
      {reportOpen && (
        <ArtworkDeleteReportDrawer
          report={report}
          open={reportOpen}
          onOpenChange={(nextOpen) => {
            setReportOpen(nextOpen)
            if (!nextOpen && (report?.outcome === 'COMPLETED' || report?.outcome === 'QUEUED')) safeBack()
          }}
        />
      )}
    </>
  )
}
