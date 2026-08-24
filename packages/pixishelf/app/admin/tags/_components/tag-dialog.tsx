'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag?: {
    id: number
    name: string
    isSystem?: boolean
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
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    name: '',
    name_zh: '',
    name_en: '',
    description: ''
  })

  // 同步表单数据（区分编辑和新增）
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
        // 新增模式：重置为默认空值
        setFormData({
          name: '',
          name_zh: '',
          name_en: '',
          description: ''
        })
      }
    }
  }, [tag, open])

  // --- 变更提交 ---
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
      nameInputRef.current?.focus()
      return
    }

    const name = formData.name.trim()
    const nameZh = formData.name_zh.trim() || null
    const nameEn = formData.name_en.trim() || null
    const description = formData.description.trim() || null

    if (isEdit && tag) {
      const data: {
        name?: string
        name_zh?: string | null
        name_en?: string | null
        description?: string | null
      } = {}
      if (!tag.isSystem && name !== tag.name) data.name = name
      if (nameZh !== normalizeExisting(tag.name_zh)) data.name_zh = nameZh
      if (nameEn !== normalizeExisting(tag.name_en)) data.name_en = nameEn
      if (description !== normalizeExisting(tag.description)) data.description = description
      if (Object.keys(data).length === 0) {
        toast.info('没有需要保存的更改')
        return
      }
      updateMutation.mutate({
        id: tag.id,
        data
      })
    } else {
      createMutation.mutate({ name, name_zh: nameZh, name_en: nameEn, description })
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
      <FieldGroup className="gap-4 py-2">
        {/* 标签名 */}
        <Field className="gap-2" data-disabled={tag?.isSystem || undefined}>
          <FieldLabel htmlFor="tag-name">
            标签名称 <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            ref={nameInputRef}
            id="tag-name"
            name="tag-name"
            autoComplete="off"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="请输入标签名称"
            disabled={Boolean(tag?.isSystem)}
          />
          {tag?.isSystem && (
            <FieldDescription className="text-xs">系统标签名称由程序维护，不允许修改。</FieldDescription>
          )}
        </Field>

        {/* 中文名称 */}
        <Field className="gap-2">
          <FieldLabel htmlFor="tag-name-zh">中文翻译</FieldLabel>
          <Input
            id="tag-name-zh"
            name="tag-name-zh"
            autoComplete="off"
            value={formData.name_zh}
            onChange={(e) => setFormData({ ...formData, name_zh: e.target.value })}
            placeholder="请输入中文翻译（可选）"
          />
        </Field>

        {/* 英文名称 */}
        <Field className="gap-2">
          <FieldLabel htmlFor="tag-name-en">英文翻译</FieldLabel>
          <Input
            id="tag-name-en"
            name="tag-name-en"
            autoComplete="off"
            value={formData.name_en}
            onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
            placeholder="请输入英文翻译（可选）"
          />
        </Field>

        {/* 描述 */}
        <Field className="gap-2">
          <FieldLabel htmlFor="tag-description">描述</FieldLabel>
          <Textarea
            id="tag-description"
            name="tag-description"
            autoComplete="off"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="请输入标签描述（可选）"
            rows={3}
          />
        </Field>
      </FieldGroup>
    </ProDialog>
  )
}

function normalizeExisting(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}
