'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { CircleXIcon, Loader2Icon } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { initAdminAction } from '@/actions/init-action'

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

  const { execute, isExecuting } = useAction(initAdminAction, {
    onSuccess: (result) => {
      if (result.data.success) {
        router.push('/login')
      } else {
        setErrors((prev) => ({
          ...prev,
          general: result.data.error || '初始化失败'
        }))
      }
    },
    onError: () => {
      setErrors((prev) => ({
        ...prev,
        general: '初始化失败'
      }))
    }
  })

  const [formState, setFormState] = useState<FormState>({
    username: '',
    password: '',
    confirmPassword: ''
  })
  const [errors, setErrors] = useState<FormErrors>({})

  const handleInputChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target
    setFormState((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})

    if (formState.password !== formState.confirmPassword) {
      setErrors({ confirmPassword: '两次输入的密码不一致' })
      return
    }

    if (formState.password.length < 6) {
      setErrors({ password: '密码至少需要6个字符' })
      return
    }

    execute({
      username: formState.username,
      password: formState.password
    })
  }

  return (
    <Card className="border-none shadow-none bg-transparent p-0 [&>div]:p-0">
      <CardContent className="p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">用户名</label>
            <Input
              type="text"
              value={formState.username}
              onChange={handleInputChange('username')}
              placeholder="输入用户名"
              required
              disabled={isExecuting}
            />
            {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">密码</label>
            <Input
              type="password"
              value={formState.password}
              onChange={handleInputChange('password')}
              placeholder="输入密码（至少6位）"
              required
              disabled={isExecuting}
            />
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">确认密码</label>
            <Input
              type="password"
              value={formState.confirmPassword}
              onChange={handleInputChange('confirmPassword')}
              placeholder="再次输入密码"
              required
              disabled={isExecuting}
            />
            {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
          </div>

          {errors.general && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
              <CircleXIcon className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive/80 mt-1">{errors.general}</p>
            </div>
          )}

          <Button type="submit" disabled={isExecuting} className="w-full" size="lg">
            {isExecuting ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2Icon className="w-4 h-4 animate-spin" />
                创建中...
              </div>
            ) : (
              '创建管理员'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
