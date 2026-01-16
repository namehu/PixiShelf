'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface SeriesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  series?: { id: number; title: string; description?: string | null; coverImageUrl?: string | null } | null
  onSuccess: () => void
}

export function SeriesDialog({ open, onOpenChange, series, onSuccess }: SeriesDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    coverImageUrl: ''
  })

  useEffect(() => {
    if (series) {
      setFormData({
        title: series.title,
        description: series.description || '',
        coverImageUrl: series.coverImageUrl || ''
      })
    } else {
      setFormData({ title: '', description: '', coverImageUrl: '' })
    }
  }, [series, open])

  const createMutation = useMutation(
    trpc.series.create.mutationOptions({
      onSuccess: () => {
        toast.success('创建成功')
        onSuccess()
        onOpenChange(false)
        queryClient.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
      }
    })
  )

  const updateMutation = useMutation(
    trpc.series.update.mutationOptions({
      onSuccess: () => {
        toast.success('更新成功')
        onSuccess()
        onOpenChange(false)
        queryClient.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
      }
    })
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (series) {
      updateMutation.mutate({
        id: series.id,
        data: formData
      })
    } else {
      createMutation.mutate(formData)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{series ? '编辑系列' : '创建系列'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>标题</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>封面图 URL</Label>
            <Input
              value={formData.coverImageUrl}
              onChange={(e) => setFormData({ ...formData, coverImageUrl: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? '提交中...' : '确定'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
