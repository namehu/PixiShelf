'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup className="gap-4">
            <Field className="gap-2">
              <FieldLabel htmlFor="series-title">标题</FieldLabel>
              <Input
                id="series-title"
                name="series-title"
                autoComplete="off"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </Field>
            <Field className="gap-2">
              <FieldLabel htmlFor="series-description">描述</FieldLabel>
              <Textarea
                id="series-description"
                name="series-description"
                autoComplete="off"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </Field>
            <Field className="gap-2">
              <FieldLabel htmlFor="series-cover-url">封面图 URL</FieldLabel>
              <Input
                id="series-cover-url"
                name="series-cover-url"
                type="url"
                autoComplete="url"
                value={formData.coverImageUrl}
                onChange={(e) => setFormData({ ...formData, coverImageUrl: e.target.value })}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? '提交中…' : '确定'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
