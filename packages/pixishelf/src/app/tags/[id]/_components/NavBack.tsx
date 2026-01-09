'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

export function NavBack() {
  const router = useRouter()

  return (
    <button
      onClick={() => router.back()}
      className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
      aria-label="返回上一页"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  )
}
