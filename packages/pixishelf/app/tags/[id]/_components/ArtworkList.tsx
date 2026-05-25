'use client'

import { useState } from 'react'
import InfiniteArtworkList from '@/components/artwork/Infinite-artwork-list'

interface ArtworkListProps {
  tagId: number
}

export function ArtworkList({ tagId }: ArtworkListProps) {
  const [total, setTotal] = useState(0)

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          作品列表
          <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{total}</span>
        </h2>
      </div>

      <InfiniteArtworkList tagId={tagId} onTotalChange={setTotal} />
    </div>
  )
}
