'use client'

import React, { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleXIcon } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { initAdminAction } from '@/actions/init-action'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

interface FormState {
  username: string
  password: string
  confirmPassword: string
}

interface FormErrors {
  username?: string
  password?: string
  confirmPassword?: string
  general?: string
}

export const InitAdminForm: React.FC = () => {
  const router = useRouter()
  const [formState, setFormState] = useState<FormState>({ username: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

  const { execute, isExecuting } = useAction(initAdminAction, {
    onSuccess: (result) => {
      if (result.data.success) {
        router.push('/login')
      } else {
        setErrors((previous) => ({
          ...previous,
          general: result.data.error || '初始化失败，请检查输入后重试。'
        }))
      }
    },
    onError: () => {
      setErrors((previous) => ({ ...previous, general: '初始化失败，请稍后重试。' }))
    }
  })

  const handleInputChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target
    setFormState((previous) => ({ ...previous, [field]: value }))
    if (errors[field]) {
      setErrors((previous) => ({ ...previous, [field]: undefined }))
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})

    const username = formState.username.trim()
    if (!username) {
      setErrors({ username: '请输入用户名。' })
      usernameRef.current?.focus()
      return
    }
    if (username.length < 3 || username.length > 20) {
      setErrors({ username: '用户名需要 3–20 个字符。' })
      usernameRef.current?.focus()
      return
    }
    if (formState.password.length < 6) {
      setErrors({ password: '密码至少需要 6 个字符。' })
      passwordRef.current?.focus()
      return
    }
    if (formState.password.length > 128) {
      setErrors({ password: '密码不能超过 128 个字符。' })
      passwordRef.current?.focus()
      return
    }
    if (formState.password !== formState.confirmPassword) {
      setErrors({ confirmPassword: '两次输入的密码不一致。' })
      confirmPasswordRef.current?.focus()
      return
    }

    execute({ username, password: formState.password })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <FieldGroup className="gap-5">
        <Field data-invalid={!!errors.username}>
          <FieldLabel htmlFor="init-username">用户名</FieldLabel>
          <Input
            ref={usernameRef}
            id="init-username"
            name="username"
            type="text"
            value={formState.username}
            onChange={handleInputChange('username')}
            placeholder="输入用户名…"
            required
            disabled={isExecuting}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? 'init-username-error' : undefined}
          />
          <FieldError id="init-username-error">{errors.username}</FieldError>
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="init-password">密码</FieldLabel>
          <Input
            ref={passwordRef}
            id="init-password"
            name="password"
            type="password"
            value={formState.password}
            onChange={handleInputChange('password')}
            placeholder="至少 6 个字符…"
            required
            disabled={isExecuting}
            autoComplete="new-password"
            spellCheck={false}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'init-password-error' : undefined}
          />
          <FieldError id="init-password-error">{errors.password}</FieldError>
        </Field>

        <Field data-invalid={!!errors.confirmPassword}>
          <FieldLabel htmlFor="init-confirm-password">确认密码</FieldLabel>
          <Input
            ref={confirmPasswordRef}
            id="init-confirm-password"
            name="confirmPassword"
            type="password"
            value={formState.confirmPassword}
            onChange={handleInputChange('confirmPassword')}
            placeholder="再次输入密码…"
            required
            disabled={isExecuting}
            autoComplete="new-password"
            spellCheck={false}
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? 'init-confirm-password-error' : undefined}
          />
          <FieldError id="init-confirm-password-error">{errors.confirmPassword}</FieldError>
        </Field>
      </FieldGroup>

      {errors.general && (
        <Alert variant="destructive">
          <CircleXIcon aria-hidden="true" />
          <AlertTitle>无法完成初始化</AlertTitle>
          <AlertDescription>{errors.general}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isExecuting} className="w-full" size="lg">
        {isExecuting && <Spinner data-icon="inline-start" aria-label="正在创建管理员" />}
        {isExecuting ? '创建中…' : '创建管理员'}
      </Button>
    </form>
  )
}
