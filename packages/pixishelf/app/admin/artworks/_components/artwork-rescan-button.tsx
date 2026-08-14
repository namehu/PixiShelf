'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { confirm } from '@/components/shared/global-confirm'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { toast } from 'sonner'
import { ScanProgress } from '@/types'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { isLocalDirectoryArtworkSource } from '@/utils/artwork/artwork-source'
import { cn } from '@/lib/utils'

interface ArtworkRescanButtonProps {
  artwork: ArtworkResponseDto
  onComplete: () => void
}

export function ArtworkRescanButton({ artwork, onComplete }: ArtworkRescanButtonProps) {
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const handleRescan = () => {
    if (scanning) return
    confirm({
      title: '重新扫描确认',
      description:
        isLocalDirectoryArtworkSource(artwork.source)
          ? `即将重新扫描 ${artwork.title} 的媒体文件和视频章节，手动维护的标题、作者、标签不会被覆盖，是否继续？`
          : `即将重新扫描 ${artwork.title} 目录，原有元数据将被增量更新，是否继续？`,
      onConfirm: () => {
        startScan()
      }
    })
  }

  const startScan = async () => {
    setScanning(true)
    setProgress(0)
    setError(null)
    controllerRef.current = new AbortController()

    try {
      await fetchEventSource('/api/scan/rescan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ artworkId: artwork.id }),
        signal: controllerRef.current.signal,
        onopen: async (response) => {
          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error')
            throw new Error(`Failed to start scan: ${response.status} ${response.statusText} - ${errorText}`)
          }
        },
        onmessage: (msg) => {
          if (msg.event === 'progress') {
            const data = JSON.parse(msg.data) as ScanProgress
            if (data.percentage) {
              setProgress(data.percentage)
            }
          } else if (msg.event === 'complete') {
            toast.success('重新扫描完成')
            setScanning(false)
            onComplete()
            controllerRef.current?.abort() // Stop stream
          } else if (msg.event === 'error') {
            const data = JSON.parse(msg.data)
            throw new Error(data.error || 'Scan failed')
          }
        },
        onerror: (err) => {
          console.error('Scan error:', err)
          setError(err.message || 'Unknown error')
          setScanning(false)
          throw err // rethrow to stop retrying if we want
        }
      })
    } catch (err: any) {
      setError(err.message || 'Unknown error')
      setScanning(false)
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  return (
    <div className="relative inline-flex items-center">
      {error && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute -left-2 -top-2 z-10 size-5 rounded-full border border-destructive/20 bg-background p-0 text-destructive shadow-surface"
                aria-label="查看重新扫描失败原因"
              >
                <AlertCircle aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] border-destructive/20 bg-background text-destructive">
              <p>{error}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={handleRescan}
        disabled={scanning}
        aria-label={scanning ? `正在扫描 ${artwork.title}，${progress}%` : `重新扫描 ${artwork.title}`}
        className={error ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : undefined}
      >
        <RefreshCw className={cn(scanning && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        {scanning && (
          <span className="absolute bottom-0.5 rounded bg-background/80 px-0.5 text-[10px] font-bold text-primary" aria-hidden="true">
            {progress}%
          </span>
        )}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {scanning ? `正在扫描 ${artwork.title}，${progress}%` : ''}
      </span>
    </div>
  )
}
