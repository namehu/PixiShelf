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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'

interface ArtistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artist?: { id: number } | null // 仅用于触发查询的最小字段
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
    pixivUserId: '',
    bio: '',
    avatar: '',
    backgroundImg: ''
  })
  const [pixivIdentityTouched, setPixivIdentityTouched] = useState(false)
  const [avatarTouched, setAvatarTouched] = useState(false)
  const [backgroundTouched, setBackgroundTouched] = useState(false)

  // --- 编辑模式下加载详情 ---
  const { data: fullArtist, isLoading: isLoadingDetail } = useQuery(
    trpc.artist.getById.queryOptions(artist?.id ?? 0, {
      enabled: !!artist && open,
      staleTime: 0 // 编辑态总是拉取最新数据
    })
  )

  // 详情加载完成后同步到表单字段
  useEffect(() => {
    if (open) {
      if (artist && fullArtist) {
        setFormData({
          name: fullArtist.name,
          username: fullArtist.username || '',
          pixivUserId: fullArtist.pixivUserId || '',
          bio: fullArtist.bio || '',
          avatar: fullArtist.avatar || '',
          backgroundImg: fullArtist.backgroundImg || ''
        })
        setPixivIdentityTouched(false)
        setAvatarTouched(false)
        setBackgroundTouched(false)
      } else if (!artist) {
        // 新增模式：重置为默认空值
        setFormData({
          name: '',
          username: '',
          pixivUserId: '',
          bio: '',
          avatar: '',
          backgroundImg: ''
        })
        setPixivIdentityTouched(false)
        setAvatarTouched(false)
        setBackgroundTouched(false)
      }
    }
  }, [fullArtist, artist, open])

  // --- 数据提交动作 ---
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
      username: formData.name.trim(),
      bio: formData.bio || undefined,
      ...(!isEdit || pixivIdentityTouched
        ? { pixivUserId: formData.pixivUserId.trim() ? formData.pixivUserId.trim() : null }
        : {}),
      ...(!isEdit || avatarTouched ? { avatar: formData.avatar || null } : {}),
      ...(!isEdit || backgroundTouched ? { backgroundImg: formData.backgroundImg || null } : {})
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
  const ambiguousLegacyPixivId = isEdit && !fullArtist?.pixivUserId && /^[1-9][0-9]*$/.test(fullArtist?.userId ?? '')
  const confirmedPixivIdentityChange =
    isEdit &&
    pixivIdentityTouched &&
    Boolean(fullArtist?.pixivUserId) &&
    formData.pixivUserId.trim() !== fullArtist?.pixivUserId &&
    Boolean(fullArtist?.avatar || fullArtist?.backgroundImg)

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
          {/* 名称 */}
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

          {/* Pixiv 用户 ID */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-pixiv-user-id">Pixiv UserID</FieldLabel>
            <Input
              id="artist-pixiv-user-id"
              name="artist-pixiv-user-id"
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              value={formData.pixivUserId}
              onChange={(e) => {
                setPixivIdentityTouched(true)
                setFormData({ ...formData, pixivUserId: e.target.value })
              }}
              placeholder="请输入已确认的 Pixiv UserID（可选）"
            />
            <FieldDescription className="text-xs">
              留空表示不绑定 Pixiv；新建艺术家不会再生成历史 p_ ID。
            </FieldDescription>
          </Field>

          {ambiguousLegacyPixivId && !pixivIdentityTouched ? (
            <Alert variant="warning">
              <Info aria-hidden="true" />
              <AlertTitle>发现未确认的历史 ID</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>旧字段中保存了 {fullArtist?.userId}，但缺少 Pixiv 来源证据，系统不会自动认领。</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFormData((current) => ({ ...current, pixivUserId: fullArtist?.userId ?? '' }))
                    setPixivIdentityTouched(true)
                  }}
                >
                  确认它是 Pixiv UserID
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {confirmedPixivIdentityChange ? (
            <Alert variant="warning">
              <Info aria-hidden="true" />
              <AlertTitle>现有图片属于原 Pixiv 身份</AlertTitle>
              <AlertDescription>
                更换或移除 Pixiv UserID 前，请在下方显式清空头像和背景图，或重新填写仍应保留的图片地址。
              </AlertDescription>
            </Alert>
          ) : null}

          {/* 简介 */}
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

          {/* 头像地址（上传功能就绪前暂用文本输入） */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-avatar-url">头像 URL</FieldLabel>
            <Input
              id="artist-avatar-url"
              name="artist-avatar-url"
              type="url"
              autoComplete="url"
              value={formData.avatar}
              onChange={(e) => {
                setAvatarTouched(true)
                setFormData({ ...formData, avatar: e.target.value })
              }}
              placeholder="请输入头像 URL（可选）"
            />
          </Field>

          {/* 背景图地址 */}
          <Field className="gap-2">
            <FieldLabel htmlFor="artist-background-url">背景图 URL</FieldLabel>
            <Input
              id="artist-background-url"
              name="artist-background-url"
              type="url"
              autoComplete="url"
              value={formData.backgroundImg}
              onChange={(e) => {
                setBackgroundTouched(true)
                setFormData({ ...formData, backgroundImg: e.target.value })
              }}
              placeholder="请输入背景图 URL（可选）"
            />
          </Field>
        </FieldGroup>
      )}
    </ProDialog>
  )
}
