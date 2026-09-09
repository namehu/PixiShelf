'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProDatePicker } from '@/components/shared/pro-date-picker'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useRecentTags } from '@/store/admin/use-recent-tags'
import { RecentTagsList } from './recent-tags-list'
import { Save } from 'lucide-react'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ESource } from '@/enums/e-source'
import { CreatorPicker } from '@/components/creators/creator-picker'
import Link from 'next/link'

export interface TagItem {
  id: number
  name: string
}

interface ArtworkInfoFormProps {
  data?: ArtworkResponseDto | null
  initialData?: ArtworkInfoFormInitialData | null
  onSuccess: (data?: ArtworkResponseDto) => void
}

export interface ArtworkInfoFormInitialData {
  title?: string | null
  description?: string | null
  sourceDate?: string | Date | null
  creators?: { id: number; name: string }[]
  artist?: { id: number; name: string } | null
  tags?: TagItem[]
}

function createEmptyFormData() {
  return {
    title: '',
    description: '',
    sourceDate: undefined as Date | undefined,
    creators: [] as { id: number; name: string }[],
    tags: [] as TagItem[]
  }
}

function parseSourceDate(value?: string | Date | null) {
  if (!value) return undefined
  if (value instanceof Date) return value

  const datePart = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (datePart) {
    const [, year, month, day] = datePart
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  return new Date(value)
}

function createFormDataFromInitialData(initialData?: ArtworkInfoFormInitialData | null) {
  if (!initialData) {
    return createEmptyFormData()
  }

  return {
    title: initialData.title || '',
    description: initialData.description || '',
    sourceDate: parseSourceDate(initialData.sourceDate),
    creators: initialData.creators ?? (initialData.artist ? [initialData.artist] : []),
    tags: initialData.tags?.map((t) => ({ id: t.id, name: t.name })) || []
  }
}

export function ArtworkInfoForm({ data, initialData, onSuccess }: ArtworkInfoFormProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { addTag } = useRecentTags()
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState(() => createFormDataFromInitialData(initialData))

  useEffect(() => {
    if (data) {
      setFormData({
        title: data.title || '',
        description: data.description || '',
        sourceDate: parseSourceDate(data.sourceDate),
        creators: data.creators ?? (data.artist ? [data.artist] : []),
        tags: data.tags?.map((t: any) => ({ id: t.id, name: t.name })) || []
      })
      return
    }

    setFormData(createFormDataFromInitialData(initialData))
  }, [data, initialData])

  const updateMutation = useMutation(
    trpc.artwork.update.mutationOptions({
      onSuccess: () => {
        toast.success('更新成功')
        onSuccess()
        queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
      },
      onError: (err) => {
        toast.error(`更新失败: ${err.message}`)
      }
    })
  )

  const createMutation = useMutation(
    trpc.artwork.create.mutationOptions({
      onSuccess: (createdArtwork) => {
        toast.success('创建成功')
        onSuccess(createdArtwork)
        queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
        queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
      },
      onError: (err) => {
        toast.error(`创建失败: ${err.message}`)
      }
    })
  )

  const handleSubmit = () => {
    if (!formData.title) {
      toast.error('请输入标题')
      titleInputRef.current?.focus()
      return
    }

    const payload = {
      title: formData.title,
      description: formData.description,
      creatorIds: formData.creators.map((creator) => creator.id),
      tags: formData.tags.map((t) => t.id),
      sourceDate: formData.sourceDate ? format(formData.sourceDate, 'yyyy-MM-dd') : null
    }

    if (data?.id) {
      updateMutation.mutate({
        id: data.id,
        data: payload
      })
      return
    }

    createMutation.mutate({
      ...payload,
      source: ESource.LOCAL_CREATED
    })
  }

  const handleSearchTag = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.tag.list.query({
      cursor: 1,
      pageSize: 20,
      mode: 'popular',
      query: value
    })
    return res.items.map((tag) => ({
      value: tag.id.toString(),
      label: tag.name
    }))
  }

  const isSubmitting = updateMutation.isPending || createMutation.isPending

  return (
    <div className="flex flex-col h-full">
      {data?.id && (
        <Button type="button" variant="outline" asChild>
          <Link href={'/admin/artists/relations?artwork=' + data.id} target="_blank" rel="noopener noreferrer">
            打开作者与系列检查页面
          </Link>
        </Button>
      )}
      <FieldGroup className="flex-1 gap-4 overflow-y-auto px-1 py-2">
        <Field className="gap-2">
          <FieldLabel htmlFor="artwork-title">
            标题 <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            ref={titleInputRef}
            id="artwork-title"
            name="artwork-title"
            autoComplete="off"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="请输入作品标题"
          />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="artwork-artist">艺术家／社团</FieldLabel>
          <CreatorPicker value={formData.creators} onChange={(creators) => setFormData({ ...formData, creators })} />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="artwork-source-date">发布日期</FieldLabel>
          <ProDatePicker
            id="artwork-source-date"
            aria-label="发布日期"
            mode="single"
            value={formData.sourceDate}
            onChange={(date) => setFormData({ ...formData, sourceDate: date as Date | undefined })}
            placeholder="选择发布日期"
            clearable
          />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="artwork-tags">标签</FieldLabel>
          <MultipleSelector
            inputProps={{
              id: 'artwork-tags',
              name: 'artwork-tags',
              autoComplete: 'off',
              'aria-label': '搜索并添加标签'
            }}
            placeholder="搜索并添加标签…"
            defaultOptions={formData.tags.map((t) => ({
              value: t.id.toString(),
              label: t.name
            }))}
            value={formData.tags.map((t) => ({
              value: t.id.toString(),
              label: t.name
            }))}
            onSearch={handleSearchTag}
            onChange={(options) => {
              options.forEach((opt) => {
                if (!formData.tags.some((t) => t.id.toString() === opt.value)) {
                  addTag({ value: opt.value, label: opt.label })
                }
              })
              setFormData({
                ...formData,
                tags: options.map((opt) => ({
                  id: parseInt(opt.value),
                  name: opt.label
                }))
              })
            }}
            triggerSearchOnFocus
          />
          <RecentTagsList
            selectedValues={formData.tags.map((t) => t.id.toString())}
            onSelect={(tag) => {
              const newTag = { id: parseInt(tag.value), name: tag.label }
              setFormData({
                ...formData,
                tags: [...formData.tags, newTag]
              })
            }}
          />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="artwork-description">描述</FieldLabel>
          <Textarea
            id="artwork-description"
            name="artwork-description"
            autoComplete="off"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={5}
            placeholder="作品描述…"
            className="[field-sizing:fixed] min-h-[120px] max-h-[400px] break-all whitespace-pre-wrap"
          />
        </Field>
      </FieldGroup>

      <div className="pt-4 mt-auto border-t">
        <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
          <Save data-icon="inline-start" aria-hidden="true" />
          {data?.id ? '保存更改' : '创建作品'}
        </Button>
      </div>
    </div>
  )
}
