'use client'

import { useState } from 'react'
import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import { SectionHeader } from '@/components/layout/section-header'

interface ArtworkListProps {
  tagId: number
}

export function ArtworkList({ tagId }: ArtworkListProps) {
  const [total, setTotal] = useState(0)

  return (
    <section className="flex w-full flex-col gap-6">
      <SectionHeader title="作品" description={`共 ${total} 件作品`} />
      <InfiniteArtworkList tagId={tagId} onTotalChange={setTotal} />
    </section>
  )
}
