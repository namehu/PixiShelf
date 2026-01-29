'use client'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'

interface ArtworkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artwork?: { id: number; title: string; description?: string | null } | null
  onSuccess: () => void
}

export function ArtworkDialog({ open, onOpenChange, artwork, onSuccess }: ArtworkDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState({
    title: '',
    description: ''
  })

  useEffect(() => {
    if (artwork) {
      setFormData({
        title: artwork.title,
        description: artwork.description || ''
      })
    } else {
      setFormData({ title: '', description: '' })
    }
  }, [artwork, open])

  const updateMutation = useMutation(
    trpc.artwork.update.mutationOptions({
      onSuccess: () => {
        toast.success('更新成功')
        onSuccess()
        onOpenChange(false)
        queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
      }
    })
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (artwork) {
      updateMutation.mutate({
        id: artwork.id,
        data: formData
      })
    }
  }

  return (
    <ProDialog
      title={artwork ? '编辑作品' : '查看作品'}
      open={open}
      onOpenChange={onOpenChange}
      confirmLoading={updateMutation.isPending}
      onOk={handleSubmit}
    >
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
      </form>
    </ProDialog>
  )
}
