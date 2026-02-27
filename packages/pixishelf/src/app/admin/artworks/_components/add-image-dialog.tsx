'use client'

import { useState, useEffect } from 'react'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'

interface AddImageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (file: File, order: number) => Promise<void>
  isSubmitting: boolean
  progress: number
  defaultOrder: number
}

export function AddImageDialog({ open, onOpenChange, onSubmit, isSubmitting, progress, defaultOrder }: AddImageDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [order, setOrder] = useState(defaultOrder)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setOrder(defaultOrder)
      setFile(null)
    }
  }, [open, defaultOrder])

  const handleSubmit = async () => {
    if (file) {
      await onSubmit(file, order)
    }
  }

  return (
    <ProDialog
      open={open}
      onOpenChange={(v) => !isSubmitting && onOpenChange(v)}
      title="新增图片"
      onOk={handleSubmit}
      confirmLoading={isSubmitting}
      okButtonProps={{ disabled: !file || isSubmitting }}
      cancelButtonProps={{ disabled: isSubmitting }}
      okText={isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认添加'}
    >
      <div className="space-y-4 py-4">
        <div className="grid w-full max-w-sm items-center gap-1.5">
          <Label htmlFor="picture">图片/视频文件</Label>
          <Input
            id="picture"
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={isSubmitting}
          />
        </div>
        <div className="grid w-full max-w-sm items-center gap-1.5">
          <Label htmlFor="order">排序 (Order)</Label>
          <Input
            id="order"
            type="number"
            value={order}
            onChange={(e) => setOrder(parseInt(e.target.value) || 0)}
            disabled={isSubmitting}
          />
        </div>

        {isSubmitting && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>上传中...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
    </ProDialog>
  )
}
