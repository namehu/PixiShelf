import React from 'react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import TagArea from './_components/TagArea'
import LazyMedia from './_components/LazyMedia'
import ArtworkDes from './_components/ArtworkDes'
import { getArtworkById } from '@/services/artwork-service'
import z from 'zod'
import NavHead from './_components/NavHead'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function ArtworkDetailPage({ params }: PageProps<'/artworks/[id]'>) {
  const { id } = await params
  const data = await getArtworkById(z.coerce.number().parse(id))

  if (!data) {
    notFound()
  }

  const { id: artistId, name: artistName, avatar: artistAvatar } = data.artist ?? {}

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto pt-16 lg:px-8">
        <div className="bg-white max-w-2xl mx-auto">
          {/* 导航栏 */}
          <NavHead data={data} id={id} />
          {/* 主内容 */}
          <div className="max-w-full overflow-hidden">
            {/* Header */}
            <div className="mt-6 px-6">
              {/* Title and Artist */}
              <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight break-words">
                  {data.title}
                </h1>
                {data.artist && (
                  <Link href={`/artists/${artistId}`} className="flex items-center gap-2 min-w-0 cursor-pointer">
                    <ArtistAvatar src={artistAvatar} name={artistName} />
                    <div className="text-base sm:text-lg text-blue-600 hover:text-blue-800 font-medium truncate transition-colors duration-200  underline-offset-2 hover:underline">
                      {artistName}
                    </div>
                  </Link>
                )}
              </div>
              {/* Tags */}
              <TagArea tags={data.tags} />
            </div>

            {/* Description */}
            <ArtworkDes description={data.description} className="mt-6 px-6" />

            {/* Images */}
            <div className="w-full mt-6 mb-15 px-4">
              {data.images.map((img, index) => (
                <LazyMedia key={img.id} src={img.path} index={index} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
