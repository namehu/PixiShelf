'use client'

import { useEffect, useRef, useState } from 'react'
import { useAction } from 'next-safe-action/hooks'
import { toast } from 'sonner'
import { z } from 'zod'
import { updateProfileAction } from '@/actions/user-setting-action'
import { useAuthStore, useAuthUser } from '@/components/auth'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { updateProfileSchema } from '@/schemas/user-setting.dto'

interface ProfileErrors {
  name?: string
  image?: string
}

export function ProfileForm() {
  const user = useAuthUser()
  const setUser = useAuthStore((state) => state.setUser)
  const [name, setName] = useState(user?.name ?? '')
  const [image, setImage] = useState(user?.image ?? '')
  const [errors, setErrors] = useState<ProfileErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(user?.name ?? '')
    setImage(user?.image ?? '')
  }, [user?.image, user?.name])

  const { execute, isExecuting } = useAction(updateProfileAction, {
    onSuccess: ({ data }) => {
      if (data) {
        setUser({
          id: String(data.id),
          name: data.name ?? null,
          email: data.email ?? null,
          image: data.image ?? null
        })
      }
      toast.success('资料已更新')
    },
    onError: ({ error }) => {
      const fieldErrors = error.validationErrors?.fieldErrors || {}
      setErrors({ name: fieldErrors.name?.[0], image: fieldErrors.image?.[0] })
      if (fieldErrors.name?.[0]) nameRef.current?.focus()
      else if (fieldErrors.image?.[0]) imageRef.current?.focus()
      const formError = error.validationErrors?.formErrors?.[0] || error.serverError
      if (formError) toast.error(formError)
    }
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})

    const result = updateProfileSchema.safeParse({ name: name.trim(), image: image.trim() || null })
    if (!result.success) {
      const fieldErrors = z.flattenError(result.error).fieldErrors as Partial<Record<keyof ProfileErrors, string[]>>
      setErrors({ name: fieldErrors.name?.[0], image: fieldErrors.image?.[0] })
      if (fieldErrors.name?.[0]) nameRef.current?.focus()
      else if (fieldErrors.image?.[0]) imageRef.current?.focus()
      return
    }

    execute(result.data)
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-7" noValidate>
      <SectionHeader title="个人资料" description="更新在 PixiShelf 中显示的昵称与头像地址。" />

      <FieldGroup className="max-w-xl gap-5">
        <Field data-invalid={!!errors.name} data-disabled={isExecuting || undefined}>
          <FieldLabel htmlFor="profile-name">昵称</FieldLabel>
          <Input
            ref={nameRef}
            id="profile-name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }))
            }}
            placeholder="输入昵称…"
            maxLength={64}
            autoComplete="name"
            disabled={isExecuting}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'profile-name-error' : undefined}
          />
          <FieldError id="profile-name-error">{errors.name}</FieldError>
        </Field>

        <Field data-invalid={!!errors.image} data-disabled={isExecuting || undefined}>
          <FieldLabel htmlFor="profile-image">头像地址</FieldLabel>
          <Input
            ref={imageRef}
            id="profile-image"
            name="image"
            type="url"
            value={image}
            onChange={(event) => {
              setImage(event.target.value)
              if (errors.image) setErrors((current) => ({ ...current, image: undefined }))
            }}
            placeholder="https://example.com/avatar.jpg…"
            autoComplete="url"
            spellCheck={false}
            disabled={isExecuting}
            aria-invalid={!!errors.image}
            aria-describedby={
              errors.image ? 'profile-image-description profile-image-error' : 'profile-image-description'
            }
          />
          <p id="profile-image-description" className="text-xs text-muted-foreground">
            留空会继续使用昵称首字母作为头像。
          </p>
          <FieldError id="profile-image-error">{errors.image}</FieldError>
        </Field>
      </FieldGroup>

      <dl className="max-w-xl border-y border-border py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-muted-foreground">登录邮箱</dt>
          <dd className="font-utility break-all text-foreground">{user?.email || '未绑定'}</dd>
        </div>
      </dl>

      <Button type="submit" disabled={isExecuting}>
        {isExecuting && <Spinner data-icon="inline-start" aria-label="正在保存资料" />}
        {isExecuting ? '保存中…' : '保存资料'}
      </Button>
    </form>
  )
}
