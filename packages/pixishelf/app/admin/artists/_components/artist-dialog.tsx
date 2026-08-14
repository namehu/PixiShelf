'use client'
import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Spinner } from '@/components/ui/spinner'

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
  const nameInputRef = useRef<HTMLInputElement>(null)

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
    trpc.artist.getById.queryOptions(artist?.id ?? 0, {
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
    if (!formData.name.trim()) {
      toast.error('请输入艺术家姓名')
      nameInputRef.current?.focus()
      return
    }
    const payload = {
      name: formData.name.trim(),
      username: formData.name.trim(), // 自动使用 name 作为 username
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
          <Spinner className="size-8 text-muted-foreground" aria-label="正在加载艺术家信息" />
        </div>
      ) : (
        <FieldGroup className="gap-4 py-2">
          {/* Name */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-name">
              姓名 <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              ref={nameInputRef}
              id="artist-name"
              name="artist-name"
              autoComplete="off"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="请输入艺术家姓名"
            />
          </Field>

          {/* UserID (Pixiv) */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-pixiv-user-id">Pixiv UserID</FieldLabel>
            <Input
              id="artist-pixiv-user-id"
              name="artist-pixiv-user-id"
              autoComplete="off"
              value={formData.userId}
              onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
              placeholder="请输入 Pixiv UserID（可选，不填将自动生成）"
            />
            <FieldDescription className="text-xs">如果不填写，系统将自动生成格式为 p_{'{id}'} 的 ID</FieldDescription>
          </Field>

          {/* Bio */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-bio">简介</FieldLabel>
            <Textarea
              id="artist-bio"
              name="artist-bio"
              autoComplete="off"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="请输入艺术家简介（可选）"
              rows={3}
            />
          </Field>

          {/* Avatar URL (Temporary text input until upload is ready) */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-avatar-url">头像 URL</FieldLabel>
            <Input
              id="artist-avatar-url"
              name="artist-avatar-url"
              type="url"
              autoComplete="url"
              value={formData.avatar}
              onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
              placeholder="请输入头像 URL（可选）"
            />
          </Field>

          {/* Background URL */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-background-url">背景图 URL</FieldLabel>
            <Input
              id="artist-background-url"
              name="artist-background-url"
              type="url"
              autoComplete="url"
              value={formData.backgroundImg}
              onChange={(e) => setFormData({ ...formData, backgroundImg: e.target.value })}
              placeholder="请输入背景图 URL（可选）"
            />
          </Field>
        </FieldGroup>
      )}
    </ProDialog>
  )
}
