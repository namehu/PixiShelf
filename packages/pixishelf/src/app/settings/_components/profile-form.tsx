'use client'

import { useAuth } from '@/components/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAction } from 'next-safe-action/hooks'
import { updateProfileAction } from '@/actions/user-setting-action'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export function ProfileForm() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [image, setImage] = useState(user?.image ?? '')

  useEffect(() => {
    setName(user?.name ?? '')
    setImage(user?.image ?? '')
  }, [user?.name, user?.image])

  const { execute, isExecuting } = useAction(updateProfileAction, {
    onSuccess: () => {
      toast.success('资料已更新')
    },
    onError: ({ error }) => {
      const formError = error.validationErrors?.formErrors?.[0] || error.serverError || '保存失败'
      toast.error(formError)
    }
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    execute({
      name: name.trim(),
      image: image.trim() || null
    })
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">个人资料</h2>
        <p className="text-sm text-slate-500">更新你的昵称和头像地址</p>
      </div>
      <div className="grid gap-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">昵称</label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入昵称"
            maxLength={64}
            disabled={isExecuting}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">头像地址</label>
          <Input
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="https://..."
            disabled={isExecuting}
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          登录邮箱：{user?.email || '未绑定'}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isExecuting}>
          {isExecuting ? '保存中...' : '保存资料'}
        </Button>
      </div>
    </form>
  )
}
