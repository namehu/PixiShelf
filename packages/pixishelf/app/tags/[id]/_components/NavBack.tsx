'use client'

import { ArrowLeft } from 'lucide-react'
import { useSafeBack } from '@/hooks/use-safe-back'

export function NavBack() {
  const safeBack = useSafeBack()

  return (
    <button
      onClick={safeBack}
      className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
      aria-label="返回上一页"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  )
}
