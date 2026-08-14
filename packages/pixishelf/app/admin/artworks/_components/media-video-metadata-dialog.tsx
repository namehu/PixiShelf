'use client'

import { ProDialog } from '@/components/shared/pro-dialog'
import { formatFileSize } from '@/utils/media'
import type React from 'react'
import type { ImageListItem } from './types'
import { VideoKeyframePanel } from './video-keyframe-panel'
import { AdminStatusBadge } from '../../_components/admin-status-badge'

interface MediaVideoMetadataDialogProps {
  open: boolean
  image: ImageListItem | null
  onOpenChange: (open: boolean) => void
}

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return '-'
  }

  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return `${m}:${String(s).padStart(2, '0')}`
}

function formatProbeStatus(status?: ImageListItem['probeStatus']) {
  switch (status) {
    case 'COMPLETED':
      return { text: '已完成', status: 'COMPLETED' }
    case 'PROBING':
      return { text: '探测中', status: 'RUNNING' }
    case 'FAILED':
      return { text: '失败', status: 'FAILED' }
    case 'SKIPPED':
      return { text: '已跳过', status: 'SKIPPED' }
    case 'PENDING':
      return { text: '待探测', status: 'PENDING' }
    default:
      return { text: '未探测', status: 'IDLE' }
  }
}

function formatAudioState(hasAudio?: boolean | null) {
  if (hasAudio === true) return '有音频'
  if (hasAudio === false) return '无音频'
  return '未知'
}

function DetailRow({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 border-b border-border py-2 last:border-b-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground" title={title}>
        {value ?? '-'}
      </div>
    </div>
  )
}

export function MediaVideoMetadataDialog({ open, image, onOpenChange }: MediaVideoMetadataDialogProps) {
  const status = formatProbeStatus(image?.probeStatus)
  const chapterFileName = image?.chaptersPath?.split('/').pop()

  return (
    <ProDialog
      open={open}
      onOpenChange={onOpenChange}
      title="视频媒体详情"
      description={image?.path || '视频媒体详情'}
      width={560}
    >
      {image ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <div className="truncate text-sm font-medium text-foreground" title={image.path}>
              {image.path.split('/').pop()}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground" title={image.path}>
              {image.path}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">探测信息</div>
            <div className="rounded-md border border-border px-3">
              <DetailRow
                label="探测状态"
                value={
                  <AdminStatusBadge status={status.status} className="h-5 rounded-sm px-1.5 text-xs">
                    {status.text}
                  </AdminStatusBadge>
                }
              />
              <DetailRow label="更新时间" value={image.probeUpdatedAt || '-'} />
              {image.probeError && (
                <DetailRow
                  label="失败原因"
                  value={<span className="block max-h-24 overflow-auto text-destructive">{image.probeError}</span>}
                  title={image.probeError}
                />
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">视频信息</div>
            <div className="rounded-md border border-border px-3">
              <DetailRow label="音频" value={formatAudioState(image.hasAudio)} />
              <DetailRow label="音频编码" value={image.audioCodec || '-'} />
              <DetailRow label="声道数" value={image.audioChannels ?? '-'} />
              <DetailRow label="视频编码" value={image.videoCodec || '-'} />
              <DetailRow label="时长" value={formatDuration(image.duration)} />
              <DetailRow label="FPS" value={image.fps ? Number(image.fps.toFixed(3)) : '-'} />
              <DetailRow
                label="尺寸/大小"
                value={`${image.width && image.height ? `${image.width} x ${image.height}` : '未知尺寸'} / ${formatFileSize(image.size || 0)}`}
              />
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">章节信息</div>
            <div className="rounded-md border border-border px-3">
              <DetailRow label="章节状态" value={image.hasChapters ? '已关联' : '未关联'} />
              <DetailRow label="章节数量" value={image.chaptersCount ?? 0} />
              <DetailRow label="章节时长" value={formatDuration(image.chaptersDuration)} />
              <DetailRow label="章节文件" value={chapterFileName || '-'} title={image.chaptersPath || undefined} />
            </div>
          </div>

          <div className="border-t pt-4">
            <VideoKeyframePanel imageId={image.id} visible={open} />
          </div>
        </div>
      ) : null}
    </ProDialog>
  )
}
