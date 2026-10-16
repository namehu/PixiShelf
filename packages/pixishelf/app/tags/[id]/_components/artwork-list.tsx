'use client'

import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import { SectionHeader } from '@/components/layout/section-header'

interface ArtworkListProps {
  tagId: number
}

export function ArtworkList({ tagId }: ArtworkListProps) {

  return (
    <section className="flex w-full flex-col gap-6">
      <SectionHeader title="作品" />
      <InfiniteArtworkList tagId={tagId} />
    </section>
  )
}
