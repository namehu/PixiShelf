'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Loader2 } from 'lucide-react'

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag?: {
    id: number
    name: string
    name_zh?: string | null
    name_en?: string | null
    description?: string | null
  } | null
  onSuccess: () => void
}

export function TagDialog({ open, onOpenChange, tag, onSuccess }: TagDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const isEdit = !!tag

  const [formData, setFormData] = useState({
    name: '',
    name_zh: '',
    name_en: '',
    description: ''
  })

  // Sync form data
  useEffect(() => {
    if (open) {
      if (tag) {
        setFormData({
          name: tag.name,
          name_zh: tag.name_zh || '',
          name_en: tag.name_en || '',
          description: tag.description || ''
        })
      } else {
        // Create mode - reset
        setFormData({
          name: '',
          name_zh: '',
          name_en: '',
          description: ''
        })
      }
    }
  }, [tag, open])

  // --- Mutations ---
  const updateMutation = useMutation(
    trpc.tag.update.mutationOptions({
      onSuccess: () => {
        toast.success('更新成功')
        handleSuccess()
      },
      onError: (err) => {
        toast.error(`更新失败: ${err.message}`)
      }
    })
  )

  const createMutation = useMutation(
    trpc.tag.create.mutationOptions({
      onSuccess: () => {
        toast.success('创建成功')
        handleSuccess()
      },
      onError: (err) => {
        toast.error(`创建失败: ${err.message}`)
      }
    })
  )

  const handleSuccess = () => {
    onSuccess()
    onOpenChange(false)
    queryClient.invalidateQueries({ queryKey: trpc.tag.management.queryKey() })
  }

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error('请输入标签名称')
      return
    }

    const payload = {
      name: formData.name.trim(),
      name_zh: formData.name_zh.trim() || undefined,
      name_en: formData.name_en.trim() || undefined,
      description: formData.description.trim() || undefined
    }

    if (isEdit && tag) {
      updateMutation.mutate({
        id: tag.id,
        data: payload
      })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSubmitting = updateMutation.isPending || createMutation.isPending

  return (
    <ProDialog
      title={isEdit ? '编辑标签' : '新增标签'}
      open={open}
      width={500}
      onOpenChange={onOpenChange}
      confirmLoading={isSubmitting}
      onOk={handleSubmit}
    >
      <div className="space-y-4 py-2">
        {/* Name */}
        <div className="space-y-2">
          <Label>
            标签名称 <span className="text-red-500">*</span>
          </Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="请输入标签名称"
            autoFocus
          />
        </div>

        {/* Chinese Name */}
        <div className="space-y-2">
          <Label>中文翻译</Label>
          <Input
            value={formData.name_zh}
            onChange={(e) => setFormData({ ...formData, name_zh: e.target.value })}
            placeholder="请输入中文翻译（可选）"
          />
        </div>

        {/* English Name */}
        <div className="space-y-2">
          <Label>英文翻译</Label>
          <Input
            value={formData.name_en}
            onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
            placeholder="请输入英文翻译（可选）"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label>描述</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="请输入标签描述（可选）"
            rows={3}
          />
        </div>
      </div>
    </ProDialog>
  )
}
