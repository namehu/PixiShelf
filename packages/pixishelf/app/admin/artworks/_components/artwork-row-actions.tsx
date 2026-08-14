'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Copy, Edit, ExternalLink, MoreHorizontal, RefreshCw, Trash } from 'lucide-react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { confirm } from '@/components/shared/global-confirm'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import type { ScanProgress } from '@/types'
import { isLocalDirectoryArtworkSource } from '@/utils/artwork/artwork-source'

interface ArtworkRowActionsProps {
  artwork: ArtworkResponseDto
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  onRescanComplete: () => void
}

export function ArtworkRowActions({ artwork, onEdit, onCopy, onDelete, onRescanComplete }: ArtworkRowActionsProps) {
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

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
        onmessage: (message) => {
          if (message.event === 'progress') {
            const data = JSON.parse(message.data) as ScanProgress
            if (data.percentage) {
              setProgress(data.percentage)
            }
          } else if (message.event === 'complete') {
            toast.success('重新扫描完成')
            setScanning(false)
            onRescanComplete()
            controllerRef.current?.abort()
          } else if (message.event === 'error') {
            const data = JSON.parse(message.data)
            throw new Error(data.error || 'Scan failed')
          }
        },
        onerror: (scanError) => {
          setScanning(false)
          throw scanError
        }
      })
    } catch (scanError) {
      if (controllerRef.current?.signal.aborted) return

      const message = scanError instanceof Error ? scanError.message : 'Unknown error'
      setError(message)
      setScanning(false)
      toast.error('重新扫描失败', { description: message })
    }
  }

  const handleRescan = () => {
    if (scanning) return

    confirm({
      title: '重新扫描确认',
      description: isLocalDirectoryArtworkSource(artwork.source)
        ? `即将重新扫描 ${artwork.title} 的媒体文件和视频章节，手动维护的标题、作者、标签不会被覆盖，是否继续？`
        : `即将重新扫描 ${artwork.title} 目录，原有元数据将被增量更新，是否继续？`,
      onConfirm: startScan
    })
  }

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`打开作品 ${artwork.title} 的操作菜单`}
          onClick={(event) => event.stopPropagation()}
        >
          {scanning ? (
            <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : error ? (
            <AlertCircle aria-hidden="true" />
          ) : (
            <MoreHorizontal aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <Edit aria-hidden="true" />
            编辑作品
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopy}>
            <Copy aria-hidden="true" />
            复制为新作品
          </DropdownMenuItem>
          <DropdownMenuItem disabled={scanning} onSelect={handleRescan}>
            {scanning ? <Spinner aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {scanning ? `正在重新扫描（${progress}%）` : error ? '重新扫描（上次失败）' : '重新扫描'}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/artworks/${artwork.id}`} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              在新标签页打开
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash aria-hidden="true" />
            删除作品
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      <span className="sr-only" role="status" aria-live="polite">
        {scanning ? `正在扫描 ${artwork.title}，${progress}%` : ''}
      </span>
    </DropdownMenu>
  )
}
