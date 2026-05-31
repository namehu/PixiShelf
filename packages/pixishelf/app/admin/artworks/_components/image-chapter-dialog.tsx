'use client'

import { useEffect, useState } from 'react'
import { FileIcon, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatFileSize } from '@/utils/media'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { ImageListItem } from './types'

interface ImageChapterDialogProps {
  open: boolean
  mode: 'upload' | 'replace'
  image: ImageListItem | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (file: File) => Promise<void>
}

export function ImageChapterDialog({
  open,
  mode,
  image,
  isSubmitting,
  onOpenChange,
  onSubmit
}: ImageChapterDialogProps) {
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
    }
  }, [open, image?.id, mode])

  const handleSubmit = async () => {
    if (!file) {
      return
    }

    await onSubmit(file)
  }

  return (
    <ProDialog
      open={open}
      onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}
      title={mode === 'replace' ? '替换章节' : '上传章节'}
      description={image ? `为 ${image.path.split('/').pop()} 管理章节文件` : '管理章节文件'}
      onOk={handleSubmit}
      confirmLoading={isSubmitting}
      okText={isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'replace' ? '确认替换' : '确认上传'}
      okButtonProps={{ disabled: !file || isSubmitting }}
      cancelButtonProps={{ disabled: isSubmitting }}
    >
      <div className="space-y-4 py-2">
        {image && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">{image.path.split('/').pop()}</div>
            <div className="mt-1 text-xs text-muted-foreground">{image.path}</div>
          </div>
        )}

        <div className="grid w-full items-center gap-1.5">
          <Label htmlFor="chapter-manifest-file">章节文件</Label>
          {file ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/50 p-2">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-background">
                  <FileIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 hover:text-destructive"
                onClick={() => setFile(null)}
                disabled={isSubmitting}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Input
              id="chapter-manifest-file"
              type="file"
              accept=".json,application/json"
              disabled={isSubmitting}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null
                if (nextFile && !isChapterManifestFileName(nextFile.name)) {
                  toast.error('请选择以 .chapters.json 或 ..chapters.json 结尾的章节文件')
                  event.target.value = ''
                  return
                }
                setFile(nextFile)
              }}
            />
          )}
          <p className="text-xs text-muted-foreground">仅支持 `.chapters.json` 或 `..chapters.json` 命名。</p>
        </div>
      </div>
    </ProDialog>
  )
}
