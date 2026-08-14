'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAction } from 'next-safe-action/hooks'
import { CircleAlertIcon, LockKeyholeIcon, LogInIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { changePasswordAction } from '@/actions/auth-action'
import { useAuth } from '@/components/auth'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PageState } from '@/components/layout/page-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { ROUTES } from '@/lib/constants'
import { changePasswordSchema } from '@/schemas/users.dto'

interface PasswordErrors {
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
  general?: string
}

function getPasswordStrength(password: string) {
  if (password.length < 6) return { value: 33, tone: 'weak' as const, text: '至少需要 6 个字符' }
  if (password.length >= 8 && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return { value: 100, tone: 'strong' as const, text: '强度较高' }
  }
  return { value: 66, tone: 'medium' as const, text: '强度中等' }
}

export default function ChangePasswordPage() {
  const router = useRouter()
  const { logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [success, setSuccess] = useState(false)
  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    },
    []
  )

  const { execute, isExecuting } = useAction(changePasswordAction, {
    onSuccess: () => {
      setSuccess(true)
      toast.success('密码修改成功，请重新登录')
      redirectTimerRef.current = setTimeout(async () => {
        await logout()
        router.push(ROUTES.LOGIN)
      }, 1500)
    },
    onError: ({ error }) => {
      const fieldErrors = error.validationErrors?.fieldErrors || {}
      const nextErrors: PasswordErrors = {
        currentPassword: fieldErrors.currentPassword?.[0],
        newPassword: fieldErrors.newPassword?.[0],
        general: error.validationErrors?.formErrors?.[0] || error.serverError || '密码修改失败，请稍后重试。'
      }
      setErrors(nextErrors)
      if (nextErrors.currentPassword) currentPasswordRef.current?.focus()
      else if (nextErrors.newPassword) newPasswordRef.current?.focus()
    }
  })

  const passwordStrength = getPasswordStrength(newPassword)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})

    const result = changePasswordSchema.safeParse({ currentPassword, newPassword })
    if (!result.success) {
      const fieldErrors = z.flattenError(result.error).fieldErrors as Partial<
        Record<'currentPassword' | 'newPassword', string[]>
      >
      setErrors({
        currentPassword: fieldErrors.currentPassword?.[0],
        newPassword: fieldErrors.newPassword?.[0]
      })
      if (fieldErrors.currentPassword?.[0]) currentPasswordRef.current?.focus()
      else if (fieldErrors.newPassword?.[0]) newPasswordRef.current?.focus()
      return
    }

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: '两次输入的新密码不一致。' })
      confirmPasswordRef.current?.focus()
      return
    }

    execute(result.data)
  }

  const handleReLogin = async () => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    await logout()
    router.push(ROUTES.LOGIN)
  }

  if (success) {
    return (
      <PageContainer as="main" size="reading" className="flex min-h-[calc(100dvh-4rem)] items-center py-12">
        <PageState
          variant="empty"
          headingLevel="h1"
          icon={<LogInIcon aria-hidden="true" />}
          title="密码修改成功"
          description="密码已经更新。为保护账户安全，请使用新密码重新登录。"
          action={
            <>
              <Button size="lg" onClick={handleReLogin}>
                重新登录
              </Button>
              <Button size="lg" variant="outline" onClick={() => router.back()}>
                返回
              </Button>
            </>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer as="main" size="reading" className="flex min-h-[calc(100dvh-4rem)] flex-col gap-8 py-8 sm:py-12">
      <PageHeader
        eyebrow="账户安全"
        title="修改密码"
        description="输入当前密码，并设置一个仅用于 PixiShelf 的新密码。保存后需要重新登录。"
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-7" noValidate>
        <FieldGroup className="gap-5">
          <Field data-invalid={!!errors.currentPassword} data-disabled={isExecuting || undefined}>
            <FieldLabel htmlFor="current-password">当前密码</FieldLabel>
            <InputGroup data-disabled={isExecuting || undefined}>
              <InputGroupAddon>
                <LockKeyholeIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                ref={currentPasswordRef}
                id="current-password"
                name="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                  if (errors.currentPassword) setErrors((current) => ({ ...current, currentPassword: undefined }))
                }}
                placeholder="输入当前密码…"
                autoComplete="current-password"
                required
                disabled={isExecuting}
                aria-invalid={!!errors.currentPassword}
                aria-describedby={errors.currentPassword ? 'current-password-error' : undefined}
              />
            </InputGroup>
            <FieldError id="current-password-error">{errors.currentPassword}</FieldError>
          </Field>

          <Field data-invalid={!!errors.newPassword} data-disabled={isExecuting || undefined}>
            <FieldLabel htmlFor="new-password">新密码</FieldLabel>
            <InputGroup data-disabled={isExecuting || undefined}>
              <InputGroupAddon>
                <LockKeyholeIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                ref={newPasswordRef}
                id="new-password"
                name="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  if (errors.newPassword) setErrors((current) => ({ ...current, newPassword: undefined }))
                }}
                placeholder="输入新密码…"
                autoComplete="new-password"
                required
                disabled={isExecuting}
                aria-invalid={!!errors.newPassword}
                aria-describedby={
                  [errors.newPassword && 'new-password-error', newPassword && 'password-strength']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
            </InputGroup>
            <FieldError id="new-password-error">{errors.newPassword}</FieldError>
            {newPassword && (
              <div id="password-strength" className="flex flex-col gap-2 text-sm leading-normal text-muted-foreground">
                <Progress
                  value={passwordStrength.value}
                  aria-label={`密码${passwordStrength.text}`}
                  className="h-1.5"
                  indicatorVariant={passwordStrength.tone === 'weak' ? 'destructive' : 'default'}
                />
                <span>{passwordStrength.text}</span>
              </div>
            )}
          </Field>

          <Field data-invalid={!!errors.confirmPassword} data-disabled={isExecuting || undefined}>
            <FieldLabel htmlFor="confirm-password">确认新密码</FieldLabel>
            <InputGroup data-disabled={isExecuting || undefined}>
              <InputGroupAddon>
                <LockKeyholeIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                ref={confirmPasswordRef}
                id="confirm-password"
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  if (errors.confirmPassword) setErrors((current) => ({ ...current, confirmPassword: undefined }))
                }}
                placeholder="再次输入新密码…"
                autoComplete="new-password"
                required
                disabled={isExecuting}
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
              />
            </InputGroup>
            <FieldError id="confirm-password-error">{errors.confirmPassword}</FieldError>
          </Field>
        </FieldGroup>

        {errors.general && (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>无法修改密码</AlertTitle>
            <AlertDescription>{errors.general}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isExecuting}>
            返回
          </Button>
          <Button type="submit" disabled={isExecuting}>
            {isExecuting && <Spinner data-icon="inline-start" aria-label="正在修改密码" />}
            {isExecuting ? '修改中…' : '修改密码'}
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
