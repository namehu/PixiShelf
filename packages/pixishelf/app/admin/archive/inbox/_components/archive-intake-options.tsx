'use client'

import { useId, useState } from 'react'
import { Settings2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ArchiveDownloadMode, ArchiveQuality } from '../../_components/archive-intake-view-state'

export interface ArchiveIntakeOptionsValue {
  downloadMode: ArchiveDownloadMode
  quality: ArchiveQuality
}

export const DEFAULT_ARCHIVE_INTAKE_OPTIONS: ArchiveIntakeOptionsValue = {
  downloadMode: 'AUTO',
  quality: 'ORIGINAL'
}

export function archiveIntakeOptionsSummary(value: ArchiveIntakeOptionsValue) {
  return `${value.downloadMode === 'AUTO' ? '自动下载' : '仅解析'} · ${value.quality === 'ORIGINAL' ? '原图' : '展示图'}`
}

export function ArchiveIntakeOptionsDialog({
  value,
  onChange,
  disabled = false
}: {
  value: ArchiveIntakeOptionsValue
  onChange: (value: ArchiveIntakeOptionsValue) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const summary = archiveIntakeOptionsSummary(value)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-sm:size-8 max-sm:p-0"
        aria-label={summary}
        title={summary}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Settings2Icon aria-hidden="true" />
        <span className="hidden sm:inline">{summary}</span>
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>加入收件箱设置</DialogTitle>
          <DialogDescription>这里的模式与画质会用于当前勾选和单项加入操作。</DialogDescription>
        </DialogHeader>
        <ArchiveIntakeOptions value={value} onChange={onChange} disabled={disabled} />
        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ArchiveIntakeOptions({
  value,
  onChange,
  disabled = false
}: {
  value: ArchiveIntakeOptionsValue
  onChange: (value: ArchiveIntakeOptionsValue) => void
  disabled?: boolean
}) {
  const id = useId()

  return (
    <FieldGroup className="gap-4">
      <FieldGroup className="gap-4 sm:flex-row">
        <Field data-disabled={disabled || undefined}>
          <FieldLabel id={`${id}-mode`}>加入后</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.downloadMode}
            onValueChange={(downloadMode) => {
              if (downloadMode === 'AUTO' || downloadMode === 'MANUAL') onChange({ ...value, downloadMode })
            }}
            disabled={disabled}
            aria-labelledby={`${id}-mode`}
            aria-describedby={`${id}-description`}
          >
            <ToggleGroupItem value="AUTO" className="min-h-11 sm:min-h-9">
              自动下载
            </ToggleGroupItem>
            <ToggleGroupItem value="MANUAL" className="min-h-11 sm:min-h-9">
              仅解析
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field data-disabled={disabled || undefined}>
          <FieldLabel id={`${id}-quality`}>下载画质</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={value.quality}
            onValueChange={(quality) => {
              if (quality === 'ORIGINAL' || quality === 'DISPLAY') onChange({ ...value, quality })
            }}
            disabled={disabled}
            aria-labelledby={`${id}-quality`}
          >
            <ToggleGroupItem value="ORIGINAL" className="min-h-11 sm:min-h-9">
              原图
            </ToggleGroupItem>
            <ToggleGroupItem value="DISPLAY" className="min-h-11 sm:min-h-9">
              展示图
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </FieldGroup>
      <FieldDescription id={`${id}-description`}>
        {value.downloadMode === 'AUTO'
          ? '新作品解析后自动下载；已有作品有变化时等待确认，未变化则跳过。'
          : '只解析作品信息；完成后在收件箱选择项目并确认下载。'}
        {value.quality === 'ORIGINAL' ? '原图不可用时暂停，保留你的画质选择。' : null}
      </FieldDescription>
    </FieldGroup>
  )
}
