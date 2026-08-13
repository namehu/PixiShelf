'use client'

import React, { useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleXIcon, LockKeyholeIcon, UserIcon } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import z from 'zod'
import { loginUserAction } from '@/actions/auth-action'
import { useAuth } from '@/components/auth'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { ROUTES } from '@/lib/constants'
import { authLoginSchema } from '@/schemas/auth.dto'

interface FormState {
  username: string
  password: string
}

interface FormErrors {
  username?: string
  password?: string
  general?: string
}

export const LoginForm: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser } = useAuth()
  const redirectTo = searchParams.get('redirect') || ROUTES.DASHBOARD

  const [formState, setFormState] = useState<FormState>({ username: '', password: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const { execute, isExecuting } = useAction(loginUserAction, {
    onSuccess: async () => {
      await refreshUser()
      router.replace(redirectTo)
    },
    onError: ({ error }) => {
      const { fieldErrors = {}, formErrors = [] } = error.validationErrors || {}
      setErrors((previous) => ({
        ...previous,
        general: formErrors[0] || '登录失败，请检查用户名和密码后重试。',
        username: fieldErrors.username?.[0],
        password: fieldErrors.password?.[0]
      }))
      if (fieldErrors.username?.[0]) usernameRef.current?.focus()
      else if (fieldErrors.password?.[0]) passwordRef.current?.focus()
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

    try {
      execute(authLoginSchema.parse(formState))
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = z.flattenError(error).fieldErrors as Partial<Record<keyof FormState, string[]>>
        setErrors({
          username: fieldErrors.username?.[0],
          password: fieldErrors.password?.[0]
        })
        if (fieldErrors.username?.[0]) usernameRef.current?.focus()
        else if (fieldErrors.password?.[0]) passwordRef.current?.focus()
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <FieldGroup className="gap-5">
        <Field data-invalid={!!errors.username}>
          <FieldLabel htmlFor="login-username">用户名</FieldLabel>
          <InputGroup data-disabled={isExecuting || undefined}>
            <InputGroupInput
              ref={usernameRef}
              id="login-username"
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
              aria-describedby={errors.username ? 'login-username-error' : undefined}
            />
            <InputGroupAddon>
              <UserIcon aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
          <FieldError id="login-username-error">{errors.username}</FieldError>
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="login-password">密码</FieldLabel>
          <InputGroup data-disabled={isExecuting || undefined}>
            <InputGroupInput
              ref={passwordRef}
              id="login-password"
              name="password"
              type="password"
              value={formState.password}
              onChange={handleInputChange('password')}
              placeholder="输入密码…"
              required
              disabled={isExecuting}
              autoComplete="current-password"
              spellCheck={false}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
            />
            <InputGroupAddon>
              <LockKeyholeIcon aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
          <FieldError id="login-password-error">{errors.password}</FieldError>
        </Field>
      </FieldGroup>

      {errors.general && (
        <Alert variant="destructive">
          <CircleXIcon aria-hidden="true" />
          <AlertTitle>无法登录</AlertTitle>
          <AlertDescription>{errors.general}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isExecuting} className="w-full" size="lg">
        {isExecuting && <Spinner data-icon="inline-start" aria-label="正在登录" />}
        {isExecuting ? '登录中…' : '登录'}
      </Button>
    </form>
  )
}
