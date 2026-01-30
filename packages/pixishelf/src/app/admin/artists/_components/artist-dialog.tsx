'use client'
import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Loader2 } from 'lucide-react'

interface ArtistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artist?: { id: number } | null // Minimal info needed to trigger fetch
  onSuccess: () => void
}

export function ArtistDialog({ open, onOpenChange, artist, onSuccess }: ArtistDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const isEdit = !!artist

  const [formData, setFormData] = useState({
    name: '',
    username: '',
    userId: '',
    bio: '',
    avatar: '',
    backgroundImg: ''
  })

  // --- Data Fetching for Edit Mode ---
  const { data: fullArtist, isLoading: isLoadingDetail } = useQuery(
    trpc.artist.getById.queryOptions(artist?.id!, {
      enabled: !!artist && open,
      staleTime: 0 // Always fetch fresh data for edit
    })
  )

  // Sync form data when full detail is loaded
  useEffect(() => {
    if (open) {
      if (artist && fullArtist) {
        setFormData({
          name: fullArtist.name,
          username: fullArtist.username || '',
          userId: fullArtist.userId || '',
          bio: fullArtist.bio || '',
          avatar: fullArtist.avatar || '',
          backgroundImg: fullArtist.backgroundImg || ''
        })
      } else if (!artist) {
        // Create mode - reset
        setFormData({
          name: '',
          username: '',
          userId: '',
          bio: '',
          avatar: '',
          backgroundImg: ''
        })
      }
    }
  }, [fullArtist, artist, open])

  // --- Mutations ---
  const updateMutation = useMutation(
    trpc.artist.update.mutationOptions({
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
    trpc.artist.create.mutationOptions({
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
    queryClient.invalidateQueries({ queryKey: trpc.artist.queryPage.queryKey() })
  }

  const handleSubmit = () => {
    const payload = {
      name: formData.name,
      username: formData.name, // 自动使用 name 作为 username
      userId: formData.userId || undefined,
      bio: formData.bio || undefined,
      avatar: formData.avatar,
      backgroundImg: formData.backgroundImg
    }

    if (isEdit && artist) {
      updateMutation.mutate({
        id: artist.id,
        data: payload
      })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isLoading = isEdit ? isLoadingDetail : false
  const isSubmitting = updateMutation.isPending || createMutation.isPending

  return (
    <ProDialog
      title={isEdit ? '编辑艺术家' : '新增艺术家'}
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
          {/* Name */}
          <div className="space-y-2">
            <Label>
              姓名 <span className="text-red-500">*</span>
            </Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="请输入艺术家姓名"
            />
          </div>

          {/* UserID (Pixiv) */}
          <div className="space-y-2">
            <Label>Pixiv UserID</Label>
            <Input
              value={formData.userId}
              onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
              placeholder="请输入 Pixiv UserID（可选，不填将自动生成）"
            />
            <p className="text-xs text-neutral-500">如果不填写，系统将自动生成格式为 p_{'{id}'} 的 ID</p>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label>简介</Label>
            <Textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="请输入艺术家简介（可选）"
              rows={3}
            />
          </div>

          {/* Avatar URL (Temporary text input until upload is ready) */}
          <div className="space-y-2">
            <Label>头像 URL</Label>
            <Input
              value={formData.avatar}
              onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
              placeholder="请输入头像 URL（可选）"
            />
          </div>

          {/* Background URL */}
          <div className="space-y-2">
            <Label>背景图 URL</Label>
            <Input
              value={formData.backgroundImg}
              onChange={(e) => setFormData({ ...formData, backgroundImg: e.target.value })}
              placeholder="请输入背景图 URL（可选）"
            />
          </div>
        </div>
      )}
    </ProDialog>
  )
}
