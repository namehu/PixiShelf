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
      description: `即将重新扫描 ${artwork.title} 目录，原有元数据将被增量更新，是否继续？`,
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
        body: JSON.stringify({ externalId: artwork.externalId }),
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
              <div className="absolute -left-2 -top-2 z-10 text-red-500 cursor-help bg-white rounded-full p-0.5 shadow-sm border border-red-200">
                <AlertCircle className="w-4 h-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-red-50 text-red-900 border-red-200 max-w-[300px]">
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
        title={scanning ? `正在扫描... ${progress}%` : '重新扫描'}
        className={error ? 'text-red-500 hover:text-red-600 hover:bg-red-50' : ''}
      >
        <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
        {scanning && (
          <span className="absolute text-[10px] font-bold text-primary bottom-0.5 bg-background/80 px-0.5 rounded">
            {progress}%
          </span>
        )}
      </Button>
    </div>
  )
}
