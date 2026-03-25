'use client'

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ProDatePicker } from '@/components/shared/pro-date-picker'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useRecentTags } from '@/store/admin/useRecentTags'
import { RecentTagsList } from './recent-tags-list'
import { Save } from 'lucide-react'

interface TagItem {
  id: number
  name: string
}

interface ArtworkInfoFormProps {
  data: any // The full artwork data
  onSuccess: () => void
}

export function ArtworkInfoForm({ data, onSuccess }: ArtworkInfoFormProps) {
  const { addTag } = useRecentTags()
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    sourceDate: new Date(),
    artist: null as { id: number; name: string } | null,
    tags: [] as TagItem[]
  })

  useEffect(() => {
    if (data) {
      setFormData({
        title: data.title || '',
        description: data.description || '',
        sourceDate: data.sourceDate ? new Date(data.sourceDate) : new Date(),
        artist: data.artist ? { id: data.artist.id, name: data.artist.name } : null,
        tags: data.tags?.map((t: any) => ({ id: t.id, name: t.name })) || []
      })
    }
  }, [data])

  const updateMutation = useMutation(
    trpc.artwork.update.mutationOptions({
      onSuccess: () => {
        toast.success('更新成功')
        onSuccess()
        queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
      },
      onError: (err) => {
        toast.error(`更新失败: ${err.message}`)
      }
    })
  )

  const handleSubmit = () => {
    if (!formData.title) {
      toast.error('请输入标题')
      return
    }
    if (!formData.artist) {
      toast.error('请选择艺术家')
      return
    }

    const payload = {
      title: formData.title,
      description: formData.description,
      artistId: formData.artist.id,
      tags: formData.tags.map((t) => t.id),
      sourceDate: format(formData.sourceDate, 'yyyy-MM-dd')
    }

    updateMutation.mutate({
      id: data.id,
      data: payload
    })
  }

  const handleSearchArtist = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.artist.queryPage.query({
      cursor: 1,
      pageSize: 20,
      search: value
    })
    return res.data.map((artist) => ({
      value: artist.id.toString(),
      label: artist.name
    }))
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

  const isSubmitting = updateMutation.isPending

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-4 py-2 flex-1 overflow-y-auto px-1">
        <div className="space-y-2">
          <Label>
            标题 <span className="text-red-500">*</span>
          </Label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="请输入作品标题"
          />
        </div>

        <div className="space-y-2">
          <Label>
            艺术家 <span className="text-red-500">*</span>
          </Label>
          <MultipleSelector
            placeholder="搜索并选择艺术家..."
            defaultOptions={
              formData.artist?.id ? [{ value: formData.artist.id.toString(), label: formData.artist.name }] : []
            }
            value={formData.artist ? [{ value: formData.artist.id.toString(), label: formData.artist.name }] : []}
            onSearch={handleSearchArtist}
            onChange={(options) => {
              const selected = options[0]
              setFormData({
                ...formData,
                artist: selected ? { id: parseInt(selected.value), name: selected.label } : null
              })
            }}
            maxSelected={1}
            triggerSearchOnFocus
          />
        </div>

        <div className="space-y-2 flex flex-col">
          <Label>发布日期</Label>
          <ProDatePicker
            mode="single"
            value={formData.sourceDate}
            onChange={(date) => setFormData({ ...formData, sourceDate: date as Date })}
            placeholder="选择发布日期"
            clearable={false}
          />
        </div>

        <div className="space-y-2">
          <Label>标签</Label>
          <MultipleSelector
            placeholder="搜索并添加标签..."
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
        </div>

        <div className="space-y-2">
          <Label>描述</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={5}
            placeholder="作品描述..."
            className="[field-sizing:fixed] min-h-[120px] max-h-[400px] break-all whitespace-pre-wrap"
          />
        </div>
      </div>

      <div className="pt-4 mt-auto border-t">
        <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
          <Save className="w-4 h-4 mr-2" />
          保存更改
        </Button>
      </div>
    </div>
  )
}
