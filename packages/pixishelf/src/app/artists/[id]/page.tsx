import React from 'react'
import ArtistDetailPage from './_components/Detail'
import { getArtistById } from '@/services/artist-service'
import { BackButton } from '@/components/shared/back-button'

export default async function Page({ params }: PageProps<'/artists/[id]'>) {
  const { id } = await params
  const artist = await getArtistById(id)

  if (!artist) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">艺术家不存在</h2>
          <p className="text-gray-600 mb-6">抱歉，找不到该艺术家的信息。</p>
          <BackButton />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto">
        <ArtistDetailPage artist={artist} id={id} />
      </main>
    </div>
  )
}
