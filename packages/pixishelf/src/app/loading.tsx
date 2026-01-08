'use client'

import PLogo from '@/components/layout/p-logo'

export default function Loading() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gray-50/50 backdrop-blur-sm">
      <div className="relative flex items-center justify-center">
        {/* 旋转的三段圆环 */}
        <div className="absolute w-24 h-24 animate-spin [animation-duration:2s] [animation-timing-function:linear]">
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#0096fa]" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#0096fa] rotate-[120deg]" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#0096fa] rotate-[240deg]" />
        </div>

        {/* 中间的 Logo */}
        <div className="z-10 bg-white rounded-full p-2 shadow-sm animate-pulse">
          <PLogo size={40} />
        </div>
      </div>

      <div className="mt-8 text-sm font-medium text-[#0096fa] tracking-[0.2em] uppercase animate-pulse">Loading</div>
    </div>
  )
}
