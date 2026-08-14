'use client'

import { CircleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSafeBack } from '@/hooks/use-safe-back'

export default function PageError({ content }: { content?: string }) {
  const safeBack = useSafeBack()

  return (
    <div className="flex h-full w-full items-center justify-center bg-black px-6 text-white">
      <div className="max-w-sm text-center">
        <CircleAlertIcon className="mx-auto mb-4 size-10 opacity-60" aria-hidden="true" />
        <h2 className="text-xl font-semibold">沉浸浏览加载失败</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">{content || '无法加载数据，请检查网络连接'}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            重试
          </Button>
          <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={safeBack}>
            返回
          </Button>
        </div>
      </div>
    </div>
  )
}
