'use client'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { Loader2 } from 'lucide-react'

interface ArtworkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artwork?: { id: number; title: string } | null // Minimal info needed to trigger fetch
  onSuccess: () => void
}

interface TagItem {
  id: number
  name: string
}

export function ArtworkDialog({ open, onOpenChange, artwork, onSuccess }: ArtworkDialogProps) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const isEdit = !!artwork

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    artist: null as { id: number; name: string } | null,
    tags: [] as TagItem[]
  })

  // --- Data Fetching for Edit Mode ---
  const { data: fullArtwork, isLoading: isLoadingDetail } = useQuery(
    trpc.artwork.getById.queryOptions(artwork?.id!, {
      enabled: !!artwork && open,
      staleTime: 0 // Always fetch fresh data for edit
    })
  )

  // Sync form data when full detail is loaded
  useEffect(() => {
    if (open) {
      if (artwork && fullArtwork) {
        setFormData({
          title: fullArtwork.title,
          description: fullArtwork.description || '',
          artist: fullArtwork.artist ? { id: fullArtwork.artist.id, name: fullArtwork.artist.name } : null,
          tags: fullArtwork.tags?.map((t: any) => ({ id: t.id, name: t.name })) || []
        })
      } else if (!artwork) {
        // Create mode - reset
        setFormData({
          title: '',
          description: '',
          artist: null,
          tags: []
        })
      }
    }
  }, [fullArtwork, artwork, open])

  // --- Mutations ---
  const updateMutation = useMutation(
    trpc.artwork.update.mutationOptions({
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
    trpc.artwork.create.mutationOptions({
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
    queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
  }

  const handleSubmit = () => {
    const payload = {
      title: formData.title,
      description: formData.description,
      artistId: formData.artist!.id,
      tags: formData.tags.map((t) => t.id)
    }

    if (isEdit && artwork) {
      updateMutation.mutate({
        id: artwork.id,
        data: payload
      })
    } else {
      createMutation.mutate(payload)
    }
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

  const isLoading = isEdit ? isLoadingDetail : false
  const isSubmitting = updateMutation.isPending || createMutation.isPending

  return (
    <ProDialog
      title={isEdit ? '编辑作品' : '新增作品'}
      open={open}
      width={600}
      onOpenChange={onOpenChange}
      confirmLoading={isSubmitting}
      onOk={handleSubmit}
    >
      {isLoading ? (
        <div className="flex justify-center items-center h-40">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
        </div>
      ) : (
        <div className="space-y-4 py-2">
          {/* Title */}
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

          {/* Artist Selector */}
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
              delay={300}
            />
          </div>

          {/* Tag Selector */}
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
                setFormData({
                  ...formData,
                  tags: options.map((opt) => ({
                    id: parseInt(opt.value),
                    name: opt.label
                  }))
                })
              }}
              triggerSearchOnFocus
              delay={300}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={5}
              placeholder="作品描述..."
            />
          </div>
        </div>
      )}
    </ProDialog>
  )
}
